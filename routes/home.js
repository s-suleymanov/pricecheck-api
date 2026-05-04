// routes/home.js
const express = require("express");
const pool = require("../db");

const router = express.Router();

function clampInt(v, lo, hi, fallback) {
  const n = Number.parseInt(String(v ?? ""), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(lo, Math.min(hi, n));
}

router.get("/api/home_deals", async (req, res) => {
  const limit = clampInt(req.query.limit, 6, 60, 24);
  const offset = clampInt(req.query.offset, 0, 1000000, 0);

  const client = await pool.connect();

  try {
    const sql = `
      WITH listing_base AS (
        SELECT
          CASE
            WHEN l.pci IS NOT NULL AND btrim(l.pci) <> ''
              THEN 'pci:' || upper(btrim(l.pci))
            WHEN l.upc IS NOT NULL AND btrim(l.upc) <> ''
              THEN 'upc:' || btrim(l.upc)
            ELSE NULL
          END AS key,
          replace(lower(btrim(l.store)), ' ', '') AS store_key,
          COALESCE(l.effective_price_cents, l.current_price_cents)::int AS price_cents,
          COALESCE(l.current_price_observed_at, l.created_at) AS last_seen
        FROM public.listings l
        WHERE coalesce(nullif(lower(btrim(l.status)), ''), 'active') <> 'hidden'
          AND COALESCE(l.effective_price_cents, l.current_price_cents) > 0
          AND (
            (l.pci IS NOT NULL AND btrim(l.pci) <> '')
            OR (l.upc IS NOT NULL AND btrim(l.upc) <> '')
          )
      ),

      offer_groups AS (
        SELECT
          key,
          MIN(price_cents)::int AS min_price_cents,
          MAX(price_cents)::int AS max_price_cents,
          COUNT(DISTINCT store_key)::int AS store_count,
          MAX(last_seen) AS last_seen,
          ARRAY_AGG(DISTINCT store_key ORDER BY store_key) AS stores
        FROM listing_base
        WHERE key IS NOT NULL
        GROUP BY key
        HAVING COUNT(DISTINCT store_key) >= 2
           AND MAX(price_cents) > MIN(price_cents)
      ),

      catalog_one AS (
        SELECT DISTINCT ON (key)
          key,
          COALESCE(NULLIF(btrim(model_name), ''), 'Product') AS title,
          brand,
          category,
          image_url,
          model_number
        FROM (
          SELECT
            'pci:' || upper(btrim(c.pci)) AS key,
            c.model_name,
            c.brand,
            c.category,
            c.image_url,
            c.model_number,
            c.created_at,
            c.id
          FROM public.catalog c
          WHERE c.pci IS NOT NULL
            AND btrim(c.pci) <> ''
            AND c.image_url IS NOT NULL
            AND btrim(c.image_url) <> ''
            AND lower(btrim(c.image_url)) NOT IN ('null', 'undefined')
            AND COALESCE(c.is_refurbished, false) = false
            AND COALESCE(c.is_bundle, false) = false

          UNION ALL

          SELECT
            'upc:' || btrim(c.upc) AS key,
            c.model_name,
            c.brand,
            c.category,
            c.image_url,
            c.model_number,
            c.created_at,
            c.id
          FROM public.catalog c
          WHERE c.upc IS NOT NULL
            AND btrim(c.upc) <> ''
            AND c.image_url IS NOT NULL
            AND btrim(c.image_url) <> ''
            AND lower(btrim(c.image_url)) NOT IN ('null', 'undefined')
            AND COALESCE(c.is_refurbished, false) = false
            AND COALESCE(c.is_bundle, false) = false
        ) x
        ORDER BY key, created_at DESC NULLS LAST, id DESC
      ),

      joined AS (
        SELECT
          og.key,
          co.title,
          co.brand,
          co.category,
          co.image_url,
          co.model_number,
          og.min_price_cents,
          og.max_price_cents,
          og.store_count,
          og.last_seen,
          og.stores,
          (
            ((og.max_price_cents - og.min_price_cents) * og.store_count)
            + CASE WHEN og.last_seen > now() - interval '7 days' THEN 8 ELSE 0 END
          )::int AS score
        FROM offer_groups og
        JOIN catalog_one co
          ON co.key = og.key
      ),

      deduped AS (
        SELECT DISTINCT ON (
          COALESCE(NULLIF(btrim(model_number), ''), key),
          lower(btrim(COALESCE(brand, '')))
        )
          key,
          title,
          brand,
          category,
          image_url,
          min_price_cents,
          max_price_cents,
          store_count,
          last_seen,
          stores,
          score
        FROM joined
        ORDER BY
          COALESCE(NULLIF(btrim(model_number), ''), key),
          lower(btrim(COALESCE(brand, ''))),
          score DESC,
          store_count DESC,
          last_seen DESC NULLS LAST
      )

      SELECT
        key,
        title,
        brand,
        category,
        image_url,
        min_price_cents,
        max_price_cents,
        store_count,
        score,
        NULL::int AS overall_score,
        false AS has_coupon,
        COALESCE(stores, ARRAY[]::text[]) AS stores
      FROM deduped
      ORDER BY score DESC, store_count DESC, last_seen DESC NULLS LAST
      LIMIT $1 OFFSET $2
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