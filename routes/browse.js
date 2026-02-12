// routes/browse.js
const path = require("path");
const express = require("express");
const pool = require("../db");

const router = express.Router();

function clampInt(v, lo, hi, fallback) {
  const n = Number.parseInt(String(v ?? ""), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(lo, Math.min(hi, n));
}

function normText(v) {
  return String(v ?? "").trim();
}

// Helper SQL snippet: normalize version for grouping.
const VERSION_NORM_SQL = "COALESCE(NULLIF(lower(btrim(c.version)), ''), '')";

// Serve browse page (SPA HTML for all browse paths)
const BROWSE_HTML = path.join(__dirname, "..", "public", "browse", "index.html");

router.get("/browse", (_req, res) => res.redirect(301, "/browse/"));
router.get("/browse/", (_req, res) => res.sendFile(BROWSE_HTML));
// Catch-all for deeper browse paths like /browse/Apple/category/TV/page/2/
router.get("/browse/*", (_req, res) => res.sendFile(BROWSE_HTML));

// GET /api/browse?type=brand&value=Sony&page=1&limit=24
router.get("/api/browse", async (req, res) => {
  let type = String(req.query.type || "").toLowerCase();
  let value = normText(req.query.value);

  const brand = normText(req.query.brand);
  const category = normText(req.query.category);
  const family = normText(req.query.family);
  const hasFamily = !!family;

  if (brand) {
    type = "brand";
    value = brand;
  } else if (category) {
    type = "category";
    value = category;
  }

  const hasBrand = !!brand;
  const hasCategory = !!category;

  if (hasBrand && hasCategory) {
    type = "combo";
    value = `${brand} ${category}`;
  } else if (hasBrand) {
    type = "brand";
    value = brand;
  } else if (hasCategory) {
    type = "category";
    value = category;
  }

  if (!value || (type !== "brand" && type !== "category" && type !== "combo")) {
    return res.status(400).json({ ok: false, error: "brand/category is required" });
  }

  const page = clampInt(req.query.page, 1, 1000000, 1);
  const limit = clampInt(req.query.limit, 6, 500, 60);
  const offset = (page - 1) * limit;

  const client = await pool.connect();
  try {
    const countSql = `
      WITH base AS (
        SELECT DISTINCT
          upper(btrim(model_number)) AS model_number_norm,
          COALESCE(NULLIF(lower(btrim(version)), ''), '') AS version_norm
        FROM public.catalog
        WHERE model_number IS NOT NULL AND btrim(model_number) <> ''
          AND ($5 = '' OR upper(btrim(model_number)) = upper(btrim($5)))
          AND (
            ($1 = 'brand' AND lower(btrim(brand)) = lower(btrim($2)))
            OR
            ($1 = 'category' AND lower(btrim(category)) = lower(btrim($2)))
            OR
            ($1 = 'combo' AND lower(btrim(brand)) = lower(btrim($3)) AND lower(btrim(category)) = lower(btrim($4)))
          )
      )
      SELECT COUNT(*)::int AS total
      FROM base
    `;

    const total =
      (await client.query(countSql, [type, value, brand, category, family || ""])).rows?.[0]?.total ?? 0;

    const listSql = `
      WITH picked AS (
        SELECT DISTINCT ON (
          upper(btrim(c.model_number)),
          ${VERSION_NORM_SQL}
        )
          btrim(c.model_number) AS model_number,
          upper(btrim(c.model_number)) AS model_number_norm,
          COALESCE(NULLIF(lower(btrim(c.version)), ''), '') AS version_norm,
          c.version,
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
          AND ($5 = '' OR upper(btrim(c.model_number)) = upper(btrim($5)))
          AND (
            ($1 = 'brand' AND lower(btrim(c.brand)) = lower(btrim($2)))
            OR
            ($1 = 'category' AND lower(btrim(c.category)) = lower(btrim($2)))
            OR
            ($1 = 'combo' AND lower(btrim(c.brand)) = lower(btrim($3)) AND lower(btrim(c.category)) = lower(btrim($4)))
          )
        ORDER BY
          upper(btrim(c.model_number)),
          ${VERSION_NORM_SQL},
          c.created_at DESC NULLS LAST,
          c.id DESC
      ),
      page_rows AS (
        SELECT *
        FROM picked
        ORDER BY brand NULLS LAST, category NULLS LAST, model_name NULLS LAST, model_number_norm, version_norm
        LIMIT $6 OFFSET $7
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
          a.model_number_norm,
          a.version_norm,
          MIN(l.current_price_cents) FILTER (WHERE l.current_price_cents IS NOT NULL) AS best_price_cents
        FROM anchors a
        LEFT JOIN public.catalog c
          ON upper(btrim(c.model_number)) = a.model_number_norm
         AND COALESCE(NULLIF(lower(btrim(c.version)), ''), '') = a.version_norm
        LEFT JOIN public.listings l
          ON (
            (c.pci IS NOT NULL AND btrim(c.pci) <> '' AND l.pci IS NOT NULL AND btrim(l.pci) <> '' AND upper(btrim(l.pci)) = upper(btrim(c.pci)))
            OR
            (c.upc IS NOT NULL AND btrim(c.upc) <> '' AND l.upc IS NOT NULL AND btrim(l.upc) <> '' AND public.norm_upc(l.upc) = public.norm_upc(c.upc))
          )
        GROUP BY a.model_number_norm, a.version_norm
      )
      SELECT
        a.model_number,
        a.version,
        a.model_name,
        a.brand,
        a.category,
        a.image_url,
        a.dropship_warning,
        a.dashboard_key,
        ch.best_price_cents
      FROM anchors a
      LEFT JOIN cheapest ch
        ON ch.model_number_norm = a.model_number_norm
       AND ch.version_norm = a.version_norm
      ORDER BY a.brand NULLS LAST, a.category NULLS LAST, a.model_name NULLS LAST, a.model_number_norm, a.version_norm
    `;

    const { rows } = await client.query(listSql, [type, value, brand, category, family || "", limit, offset]);

    res.json({
      ok: true,
      type,
      value,
      brand: hasBrand ? brand : "",
      category: hasCategory ? category : "",
      family: hasFamily ? family : "",
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

// GET /api/brand_panel?brand=Samsung&category=Phones
router.get("/api/brand_panel", async (req, res) => {
  const brand = normText(req.query.brand);
  const category = normText(req.query.category);

  if (!brand) return res.status(400).json({ ok: false, error: "brand is required" });

  const catsLimit = clampInt(req.query.cats_limit, 1, 200, 200);
  const famsLimit = clampInt(req.query.fams_limit, 1, 300, 120);

  const client = await pool.connect();
  try {
    const categoriesSql = `
      WITH base AS (
        SELECT
          upper(btrim(model_number)) AS model_number_norm,
          COALESCE(NULLIF(lower(btrim(version)), ''), '') AS version_norm,
          btrim(category) AS category
        FROM public.catalog
        WHERE model_number IS NOT NULL AND btrim(model_number) <> ''
          AND brand IS NOT NULL AND btrim(brand) <> ''
          AND lower(btrim(brand)) = lower(btrim($1))
          AND category IS NOT NULL AND btrim(category) <> ''
      )
      SELECT
        MIN(category) AS value,
        COUNT(DISTINCT (model_number_norm || '|' || version_norm))::int AS products
      FROM base
      GROUP BY lower(category)
      ORDER BY products DESC, value ASC
      LIMIT $2
    `;

    const familiesSql = `
      WITH base AS (
        SELECT
          upper(btrim(model_number)) AS model_number_norm,
          COALESCE(NULLIF(lower(btrim(version)), ''), '') AS version_norm,
          btrim(model_number) AS family_label
        FROM public.catalog
        WHERE model_number IS NOT NULL AND btrim(model_number) <> ''
          AND brand IS NOT NULL AND btrim(brand) <> ''
          AND lower(btrim(brand)) = lower(btrim($1))
          AND ($2 = '' OR (category IS NOT NULL AND btrim(category) <> '' AND lower(btrim(category)) = lower(btrim($2))))
      )
      SELECT
        MIN(family_label) AS value,
        COUNT(DISTINCT (model_number_norm || '|' || version_norm))::int AS products
      FROM base
      GROUP BY model_number_norm
      ORDER BY products DESC, value ASC
      LIMIT $3
    `;

    const cats = (await client.query(categoriesSql, [brand, catsLimit])).rows || [];
    const fams = (await client.query(familiesSql, [brand, category || "", famsLimit])).rows || [];

    return res.json({
      ok: true,
      brand,
      category: category || "",
      categories: cats.map((r) => r.value).filter(Boolean),
      families: fams.map((r) => r.value).filter(Boolean),
    });
  } catch (e) {
    console.error("brand_panel error:", e);
    return res.status(500).json({ ok: false, error: "server_error" });
  } finally {
    client.release();
  }
});

// GET /api/category_panel?category=Headphones
router.get("/api/category_panel", async (req, res) => {
  const category = normText(req.query.category);
  if (!category) return res.status(400).json({ ok: false, error: "category is required" });

  const brandsLimit = clampInt(req.query.brands_limit, 1, 200, 120);

  const client = await pool.connect();
  try {
    const brandsSql = `
      WITH base AS (
        SELECT
          upper(btrim(model_number)) AS model_number_norm,
          COALESCE(NULLIF(lower(btrim(version)), ''), '') AS version_norm,
          btrim(brand) AS brand
        FROM public.catalog
        WHERE model_number IS NOT NULL AND btrim(model_number) <> ''
          AND category IS NOT NULL AND btrim(category) <> ''
          AND lower(btrim(category)) = lower(btrim($1))
          AND brand IS NOT NULL AND btrim(brand) <> ''
      )
      SELECT
        MIN(brand) AS value,
        COUNT(DISTINCT (model_number_norm || '|' || version_norm))::int AS products
      FROM base
      GROUP BY lower(brand)
      ORDER BY products DESC, value ASC
      LIMIT $2
    `;

    const brands = (await client.query(brandsSql, [category, brandsLimit])).rows || [];

    return res.json({
      ok: true,
      category,
      brands: brands.map((r) => r.value).filter(Boolean),
    });
  } catch (e) {
    console.error("category_panel error:", e);
    return res.status(500).json({ ok: false, error: "server_error" });
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
          upper(btrim(model_number)) AS model_number_norm,
          COALESCE(NULLIF(lower(btrim(version)), ''), '') AS version_norm,
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
          COUNT(DISTINCT (model_number_norm || '|' || version_norm))::int AS products
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
