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
  const limit = clampInt(req.query.limit, 6, 200, 60);
  const offset = clampInt(req.query.offset, 0, 1000000, 0);

  const client = await pool.connect();
  try {
        const sql = `
      WITH
      base AS (
        SELECT
          CASE
            WHEN l.pci IS NOT NULL AND btrim(l.pci) <> ''
              THEN 'pci:' || upper(btrim(l.pci))
            WHEN l.upc IS NOT NULL AND btrim(l.upc) <> ''
              THEN 'upc:' || btrim(l.upc)
          END AS key,
          replace(lower(btrim(l.store)), ' ', '') AS store_key,
          COALESCE(l.effective_price_cents, l.current_price_cents) AS price_cents,
          COALESCE(l.current_price_observed_at, l.created_at) AS observed_at
        FROM public.listings l
        WHERE coalesce(nullif(lower(btrim(l.status)), ''), 'active') <> 'hidden'
          AND COALESCE(l.effective_price_cents, l.current_price_cents) > 0
          AND (
            (l.pci IS NOT NULL AND btrim(l.pci) <> '')
            OR (l.upc IS NOT NULL AND btrim(l.upc) <> '')
          )
      ),

      bk AS (
        SELECT * FROM base WHERE key IS NOT NULL
      ),

      agg AS (
        SELECT
          key,
          MIN(price_cents)::int AS min_price_cents,
          MAX(price_cents)::int AS max_price_cents,
          COUNT(DISTINCT store_key)::int AS store_count,
          MAX(observed_at) AS last_seen
        FROM bk
        GROUP BY key
      ),

      sb AS (
        SELECT key, store_key, MIN(price_cents)::int AS bp
        FROM bk
        GROUP BY key, store_key
      ),

      sa AS (
        SELECT key, ARRAY_AGG(store_key ORDER BY bp ASC, store_key ASC) AS stores
        FROM sb
        GROUP BY key
      ),

      catalog_keys AS (
        SELECT DISTINCT ON (key)
          key,
          model_name,
          model_number,
          brand,
          category,
          image_url,
          model_number_norm,
          version_norm
        FROM (
          SELECT
            'pci:' || upper(btrim(c.pci)) AS key,
            c.model_name,
            c.model_number,
            c.brand,
            c.category,
            c.image_url,
            upper(btrim(c.model_number)) AS model_number_norm,
            COALESCE(NULLIF(lower(btrim(c.version)), ''), '') AS version_norm,
            c.created_at,
            c.id
          FROM public.catalog c
          WHERE c.pci IS NOT NULL
            AND btrim(c.pci) <> ''
            AND COALESCE(c.is_refurbished, false) = false
            AND COALESCE(c.is_bundle, false) = false

          UNION ALL

          SELECT
            'upc:' || btrim(c.upc) AS key,
            c.model_name,
            c.model_number,
            c.brand,
            c.category,
            c.image_url,
            upper(btrim(c.model_number)) AS model_number_norm,
            COALESCE(NULLIF(lower(btrim(c.version)), ''), '') AS version_norm,
            c.created_at,
            c.id
          FROM public.catalog c
          WHERE c.upc IS NOT NULL
            AND btrim(c.upc) <> ''
            AND COALESCE(c.is_refurbished, false) = false
            AND COALESCE(c.is_bundle, false) = false
        ) x
        ORDER BY key, created_at DESC NULLS LAST, id DESC
      ),

      with_cat AS (
        SELECT
          a.key,
          a.min_price_cents,
          a.max_price_cents,
          a.store_count,
          a.last_seen,
          ck.model_name,
          ck.model_number,
          ck.brand,
          ck.category,
          ck.image_url,
          ck.model_number_norm,
          ck.version_norm
        FROM agg a
        LEFT JOIN catalog_keys ck
          ON ck.key = a.key
      ),

      coupon_group AS (
        SELECT
          wc.key,
          BOOL_OR(
            (
              NULLIF(btrim(l.coupon_text), '') IS NOT NULL
              OR NULLIF(btrim(l.coupon_code), '') IS NOT NULL
              OR COALESCE(l.coupon_value_cents, 0) > 0
              OR COALESCE(l.coupon_value_pct, 0) > 0
              OR (
                l.effective_price_cents IS NOT NULL
                AND l.current_price_cents IS NOT NULL
                AND l.effective_price_cents > 0
                AND l.effective_price_cents < l.current_price_cents
              )
            )
          ) AS has_coupon
        FROM with_cat wc
        LEFT JOIN public.catalog c_same
          ON wc.model_number_norm IS NOT NULL
         AND c_same.model_number IS NOT NULL
         AND upper(btrim(c_same.model_number)) = wc.model_number_norm
         AND COALESCE(NULLIF(lower(btrim(c_same.version)), ''), '') = COALESCE(wc.version_norm, '')
        LEFT JOIN public.listings l
          ON (
            (
              c_same.pci IS NOT NULL
              AND btrim(c_same.pci) <> ''
              AND l.pci IS NOT NULL
              AND btrim(l.pci) <> ''
              AND upper(btrim(l.pci)) = upper(btrim(c_same.pci))
            )
            OR
            (
              c_same.upc IS NOT NULL
              AND btrim(c_same.upc) <> ''
              AND l.upc IS NOT NULL
              AND btrim(l.upc) <> ''
              AND public.norm_upc(l.upc) = public.norm_upc(c_same.upc)
            )
          )
         AND coalesce(nullif(lower(btrim(l.status)), ''), 'active') <> 'hidden'
        GROUP BY wc.key
      ),

      grouped AS (
        SELECT DISTINCT ON (
          COALESCE(NULLIF(btrim(wc.model_number), ''), wc.key),
          lower(btrim(COALESCE(wc.brand, '')))
        )
          wc.key,
          wc.min_price_cents,
          wc.max_price_cents,
          wc.store_count,
          wc.last_seen,
          COALESCE(NULLIF(btrim(wc.model_name), ''), 'Product') AS title,
          wc.brand,
          wc.category,
          wc.image_url,
          COALESCE(cg.has_coupon, false) AS has_coupon
        FROM with_cat wc
        LEFT JOIN coupon_group cg
          ON cg.key = wc.key
        ORDER BY
          COALESCE(NULLIF(btrim(wc.model_number), ''), wc.key),
          lower(btrim(COALESCE(wc.brand, ''))),
          wc.store_count DESC,
          wc.last_seen DESC NULLS LAST
      ),

      scored AS (
        SELECT
          g.*,
          sa.stores,
          (
            ((g.max_price_cents - g.min_price_cents) * g.store_count)
            + CASE WHEN g.last_seen > now() - interval '7 days' THEN 8 ELSE 0 END
          )::int AS score
        FROM grouped g
        LEFT JOIN sa ON sa.key = g.key
        WHERE g.store_count >= 2
          AND g.max_price_cents > g.min_price_cents
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
        COALESCE(has_coupon, false) AS has_coupon,
        COALESCE(stores, ARRAY[]::text[]) AS stores
      FROM scored
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