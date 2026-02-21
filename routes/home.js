// routes/home.js
const express = require("express");
const pool = require("../db");
const fs = require("fs");
const path = require("path");

const router = express.Router();

function clampInt(v, lo, hi, fallback) {
  const n = Number.parseInt(String(v ?? ""), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(lo, Math.min(hi, n));
}

async function readJsonSafe(filePath) {
  try {
    const raw = await fs.promises.readFile(filePath, "utf8");
    const json = JSON.parse(raw);
    return json && typeof json === "object" ? json : null;
  } catch (_e) {
    return null;
  }
}

router.get("/api/home_deals", async (req, res) => {
  const limit = clampInt(req.query.limit, 6, 200, 60);
  const offset = clampInt(req.query.offset, 0, 1000000, 0);

  const client = await pool.connect();
  try {
        const sql = `
      WITH base AS (
        SELECT
          CASE
            WHEN l.pci IS NOT NULL AND btrim(l.pci) <> '' THEN 'pci:' || upper(btrim(l.pci))
            WHEN l.upc IS NOT NULL AND btrim(l.upc) <> '' THEN 'upc:' || btrim(l.upc)
            ELSE NULL
          END AS key,
          replace(lower(btrim(l.store)), ' ', '') AS store_key,
          COALESCE(l.effective_price_cents, l.current_price_cents) AS price_cents,
          COALESCE(l.current_price_observed_at, l.created_at) AS t,
          l.title AS listing_title
        FROM public.listings l
        WHERE coalesce(nullif(lower(btrim(l.status)), ''), 'active') <> 'hidden'
          AND COALESCE(l.effective_price_cents, l.current_price_cents) IS NOT NULL
          AND COALESCE(l.effective_price_cents, l.current_price_cents) > 0
          AND (
            (l.pci IS NOT NULL AND btrim(l.pci) <> '')
            OR
            (l.upc IS NOT NULL AND btrim(l.upc) <> '')
          )
      ),
      agg AS (
        SELECT
          key,
          MIN(price_cents)::int AS min_price_cents,
          MAX(price_cents)::int AS max_price_cents,
          COUNT(DISTINCT store_key)::int AS store_count
        FROM base
        GROUP BY key
      ),
      scored AS (
        SELECT
          a.*,
          ((a.max_price_cents - a.min_price_cents) * a.store_count)::int AS deal_score
        FROM agg a
        WHERE a.store_count >= 2
          AND a.max_price_cents > a.min_price_cents
      ),
      store_best AS (
        SELECT
          key,
          store_key,
          MIN(price_cents)::int AS best_price_cents
        FROM base
        GROUP BY key, store_key
      ),
      stores AS (
        SELECT
          key,
          ARRAY_AGG(store_key ORDER BY best_price_cents ASC, store_key ASC) AS stores
        FROM store_best
        GROUP BY key
      ),
      picked_meta AS (
        SELECT
          s.key,
          s.min_price_cents,
          s.max_price_cents,
          s.store_count,
          s.deal_score,
          c.model_name,
          c.brand,
          c.category,
          c.image_url
        FROM scored s
        LEFT JOIN LATERAL (
          SELECT c2.model_name, c2.brand, c2.category, c2.image_url
          FROM public.catalog c2
          WHERE
            (
              (s.key LIKE 'pci:%' AND c2.pci IS NOT NULL AND btrim(c2.pci) <> '' AND upper(btrim(c2.pci)) = substring(s.key from 5))
              OR
              (s.key LIKE 'upc:%' AND c2.upc IS NOT NULL AND btrim(c2.upc) <> '' AND public.norm_upc(c2.upc) = public.norm_upc(substring(s.key from 5)))
            )
          ORDER BY c2.created_at DESC NULLS LAST, c2.id DESC
          LIMIT 1
        ) c ON true
      ),
      picked_title AS (
        SELECT
          p.*,
          COALESCE(
            NULLIF(btrim(p.model_name), ''),
            (
              SELECT b.listing_title
              FROM base b
              WHERE b.key = p.key AND b.listing_title IS NOT NULL AND btrim(b.listing_title) <> ''
              ORDER BY b.t DESC NULLS LAST
              LIMIT 1
            ),
            'Product'
          ) AS title
        FROM picked_meta p
      )
      SELECT
        p.key,
        p.title,
        p.brand,
        p.category,
        p.image_url,
        p.min_price_cents,
        p.max_price_cents,
        p.store_count,
        p.deal_score,
        COALESCE(st.stores, ARRAY[]::text[]) AS stores
      FROM picked_title p
      LEFT JOIN stores st ON st.key = p.key
      ORDER BY p.deal_score DESC, p.store_count DESC, (p.max_price_cents - p.min_price_cents) DESC
      LIMIT $1
      OFFSET $2
    `;

    const { rows } = await client.query(sql, [limit, offset]);

    return res.json({
      ok: true,
      limit,
      offset,
      results: rows || []
    });
  } catch (e) {
    console.error("home_deals error:", e);
    return res.status(500).json({ ok: false, error: "server_error" });
  } finally {
    client.release();
  }
});

// Trend pills are backed by data/trends.json for now
router.get("/api/home_trends", async (_req, res) => {
  const fp = path.join(__dirname, "..", "data", "trends.json");
  const json = await readJsonSafe(fp);

  const results = Array.isArray(json?.results)
    ? json.results
    : Array.isArray(json?.trends)
      ? json.trends
      : [];

  return res.json({ ok: true, results });
});

// Sidebar lists: pull top categories + brands from catalog
router.get("/api/home_sidebar", async (req, res) => {
  const catsLimit = clampInt(req.query.cats, 3, 40, 12);
  const brandsLimit = clampInt(req.query.brands, 3, 40, 12);

  const client = await pool.connect();
  try {
    const catsSql = `
      SELECT
        btrim(category) AS category,
        COUNT(*)::int AS n
      FROM public.catalog
      WHERE category IS NOT NULL AND btrim(category) <> ''
      GROUP BY btrim(category)
      ORDER BY n DESC, btrim(category) ASC
      LIMIT $1
    `;

    const brandsSql = `
      SELECT
        btrim(brand) AS brand,
        COUNT(*)::int AS n
      FROM public.catalog
      WHERE brand IS NOT NULL AND btrim(brand) <> ''
      GROUP BY btrim(brand)
      ORDER BY n DESC, btrim(brand) ASC
      LIMIT $1
    `;

    const [cats, brands] = await Promise.all([
      client.query(catsSql, [catsLimit]),
      client.query(brandsSql, [brandsLimit])
    ]);

    return res.json({
      ok: true,
      categories: cats.rows || [],
      brands: brands.rows || []
    });
  } catch (e) {
    console.error("home_sidebar error:", e);
    return res.status(500).json({ ok: false, error: "server_error" });
  } finally {
    client.release();
  }
});

module.exports = router;