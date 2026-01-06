// routes/browse.js
const path = require("path");
const express = require("express");
const { Pool } = require("pg");

const router = express.Router();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSLMODE === "disable" ? false : { rejectUnauthorized: false },
});

function clampInt(v, lo, hi, fallback) {
  const n = Number.parseInt(String(v ?? ""), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(lo, Math.min(hi, n));
}

function normText(v) {
  return String(v ?? "").trim();
}

function normLower(v) {
  return normText(v).toLowerCase();
}

// Serve browse page (support both /browse and /browse/)
router.get("/browse", (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "browse", "index.html"));
});
router.get("/browse/", (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "browse", "index.html"));
});

router.get("/api/search", async (req, res) => {
  const q = normText(req.query.q);
  if (!q) return res.status(400).json({ ok: false, error: "q is required" });

  const page = clampInt(req.query.page, 1, 1000000, 1);
  const limit = clampInt(req.query.limit, 6, 500, 60);
  const offset = (page - 1) * limit;

  const qLower = normLower(q);
  const like = `%${qLower}%`;

  const client = await pool.connect();
  try {
    // 1) exact brand + category checks (case-insensitive)
    const facetSql = `
      WITH b AS (
        SELECT
          MIN(btrim(brand)) AS label,
          COUNT(DISTINCT upper(btrim(model_number)))::int AS products
        FROM public.catalog
        WHERE model_number IS NOT NULL AND btrim(model_number) <> ''
          AND brand IS NOT NULL AND btrim(brand) <> ''
          AND lower(btrim(brand)) = $1
      ),
      c AS (
        SELECT
          MIN(btrim(category)) AS label,
          COUNT(DISTINCT upper(btrim(model_number)))::int AS products
        FROM public.catalog
        WHERE model_number IS NOT NULL AND btrim(model_number) <> ''
          AND category IS NOT NULL AND btrim(category) <> ''
          AND lower(btrim(category)) = $1
      )
      SELECT
        (SELECT label FROM b) AS brand_label,
        (SELECT products FROM b) AS brand_products,
        (SELECT label FROM c) AS category_label,
        (SELECT products FROM c) AS category_products
    `;
    const facetRow = (await client.query(facetSql, [qLower])).rows?.[0] || {};
    const brandProducts = facetRow.brand_products || 0;
    const categoryProducts = facetRow.category_products || 0;

    // Helper: fetch products for a given facet type/value (same logic as /api/browse)
    async function fetchFacet(type, value) {
      const countSql = `
        WITH base AS (
          SELECT DISTINCT ON (upper(btrim(model_number)))
            upper(btrim(model_number)) AS model_number
          FROM public.catalog
          WHERE model_number IS NOT NULL AND btrim(model_number) <> ''
            AND (
              ($1 = 'brand' AND lower(btrim(brand)) = lower(btrim($2)))
              OR
              ($1 = 'category' AND lower(btrim(category)) = lower(btrim($2)))
            )
        )
        SELECT COUNT(*)::int AS total
        FROM base
      `;
      const total = (await client.query(countSql, [type, value])).rows?.[0]?.total ?? 0;

      const listSql = `
        WITH picked AS (
          SELECT DISTINCT ON (upper(btrim(model_number)))
            upper(btrim(model_number)) AS model_number,
            c.model_name,
            c.brand,
            c.category,
            c.image_url,
            COALESCE(c.dropship_warning, false) AS dropship_warning,
            c.pci,
            c.upc,
            c.created_at,
            c.id
          FROM public.catalog c
          WHERE c.model_number IS NOT NULL AND btrim(c.model_number) <> ''
            AND (
              ($1 = 'brand' AND lower(btrim(c.brand)) = lower(btrim($2)))
              OR
              ($1 = 'category' AND lower(btrim(c.category)) = lower(btrim($2)))
            )
          ORDER BY upper(btrim(model_number)), c.created_at DESC NULLS LAST, c.id DESC
        ),
        page_rows AS (
          SELECT *
          FROM picked
          ORDER BY brand NULLS LAST, category NULLS LAST, model_name NULLS LAST, model_number
          LIMIT $3 OFFSET $4
        ),
        anchors AS (
          SELECT
            p.*,
            CASE
              WHEN p.pci IS NOT NULL AND btrim(p.pci) <> '' THEN ('pci:' || btrim(p.pci))
              WHEN p.upc IS NOT NULL AND btrim(p.upc) <> '' THEN ('upc:' || btrim(p.upc))
              ELSE NULL
            END AS dashboard_key
          FROM page_rows p
        ),
        cheapest AS (
          SELECT
            a.model_number,
            MIN(l.current_price_cents) FILTER (WHERE l.current_price_cents IS NOT NULL) AS best_price_cents
          FROM anchors a
          LEFT JOIN public.catalog c
            ON upper(btrim(c.model_number)) = a.model_number
          LEFT JOIN public.listings l
            ON (
              (c.pci IS NOT NULL AND btrim(c.pci) <> '' AND l.pci IS NOT NULL AND btrim(l.pci) <> '' AND upper(btrim(l.pci)) = upper(btrim(c.pci)))
              OR
              (c.upc IS NOT NULL AND btrim(c.upc) <> '' AND l.upc IS NOT NULL AND btrim(l.upc) <> '' AND public.norm_upc(l.upc) = public.norm_upc(c.upc))
            )
          GROUP BY a.model_number
        )
        SELECT
          a.model_number,
          a.model_name,
          a.brand,
          a.category,
          a.image_url,
          a.dropship_warning,
          a.dashboard_key,
          ch.best_price_cents
        FROM anchors a
        LEFT JOIN cheapest ch ON ch.model_number = a.model_number
        ORDER BY a.brand NULLS LAST, a.category NULLS LAST, a.model_name NULLS LAST, a.model_number
      `;

      const { rows } = await client.query(listSql, [type, value, limit, offset]);

      return {
        total,
        pages: Math.max(1, Math.ceil(total / limit)),
        results: rows || [],
      };
    }

    // 2) If brand/category match exists, return that and do NOT do product search
    if (brandProducts > 0 || categoryProducts > 0) {
      // Pick primary facet.
      // If both match, choose the larger one as primary, and return the other in "also".
      let kind;
      let value;
      let also = [];

      if (brandProducts > 0 && categoryProducts > 0) {
        if (brandProducts >= categoryProducts) {
          kind = "brand";
          value = facetRow.brand_label || q;
          also.push({ kind: "category", value: facetRow.category_label || q, products: categoryProducts });
        } else {
          kind = "category";
          value = facetRow.category_label || q;
          also.push({ kind: "brand", value: facetRow.brand_label || q, products: brandProducts });
        }
      } else if (brandProducts > 0) {
        kind = "brand";
        value = facetRow.brand_label || q;
      } else {
        kind = "category";
        value = facetRow.category_label || q;
      }

      const facetData = await fetchFacet(kind, value);

      return res.json({
        ok: true,
        kind,
        value,
        page,
        limit,
        total: facetData.total,
        pages: facetData.pages,
        results: facetData.results,
        also,
      });
    }

    // 3) Fallback: product search in catalog.model_name (plus model_number so "g30lp" hits)
    const countSql = `
      WITH base AS (
        SELECT DISTINCT ON (upper(btrim(model_number)))
          upper(btrim(model_number)) AS model_number
        FROM public.catalog
        WHERE model_number IS NOT NULL AND btrim(model_number) <> ''
          AND (
            lower(coalesce(model_name,'')) LIKE $1
            OR lower(coalesce(model_number,'')) LIKE $1
          )
      )
      SELECT COUNT(*)::int AS total
      FROM base
    `;
    const total = (await client.query(countSql, [like])).rows?.[0]?.total ?? 0;

    const listSql = `
      WITH picked AS (
        SELECT DISTINCT ON (upper(btrim(model_number)))
          upper(btrim(model_number)) AS model_number,
          c.model_name,
          c.brand,
          c.category,
          c.image_url,
          COALESCE(c.dropship_warning, false) AS dropship_warning,
          c.pci,
          c.upc,
          c.created_at,
          c.id
        FROM public.catalog c
        WHERE c.model_number IS NOT NULL AND btrim(c.model_number) <> ''
          AND (
            lower(coalesce(c.model_name,'')) LIKE $1
            OR lower(coalesce(c.model_number,'')) LIKE $1
          )
        ORDER BY upper(btrim(model_number)), c.created_at DESC NULLS LAST, c.id DESC
      ),
      page_rows AS (
        SELECT *
        FROM picked
        ORDER BY brand NULLS LAST, category NULLS LAST, model_name NULLS LAST, model_number
        LIMIT $2 OFFSET $3
      ),
      anchors AS (
        SELECT
          p.*,
          CASE
            WHEN p.pci IS NOT NULL AND btrim(p.pci) <> '' THEN ('pci:' || btrim(p.pci))
            WHEN p.upc IS NOT NULL AND btrim(p.upc) <> '' THEN ('upc:' || btrim(p.upc))
            ELSE NULL
          END AS dashboard_key
        FROM page_rows p
      ),
      cheapest AS (
        SELECT
          a.model_number,
          MIN(l.current_price_cents) FILTER (WHERE l.current_price_cents IS NOT NULL) AS best_price_cents
        FROM anchors a
        LEFT JOIN public.catalog c
          ON upper(btrim(c.model_number)) = a.model_number
        LEFT JOIN public.listings l
          ON (
            (c.pci IS NOT NULL AND btrim(c.pci) <> '' AND l.pci IS NOT NULL AND btrim(l.pci) <> '' AND upper(btrim(l.pci)) = upper(btrim(c.pci)))
            OR
            (c.upc IS NOT NULL AND btrim(c.upc) <> '' AND l.upc IS NOT NULL AND btrim(l.upc) <> '' AND public.norm_upc(l.upc) = public.norm_upc(c.upc))
          )
        GROUP BY a.model_number
      )
      SELECT
        a.model_number,
        a.model_name,
        a.brand,
        a.category,
        a.image_url,
        a.dropship_warning,
        a.dashboard_key,
        ch.best_price_cents
      FROM anchors a
      LEFT JOIN cheapest ch ON ch.model_number = a.model_number
      ORDER BY a.brand NULLS LAST, a.category NULLS LAST, a.model_name NULLS LAST, a.model_number
    `;

    const { rows } = await client.query(listSql, [like, limit, offset]);

    return res.json({
      ok: true,
      kind: "product",
      value: q,
      page,
      limit,
      total,
      pages: Math.max(1, Math.ceil(total / limit)),
      results: rows || [],
      also: [],
    });
  } catch (e) {
    console.error("search error:", e);
    return res.status(500).json({ ok: false, error: "server_error" });
  } finally {
    client.release();
  }
});

// GET /api/browse?type=brand&value=Sony&page=1&limit=24
router.get("/api/browse", async (req, res) => {
  let type = String(req.query.type || "").toLowerCase();
  let value = normText(req.query.value);

  const brand = normText(req.query.brand);
  const category = normText(req.query.category);

  if (brand) {
    type = "brand";
    value = brand;
  } else if (category) {
    type = "category";
    value = category;
  }

  if (!value || (type !== "brand" && type !== "category")) {
    return res.status(400).json({ ok: false, error: "brand or category is required" });
  }

  const page = clampInt(req.query.page, 1, 1000000, 1);
  const limit = clampInt(req.query.limit, 6, 500, 60);
  const offset = (page - 1) * limit;

  const client = await pool.connect();
  try {
    const countSql = `
      WITH base AS (
        SELECT DISTINCT ON (upper(btrim(model_number)))
          upper(btrim(model_number)) AS model_number
        FROM public.catalog
        WHERE model_number IS NOT NULL AND btrim(model_number) <> ''
          AND (
            ($1 = 'brand' AND lower(btrim(brand)) = lower(btrim($2)))
            OR
            ($1 = 'category' AND lower(btrim(category)) = lower(btrim($2)))
          )
      )
      SELECT COUNT(*)::int AS total
      FROM base
    `;
    const total = (await client.query(countSql, [type, value])).rows?.[0]?.total ?? 0;

    const listSql = `
      WITH picked AS (
        SELECT DISTINCT ON (upper(btrim(model_number)))
          upper(btrim(model_number)) AS model_number,
          c.model_name,
          c.brand,
          c.category,
          c.image_url,
          COALESCE(c.dropship_warning, false) AS dropship_warning,
          c.pci,
          c.upc,
          c.created_at,
          c.id
        FROM public.catalog c
        WHERE c.model_number IS NOT NULL AND btrim(c.model_number) <> ''
          AND (
            ($1 = 'brand' AND lower(btrim(c.brand)) = lower(btrim($2)))
            OR
            ($1 = 'category' AND lower(btrim(c.category)) = lower(btrim($2)))
          )
        ORDER BY upper(btrim(model_number)), c.created_at DESC NULLS LAST, c.id DESC
      ),
      page_rows AS (
        SELECT *
        FROM picked
        ORDER BY brand NULLS LAST, category NULLS LAST, model_name NULLS LAST, model_number
        LIMIT $3 OFFSET $4
      ),
      anchors AS (
        SELECT
          p.*,
          CASE
            WHEN p.pci IS NOT NULL AND btrim(p.pci) <> '' THEN ('pci:' || btrim(p.pci))
            WHEN p.upc IS NOT NULL AND btrim(p.upc) <> '' THEN ('upc:' || btrim(p.upc))
            ELSE NULL
          END AS dashboard_key
        FROM page_rows p
      ),
      cheapest AS (
        SELECT
          a.model_number,
          MIN(l.current_price_cents) FILTER (WHERE l.current_price_cents IS NOT NULL) AS best_price_cents
        FROM anchors a
        LEFT JOIN public.catalog c
          ON upper(btrim(c.model_number)) = a.model_number
        LEFT JOIN public.listings l
          ON (
            (c.pci IS NOT NULL AND btrim(c.pci) <> '' AND l.pci IS NOT NULL AND btrim(l.pci) <> '' AND upper(btrim(l.pci)) = upper(btrim(c.pci)))
            OR
            (c.upc IS NOT NULL AND btrim(c.upc) <> '' AND l.upc IS NOT NULL AND btrim(l.upc) <> '' AND public.norm_upc(l.upc) = public.norm_upc(c.upc))
          )
        GROUP BY a.model_number
      )
      SELECT
        a.model_number,
        a.model_name,
        a.brand,
        a.category,
        a.image_url,
        a.dropship_warning,
        a.dashboard_key,
        ch.best_price_cents
      FROM anchors a
      LEFT JOIN cheapest ch ON ch.model_number = a.model_number
      ORDER BY a.brand NULLS LAST, a.category NULLS LAST, a.model_name NULLS LAST, a.model_number
    `;

    const { rows } = await client.query(listSql, [type, value, limit, offset]);

    res.json({
      ok: true,
      type,
      value,
      page,
      limit,
      total,
      pages: Math.max(1, Math.ceil(total / limit)),
      results: rows || [],
    });
  } catch (e) {
    console.error("browse error:", e);
    res.status(500).json({ ok: false, error: "server_error" });
  } finally {
    client.release();
  }
});

// GET /api/browse_facets?kind=category&limit=24
router.get("/api/browse_facets", async (req, res) => {
  const kind = String(req.query.kind || "category").toLowerCase();
  if (kind !== "category" && kind !== "brand") {
    return res.status(400).json({ ok: false, error: "kind must be category|brand" });
  }

  const limit = clampInt(req.query.limit, 6, 500, 60);

  const client = await pool.connect();
  try {
    const sql = `
      WITH base AS (
        SELECT
          upper(btrim(model_number)) AS model_number,
          ${kind} AS facet,
          image_url,
          created_at,
          id
        FROM public.catalog
        WHERE model_number IS NOT NULL AND btrim(model_number) <> ''
          AND ${kind} IS NOT NULL AND btrim(${kind}) <> ''
      ),
      counts AS (
        SELECT
          lower(btrim(facet)) AS facet_norm,
          MIN(btrim(facet)) AS facet_label,
          COUNT(DISTINCT model_number)::int AS products
        FROM base
        GROUP BY lower(btrim(facet))
      ),
      images AS (
        SELECT DISTINCT ON (lower(btrim(facet)))
          lower(btrim(facet)) AS facet_norm,
          image_url
        FROM base
        WHERE image_url IS NOT NULL AND btrim(image_url) <> ''
        ORDER BY lower(btrim(facet)), created_at DESC NULLS LAST, id DESC
      )
      SELECT
        c.facet_label AS value,
        c.products,
        i.image_url
      FROM counts c
      LEFT JOIN images i ON i.facet_norm = c.facet_norm
      ORDER BY c.products DESC, c.facet_label ASC
      LIMIT $1
    `;

    const { rows } = await client.query(sql, [limit]);

    res.json({
      ok: true,
      kind,
      results: rows || [],
    });
  } catch (e) {
    console.error("browse_facets error:", e);
    res.status(500).json({ ok: false, error: "server_error" });
  } finally {
    client.release();
  }
});

module.exports = router;
