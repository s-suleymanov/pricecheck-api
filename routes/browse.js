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

router.get("/browse", (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "browse", "index.html"));
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
    // 1) total count (distinct model_number groups)
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

    // 2) paged list
    // Pick 1 “representative” catalog row per model_number (latest created_at), also pick an anchor key for dashboard.
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
          c.created_at
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
    // Count distinct model_number groups per category/brand
    // Also pick a representative image (latest created row within that category/brand)
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
