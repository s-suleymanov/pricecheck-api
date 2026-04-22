const express = require("express");
const crypto  = require("crypto");
const pool    = require("../db");
const router  = express.Router();

// In-memory response cache
const CACHE = new Map();
const CACHE_TTL = 5 * 60 * 1000;
const CACHE_MAX = 300;

function cacheGet(k) {
  const h = CACHE.get(k);
  if (!h) return null;
  if (Date.now() - h.t > CACHE_TTL) {
    CACHE.delete(k);
    return null;
  }
  return h.v;
}

function cacheSet(k, v) {
  if (CACHE.size >= CACHE_MAX) CACHE.delete(CACHE.keys().next().value);
  CACHE.set(k, { t: Date.now(), v });
}

// Brand to category inference
const BRAND_TO_CATS = {
  apple: ["laptop","laptops","computer","computers","tablet","tablets","phone","phones","headphones","smartwatch","monitor"],
  samsung: ["phone","phones","tv","television","monitor","tablet","tablets","headphones","speaker"],
  sony: ["headphones","tv","television","camera","speaker","monitor","phone","phones"],
  lg: ["tv","television","monitor","oled","appliance","phone"],
  dell: ["laptop","laptops","monitor","computer","computers","desktop"],
  hp: ["laptop","laptops","printer","monitor","computer","computers","desktop"],
  lenovo: ["laptop","laptops","computer","computers","tablet","tablets","monitor"],
  asus: ["laptop","laptops","monitor","computer","computers","router","phone"],
  microsoft: ["laptop","laptops","tablet","tablets","computer","computers","keyboard","mouse","controller"],
  bose: ["headphones","speaker","earbuds"],
  jbl: ["speaker","headphones","earbuds"],
  logitech: ["mouse","keyboard","webcam","speaker","headset","controller"],
  nikon: ["camera","lens"],
  canon: ["camera","printer","lens"],
  dyson: ["vacuum","appliance","air purifier","hair"],
  shark: ["vacuum","robot vacuum","appliance"],
  irobot: ["robot vacuum","vacuum"],
  nintendo: ["gaming","console","controller","game"],
  "turtle beach": ["headset","headphones","gaming"],
};

const CAT_TO_BRANDS = {};
for (const [brand, cats] of Object.entries(BRAND_TO_CATS)) {
  for (const cat of cats) {
    if (!CAT_TO_BRANDS[cat]) CAT_TO_BRANDS[cat] = [];
    CAT_TO_BRANDS[cat].push(brand);
  }
}

const KEYWORD_INFER = {
  macbook: { brands: ["apple"], cats: ["laptop","laptops","computer"] },
  imac: { brands: ["apple"], cats: ["computer","computers","desktop","monitor"] },
  ipad: { brands: ["apple"], cats: ["tablet","tablets"] },
  iphone: { brands: ["apple"], cats: ["phone","phones"] },
  airpods: { brands: ["apple"], cats: ["headphones","earbuds"] },
  "apple watch": { brands: ["apple"], cats: ["smartwatch"] },
  galaxy: { brands: ["samsung"], cats: ["phone","phones","tablet"] },
  odyssey: { brands: ["samsung"], cats: ["monitor","gaming"] },
  surface: { brands: ["microsoft"], cats: ["laptop","laptops","tablet"] },
  xps: { brands: ["dell"], cats: ["laptop","laptops"] },
  thinkpad: { brands: ["lenovo"], cats: ["laptop","laptops"] },
  roomba: { brands: ["irobot"], cats: ["robot vacuum","vacuum"] },
  playstation: { brands: [], cats: ["gaming","console"] },
  ps5: { brands: [], cats: ["gaming","console"] },
  xbox: { brands: ["microsoft"], cats: ["gaming","console","controller"] },
};

// Auth
function hashToken(t) {
  return crypto.createHash("sha256").update(String(t)).digest("hex");
}

async function maybeGetUserId(req) {
  try {
    const raw = String(req.cookies?.pc_session || "").trim();
    if (!raw) return null;

    const q = await pool.query(
      `SELECT u.id
       FROM public.user_sessions s
       JOIN public.users u ON u.id = s.user_id
       WHERE s.session_token_hash = $1
         AND s.revoked_at IS NULL
         AND s.expires_at > now()
         AND u.is_active = true
       LIMIT 1`,
      [hashToken(raw)]
    );

    return q.rows[0]?.id ?? null;
  } catch (_) {
    return null;
  }
}

// Helpers
function clampInt(v, lo, hi, fb) {
  const n = Number.parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : fb;
}

function safeArr(arr, max) {
  if (!Array.isArray(arr)) return [];
  return arr.map(x => String(x || "").trim().toLowerCase()).filter(Boolean).slice(0, max);
}

function kwRegex(kws) {
  if (!kws?.length) return null;
  return kws.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
}

function uniq(arr) {
  return [...new Set(arr)];
}

// Cross-signal expansion
function expandSignals(brands, cats, kws) {
  const eBrands = new Set(brands);
  const eCats = new Set(cats);

  for (const kw of kws) {
    const inf = KEYWORD_INFER[kw];
    if (inf) {
      inf.brands.forEach(b => eBrands.add(b));
      inf.cats.forEach(c => eCats.add(c));
    }

    for (const [key, inf2] of Object.entries(KEYWORD_INFER)) {
      if (kw.includes(key) || key.includes(kw)) {
        inf2.brands.forEach(b => eBrands.add(b));
        inf2.cats.forEach(c => eCats.add(c));
      }
    }
  }

  for (const b of brands) {
    const inferredCats = BRAND_TO_CATS[b] || [];
    inferredCats.slice(0, 4).forEach(c => eCats.add(c));
  }

  for (const c of cats) {
    const inferredBrands = CAT_TO_BRANDS[c] || [];
    inferredBrands.slice(0, 3).forEach(b => eBrands.add(b));
  }

  return {
    brands: uniq([...eBrands]).slice(0, 15),
    cats: uniq([...eCats]).slice(0, 15),
  };
}

router.post("/api/home_feed", async (req, res) => {
  const limit  = clampInt(req.body?.limit, 6, 100, 24);
  const offset = clampInt(req.body?.offset, 0, 5e6, 0);

  const sig       = req.body?.signals || {};
  const rawBrands = safeArr(sig.brands, 10);
  const rawCats   = safeArr(sig.categories, 10);
  const rawKws    = safeArr(sig.keywords, 20);
  const excl      = offset > 0 ? safeArr(req.body?.exclude_keys, 1000) : [];

  const { brands: expBrands, cats: expCats } = expandSignals(rawBrands, rawCats, rawKws);
  const kwr    = kwRegex(rawKws);
  const hasSig = rawBrands.length > 0 || rawCats.length > 0 || rawKws.length > 0;

  const pageNum           = Math.floor(offset / limit);
  const brandDiversityCap = pageNum < 2 ? 4 : pageNum < 5 ? 6 : 12;

  const userId = await maybeGetUserId(req);
  let followed = [];

  if (userId) {
    try {
      const fq = await pool.query(
        `SELECT lower(btrim(entity_key)) AS b
         FROM public.user_follows
         WHERE user_id = $1
           AND entity_type = 'brand'
         LIMIT 50`,
        [userId]
      );

      followed = fq.rows.map(r => r.b).filter(Boolean);

      for (const b of followed) {
        const fc = BRAND_TO_CATS[b] || [];
        fc.slice(0, 3).forEach(c => {
          if (!expCats.includes(c)) expCats.push(c);
        });
      }
    } catch (_) {}
  }

  const cacheKey = crypto.createHash("sha1").update(JSON.stringify({
    expBrands,
    expCats,
    rawKws,
    excl,
    followed,
    limit,
    offset
  })).digest("hex");

  const cached = cacheGet(cacheKey);
  if (cached) return res.json(cached);

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

      rec_exact AS (
        SELECT DISTINCT ON (key)
          key,
          overall_score
        FROM (
          SELECT
            'pci:' || upper(btrim(pr.pci)) AS key,
            pr.overall_score,
            pr.updated_at,
            pr.id
          FROM public.product_recommendations pr
          WHERE pr.pci IS NOT NULL
            AND btrim(pr.pci) <> ''

          UNION ALL

          SELECT
            'upc:' || btrim(pr.upc) AS key,
            pr.overall_score,
            pr.updated_at,
            pr.id
          FROM public.product_recommendations pr
          WHERE pr.upc IS NOT NULL
            AND btrim(pr.upc) <> ''
        ) r
        ORDER BY key, updated_at DESC NULLS LAST, id DESC
      ),

      rec_family AS (
        SELECT DISTINCT ON (model_number_norm, version_norm)
          model_number_norm,
          version_norm,
          overall_score
        FROM (
          SELECT
            upper(btrim(c_same.model_number)) AS model_number_norm,
            COALESCE(NULLIF(lower(btrim(c_same.version)), ''), '') AS version_norm,
            pr.overall_score,
            pr.updated_at,
            pr.id
          FROM public.catalog c_same
          JOIN public.product_recommendations pr
            ON (
              (
                pr.pci IS NOT NULL
                AND btrim(pr.pci) <> ''
                AND c_same.pci IS NOT NULL
                AND btrim(c_same.pci) <> ''
                AND upper(btrim(pr.pci)) = upper(btrim(c_same.pci))
              )
              OR
              (
                pr.upc IS NOT NULL
                AND btrim(pr.upc) <> ''
                AND c_same.upc IS NOT NULL
                AND btrim(c_same.upc) <> ''
                AND public.norm_upc(pr.upc) = public.norm_upc(c_same.upc)
              )
            )
          WHERE c_same.model_number IS NOT NULL
            AND btrim(c_same.model_number) <> ''
        ) rf
        ORDER BY model_number_norm, version_norm, updated_at DESC NULLS LAST, id DESC
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
        WHERE cardinality($6::text[]) = 0 OR a.key != ALL($6::text[])
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
          wc.model_number_norm,
          wc.version_norm,
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
          COALESCE(rex.overall_score, rf.overall_score) AS overall_score,
          (
            CASE WHEN cardinality($4::text[]) > 0
              AND lower(btrim(COALESCE(g.brand,''))) = ANY($4::text[])
            THEN 60 ELSE 0 END
            + CASE WHEN cardinality($1::text[]) > 0
              AND lower(btrim(COALESCE(g.brand,''))) = ANY($1::text[])
            THEN 35 ELSE 0 END
            + CASE WHEN cardinality($2::text[]) > 0
              AND lower(btrim(COALESCE(g.brand,''))) = ANY($2::text[])
            THEN 30 ELSE 0 END
            + CASE WHEN cardinality($3::text[]) > 0
              AND lower(btrim(COALESCE(g.category,''))) = ANY($3::text[])
            THEN 25 ELSE 0 END
            + CASE WHEN cardinality($5::text[]) > 0
              AND lower(btrim(COALESCE(g.category,''))) = ANY($5::text[])
            THEN 18 ELSE 0 END
            + CASE WHEN $7::text IS NOT NULL AND (
                lower(COALESCE(g.title,'')) ~ $7
                OR lower(COALESCE(g.brand,'')) ~ $7
                OR lower(COALESCE(g.category,'')) ~ $7
              ) THEN 15 ELSE 0 END
            + CASE WHEN g.last_seen > now() - interval '7 days' THEN 8 ELSE 0 END
            + g.store_count
          )::int AS score
        FROM grouped g
        LEFT JOIN sa
          ON sa.key = g.key
        LEFT JOIN rec_exact rex
          ON rex.key = g.key
        LEFT JOIN rec_family rf
          ON rf.model_number_norm = g.model_number_norm
         AND rf.version_norm = COALESCE(g.version_norm, '')
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
        overall_score,
        COALESCE(has_coupon, false) AS has_coupon,
        COALESCE(stores, ARRAY[]::text[]) AS stores
      FROM scored
      ORDER BY score DESC, store_count DESC, last_seen DESC NULLS LAST
      LIMIT $8 OFFSET $9
    `;

    const params = [
      rawBrands,
      expBrands,
      rawCats,
      followed,
      expCats,
      excl,
      kwr,
      limit,
      offset,
    ];

    const { rows } = await client.query(sql, params);

    const bc = {};
    const results = rows.filter(r => {
      if (!r.brand) return true;
      const b = r.brand.toLowerCase();
      bc[b] = (bc[b] || 0) + 1;
      return bc[b] <= brandDiversityCap;
    });

    let finalResults = results;

    if (results.length < limit) {
      const resultKeys = new Set(results.map(r => r.key));
      const padExcl = uniq([...excl, ...resultKeys]);

      try {
        const padSql = `
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

          rec_exact AS (
            SELECT DISTINCT ON (key)
              key,
              overall_score
            FROM (
              SELECT
                'pci:' || upper(btrim(pr.pci)) AS key,
                pr.overall_score,
                pr.updated_at,
                pr.id
              FROM public.product_recommendations pr
              WHERE pr.pci IS NOT NULL
                AND btrim(pr.pci) <> ''

              UNION ALL

              SELECT
                'upc:' || btrim(pr.upc) AS key,
                pr.overall_score,
                pr.updated_at,
                pr.id
              FROM public.product_recommendations pr
              WHERE pr.upc IS NOT NULL
                AND btrim(pr.upc) <> ''
            ) r
            ORDER BY key, updated_at DESC NULLS LAST, id DESC
          ),

          rec_family AS (
            SELECT DISTINCT ON (model_number_norm, version_norm)
              model_number_norm,
              version_norm,
              overall_score
            FROM (
              SELECT
                upper(btrim(c_same.model_number)) AS model_number_norm,
                COALESCE(NULLIF(lower(btrim(c_same.version)), ''), '') AS version_norm,
                pr.overall_score,
                pr.updated_at,
                pr.id
              FROM public.catalog c_same
              JOIN public.product_recommendations pr
                ON (
                  (
                    pr.pci IS NOT NULL
                    AND btrim(pr.pci) <> ''
                    AND c_same.pci IS NOT NULL
                    AND btrim(c_same.pci) <> ''
                    AND upper(btrim(pr.pci)) = upper(btrim(c_same.pci))
                  )
                  OR
                  (
                    pr.upc IS NOT NULL
                    AND btrim(pr.upc) <> ''
                    AND c_same.upc IS NOT NULL
                    AND btrim(c_same.upc) <> ''
                    AND public.norm_upc(pr.upc) = public.norm_upc(c_same.upc)
                  )
                )
              WHERE c_same.model_number IS NOT NULL
                AND btrim(c_same.model_number) <> ''
            ) rf
            ORDER BY model_number_norm, version_norm, updated_at DESC NULLS LAST, id DESC
          ),

          wc AS (
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
            WHERE cardinality($1::text[]) = 0 OR a.key != ALL($1::text[])
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
            FROM wc
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

          g AS (
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
              wc.model_number_norm,
              wc.version_norm,
              COALESCE(cg.has_coupon, false) AS has_coupon
            FROM wc
            LEFT JOIN coupon_group cg
              ON cg.key = wc.key
            ORDER BY
              COALESCE(NULLIF(btrim(wc.model_number), ''), wc.key),
              lower(btrim(COALESCE(wc.brand, ''))),
              wc.store_count DESC,
              wc.last_seen DESC NULLS LAST
          )

          SELECT
            g.*,
            COALESCE(rex.overall_score, rf.overall_score) AS overall_score,
            COALESCE(sa.stores, ARRAY[]::text[]) AS stores,
            store_count AS score
          FROM g
          LEFT JOIN sa
            ON sa.key = g.key
          LEFT JOIN rec_exact rex
            ON rex.key = g.key
          LEFT JOIN rec_family rf
            ON rf.model_number_norm = g.model_number_norm
           AND rf.version_norm = COALESCE(g.version_norm, '')
          ORDER BY store_count DESC, last_seen DESC NULLS LAST
          LIMIT $2
        `;

        const { rows: padRows } = await client.query(padSql, [padExcl, limit - results.length]);
        finalResults = [...results, ...padRows];
      } catch (_) {}
    }

    const payload = {
      ok: true,
      limit,
      offset,
      has_signals: hasSig,
      results: finalResults
    };

    cacheSet(cacheKey, payload);
    return res.json(payload);
  } catch (err) {
    console.error("home_feed error:", err);
    return res.status(500).json({ ok: false, error: "server_error" });
  } finally {
    client.release();
  }
});

module.exports = router;