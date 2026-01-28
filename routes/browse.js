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

function tokenize(q) {
  return String(q || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

// Serve browse page (SPA HTML for all browse paths)
const BROWSE_HTML = path.join(__dirname, "..", "public", "browse", "index.html");

router.get("/browse", (_req, res) => res.redirect(301, "/browse/"));
router.get("/browse/", (_req, res) => res.sendFile(BROWSE_HTML));
router.get("/browse/:q/", (_req, res) => res.sendFile(BROWSE_HTML));
router.get("/browse/:q/page/:n/", (_req, res) => res.sendFile(BROWSE_HTML));

// Helper SQL snippet: normalize version for grouping.
// - Treat NULL/empty as '' so base variants still show
// - Group by lower(trim(version)) ignoring case differences
const VERSION_NORM_SQL = "COALESCE(NULLIF(lower(btrim(c.version)), ''), '')";

// Full-text document for fuzzy-ish multi-word search (order independent)
// (kept for later use)
const FTS_DOC_SQL =
  "to_tsvector('simple', " +
  "coalesce(c.model_name,'') || ' ' || coalesce(c.model_number,'') || ' ' || " +
  "coalesce(c.version,'') || ' ' || coalesce(c.brand,'') || ' ' || coalesce(c.category,'')" +
  ")";

// A stable key even when model_number is missing.
// Uses model_number first, then pci, then normalized upc, then id.
const PRODUCT_KEY_SQL =
  "COALESCE(" +
  "NULLIF(upper(btrim(model_number)), '')," +
  "NULLIF(upper(btrim(pci)), '')," +
  "NULLIF(public.norm_upc(upc), '')," +
  "id::text" +
  ")";

// GET /api/suggest?q=son&limit=8
router.get("/api/suggest", async (req, res) => {
  const q = normText(req.query.q);
   const popular =
    String(req.query.popular || "").trim() === "1" ||
    String(req.query.popular || "").trim().toLowerCase() === "true";
  
  if (!q && !popular) return res.json({ ok: true, q: "", results: [] });

  const limit = clampInt(req.query.limit, 1, 20, 8);
  const half = Math.max(1, Math.ceil(limit / 2));

  const qLower = normLower(q);
  const like = `%${qLower}%`;

  const toks = tokenize(qLower);
  const tokArr = toks.slice(0, 12);

  const client = await pool.connect();
  try {
    // 1) Facets: brand + category
    // Pass 1: prefix/contains via LIKE
  
 if (popular) {
      const popularSql = `
        WITH base AS (
          SELECT
            ${PRODUCT_KEY_SQL} AS product_key,
            COALESCE(NULLIF(lower(btrim(version)), ''), '') AS version_norm,
            brand,
            category
          FROM public.catalog
          WHERE (
            (model_number IS NOT NULL AND btrim(model_number) <> '')
            OR (pci IS NOT NULL AND btrim(pci) <> '')
            OR (upc IS NOT NULL AND btrim(upc) <> '')
          )
        ),
        brand_counts AS (
          SELECT
            MIN(btrim(brand)) AS value,
            COUNT(DISTINCT (product_key || '|' || version_norm))::int AS products
          FROM base
          WHERE brand IS NOT NULL AND btrim(brand) <> ''
          GROUP BY lower(btrim(brand))
          ORDER BY products DESC, value ASC
          LIMIT $1
        ),
        category_counts AS (
          SELECT
            MIN(btrim(category)) AS value,
            COUNT(DISTINCT (product_key || '|' || version_norm))::int AS products
          FROM base
          WHERE category IS NOT NULL AND btrim(category) <> ''
          GROUP BY lower(btrim(category))
          ORDER BY products DESC, value ASC
          LIMIT $2
        )
        SELECT 'category'::text AS kind, value, products FROM category_counts
        UNION ALL
        SELECT 'brand'::text AS kind, value, products FROM brand_counts
      `;

      const r = await client.query(popularSql, [half, limit - half]);
      const results = Array.isArray(r.rows) ? r.rows : [];
      return res.json({ ok: true, q: "", results });
    }

const facetsLikeSql = `
  WITH base AS (
    SELECT
      ${PRODUCT_KEY_SQL} AS product_key,
      COALESCE(NULLIF(lower(btrim(version)), ''), '') AS version_norm,
      brand,
      category
    FROM public.catalog
    WHERE (
      (model_number IS NOT NULL AND btrim(model_number) <> '')
      OR (pci IS NOT NULL AND btrim(pci) <> '')
      OR (upc IS NOT NULL AND btrim(upc) <> '')
    )
  ),
  brand_counts AS (
    SELECT
      lower(btrim(brand)) AS facet_norm,
      MIN(btrim(brand)) AS facet_label,
      COUNT(DISTINCT (product_key || '|' || version_norm))::int AS products
    FROM base
    WHERE brand IS NOT NULL AND btrim(brand) <> ''
      AND lower(btrim(brand)) LIKE $1
    GROUP BY lower(btrim(brand))
    ORDER BY products DESC, facet_label ASC
    LIMIT $2
  ),
  category_counts AS (
    SELECT
      lower(btrim(category)) AS facet_norm,
      MIN(btrim(category)) AS facet_label,
      COUNT(DISTINCT (product_key || '|' || version_norm))::int AS products
    FROM base
    WHERE category IS NOT NULL AND btrim(category) <> ''
      AND lower(btrim(category)) LIKE $1
    GROUP BY lower(btrim(category))
    ORDER BY products DESC, facet_label ASC
    LIMIT $3
  )
  SELECT 'brand'::text AS kind, facet_label AS value, products FROM brand_counts
  UNION ALL
  SELECT 'category'::text AS kind, facet_label AS value, products FROM category_counts
`;

const facetsFuzzySql = `
  WITH base AS (
    SELECT
      ${PRODUCT_KEY_SQL} AS product_key,
      COALESCE(NULLIF(lower(btrim(version)), ''), '') AS version_norm,
      brand,
      category
    FROM public.catalog
    WHERE (
      (model_number IS NOT NULL AND btrim(model_number) <> '')
      OR (pci IS NOT NULL AND btrim(pci) <> '')
      OR (upc IS NOT NULL AND btrim(upc) <> '')
    )
  ),
  brand_counts AS (
    SELECT
      lower(btrim(brand)) AS facet_norm,
      MIN(btrim(brand)) AS facet_label,
      COUNT(DISTINCT (product_key || '|' || version_norm))::int AS products,
      similarity(lower(btrim(brand)), $1) AS sim
    FROM base
    WHERE brand IS NOT NULL AND btrim(brand) <> ''
      AND lower(btrim(brand)) % $1
    GROUP BY lower(btrim(brand))
    ORDER BY sim DESC, products DESC, facet_label ASC
    LIMIT $2
  ),
  category_counts AS (
    SELECT
      lower(btrim(category)) AS facet_norm,
      MIN(btrim(category)) AS facet_label,
      COUNT(DISTINCT (product_key || '|' || version_norm))::int AS products,
      similarity(lower(btrim(category)), $1) AS sim
    FROM base
    WHERE category IS NOT NULL AND btrim(category) <> ''
      AND lower(btrim(category)) % $1
    GROUP BY lower(btrim(category))
    ORDER BY sim DESC, products DESC, facet_label ASC
    LIMIT $3
  )
  SELECT 'brand'::text AS kind, facet_label AS value, products FROM brand_counts
  UNION ALL
  SELECT 'category'::text AS kind, facet_label AS value, products FROM category_counts
`;

let facetRows = [];
{
  const r1 = await client.query(facetsLikeSql, [like, half, half]);
  facetRows = r1.rows || [];
}

// If LIKE returns nothing and query is long enough, do trigram fuzzy
if ((!facetRows || facetRows.length === 0) && qLower.length >= 3) {
  try {
    const r2 = await client.query(facetsFuzzySql, [qLower, half, half]);
    facetRows = r2.rows || [];
  } catch (e) {
    console.warn("fuzzy facets disabled (pg_trgm missing?):", e?.message || e);
  }
}

    // 2) Brand pick: exact token match, then fuzzy token match (pg_trgm similarity)
    const brandPickSql = `
      WITH base AS (
        SELECT
          ${PRODUCT_KEY_SQL} AS product_key,
          COALESCE(NULLIF(lower(btrim(version)), ''), '') AS version_norm,
          btrim(brand) AS brand
        FROM public.catalog
        WHERE (
          (model_number IS NOT NULL AND btrim(model_number) <> '')
          OR (pci IS NOT NULL AND btrim(pci) <> '')
          OR (upc IS NOT NULL AND btrim(upc) <> '')
        )
          AND brand IS NOT NULL AND btrim(brand) <> ''
      ),
      b AS (
        SELECT
          MIN(brand) AS label,
          lower(brand) AS norm,
          COUNT(DISTINCT (product_key || '|' || version_norm))::int AS products
        FROM base
        WHERE lower(brand) = ANY($1::text[])
        GROUP BY lower(brand)
        ORDER BY products DESC, length(lower(brand)) DESC, MIN(brand) ASC
        LIMIT 1
      )
      SELECT label, norm, products FROM b
    `;

    const brandPickFuzzySql = `
  WITH base AS (
    SELECT
      ${PRODUCT_KEY_SQL} AS product_key,
      COALESCE(NULLIF(lower(btrim(version)), ''), '') AS version_norm,
      btrim(brand) AS brand
    FROM public.catalog
    WHERE (
      (model_number IS NOT NULL AND btrim(model_number) <> '')
      OR (pci IS NOT NULL AND btrim(pci) <> '')
      OR (upc IS NOT NULL AND btrim(upc) <> '')
    )
      AND brand IS NOT NULL AND btrim(brand) <> ''
  ),
  scored AS (
    SELECT
      MIN(brand) AS label,
      lower(brand) AS norm,
      COUNT(DISTINCT (product_key || '|' || version_norm))::int AS products,
      MAX(similarity(lower(brand), t)) AS sim
    FROM base
    JOIN unnest($1::text[]) AS t
      ON lower(brand) % t
    GROUP BY lower(brand)
  )
  SELECT label, norm, products
  FROM scored
  WHERE sim >= 0.20
  ORDER BY sim DESC, products DESC, length(norm) DESC, label ASC
  LIMIT 1
`;

    // 3) Category pick: contained-in-query first, then fuzzy token match (pg_trgm similarity)
    const categoryPickSql = `
      WITH base AS (
        SELECT
          ${PRODUCT_KEY_SQL} AS product_key,
          COALESCE(NULLIF(lower(btrim(version)), ''), '') AS version_norm,
          btrim(category) AS category
        FROM public.catalog
        WHERE (
          (model_number IS NOT NULL AND btrim(model_number) <> '')
          OR (pci IS NOT NULL AND btrim(pci) <> '')
          OR (upc IS NOT NULL AND btrim(upc) <> '')
        )
          AND category IS NOT NULL AND btrim(category) <> ''
      ),
      c AS (
        SELECT
          MIN(category) AS label,
          lower(category) AS norm,
          COUNT(DISTINCT (product_key || '|' || version_norm))::int AS products,
          CASE WHEN position(lower(category) in $1) > 0 THEN 1 ELSE 0 END AS in_query,
          length(lower(category)) AS len
        FROM base
        GROUP BY lower(category)
      )
      SELECT label, norm, products
      FROM c
      WHERE in_query = 1
      ORDER BY len DESC, products DESC, label ASC
      LIMIT 1
    `;

    const categoryPickFuzzySql = `
  WITH base AS (
    SELECT
      ${PRODUCT_KEY_SQL} AS product_key,
      COALESCE(NULLIF(lower(btrim(version)), ''), '') AS version_norm,
      btrim(category) AS category
    FROM public.catalog
    WHERE (
      (model_number IS NOT NULL AND btrim(model_number) <> '')
      OR (pci IS NOT NULL AND btrim(pci) <> '')
      OR (upc IS NOT NULL AND btrim(upc) <> '')
    )
      AND category IS NOT NULL AND btrim(category) <> ''
  ),
  scored AS (
    SELECT
      MIN(category) AS label,
      lower(category) AS norm,
      COUNT(DISTINCT (product_key || '|' || version_norm))::int AS products,
      MAX(similarity(lower(category), t)) AS sim,
      length(lower(category)) AS len
    FROM base
    JOIN unnest($1::text[]) AS t
      ON lower(category) % t
    GROUP BY lower(category)
  )
  SELECT label, norm, products
  FROM scored
  WHERE sim >= 0.20
  ORDER BY sim DESC, len DESC, products DESC, label ASC
  LIMIT 1
`;

    let brandHit = null;
    let categoryHit = null;

    if (tokArr.length) {
      const b = (await client.query(brandPickSql, [tokArr])).rows?.[0];
      if (b && b.label) brandHit = b;

      if (!brandHit) {
        try {
          const bf = (await client.query(brandPickFuzzySql, [tokArr])).rows?.[0];
          if (bf && bf.label) brandHit = bf;
        } catch (e) {
          console.warn("fuzzy brand suggest disabled (pg_trgm/similarity missing):", e?.message || e);
        }
      }
    }

    if (qLower.length >= 3) {
      const c = (await client.query(categoryPickSql, [qLower])).rows?.[0];
      if (c && c.label) categoryHit = c;
    }

    if (!categoryHit && tokArr.length) {
      try {
        const cf = (await client.query(categoryPickFuzzySql, [tokArr])).rows?.[0];
        if (cf && cf.label) categoryHit = cf;
      } catch (e) {
        console.warn("fuzzy category suggest disabled (pg_trgm/similarity missing):", e?.message || e);
      }
    }

    // Combo count only if we have both
    let comboItem = null;
    if (brandHit && categoryHit) {
      const comboCountSql = `
        WITH base AS (
          SELECT DISTINCT
            ${PRODUCT_KEY_SQL} AS product_key,
            COALESCE(NULLIF(lower(btrim(version)), ''), '') AS version_norm
          FROM public.catalog
          WHERE (
            (model_number IS NOT NULL AND btrim(model_number) <> '')
            OR (pci IS NOT NULL AND btrim(pci) <> '')
            OR (upc IS NOT NULL AND btrim(upc) <> '')
          )
            AND brand IS NOT NULL AND btrim(brand) <> ''
            AND category IS NOT NULL AND btrim(category) <> ''
            AND lower(btrim(brand)) = lower(btrim($1))
            AND lower(btrim(category)) = lower(btrim($2))
        )
        SELECT COUNT(*)::int AS products FROM base
      `;

      const comboProducts =
        (await client.query(comboCountSql, [brandHit.label, categoryHit.label])).rows?.[0]?.products ?? 0;

      if (comboProducts > 0) {
        comboItem = {
          kind: "combo",
          value: `${brandHit.label} ${categoryHit.label}`,
          brand: brandHit.label,
          category: categoryHit.label,
          products: comboProducts,
          href: `/browse/?brand=${encodeURIComponent(brandHit.label)}&category=${encodeURIComponent(
            categoryHit.label
          )}`,
        };
      }
    }

    const facetResults = (facetRows || []).sort((a, b) => {
  const ap = Number(a.products || 0);
  const bp = Number(b.products || 0);
  if (bp !== ap) return bp - ap;
  if (a.kind !== b.kind) return a.kind === "brand" ? -1 : 1;
  return String(a.value || "").localeCompare(String(b.value || ""));
  });

    const merged = [];
    if (comboItem) merged.push(comboItem);
    for (const r of facetResults) merged.push(r);

    const seen = new Set();
    const results = merged
      .filter((it) => {
        const k = `${String(it.kind)}::${String(it.value || "").toLowerCase()}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .slice(0, limit);

    return res.json({ ok: true, q, results });
  } catch (e) {
    console.error("suggest error:", e);
    return res.status(500).json({ ok: false, error: "server_error" });
  } finally {
    client.release();
  }
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
    // NOTE: "products" now means "variants" (distinct model_number + version)
    const facetSql = `
      WITH b AS (
        SELECT
          MIN(btrim(brand)) AS label,
          COUNT(DISTINCT (
            upper(btrim(model_number)) || '|' ||
            COALESCE(NULLIF(lower(btrim(version)), ''), '')
          ))::int AS products
        FROM public.catalog
        WHERE model_number IS NOT NULL AND btrim(model_number) <> ''
          AND brand IS NOT NULL AND btrim(brand) <> ''
          AND lower(btrim(brand)) = $1
      ),
      c AS (
        SELECT
          MIN(btrim(category)) AS label,
          COUNT(DISTINCT (
            upper(btrim(model_number)) || '|' ||
            COALESCE(NULLIF(lower(btrim(version)), ''), '')
          ))::int AS products
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

    async function fetchFacet(type, value) {
      const countSql = `
        WITH base AS (
          SELECT DISTINCT
            upper(btrim(model_number)) AS model_number,
            COALESCE(NULLIF(lower(btrim(version)), ''), '') AS version_norm
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
          SELECT DISTINCT ON (
            upper(btrim(c.model_number)),
            ${VERSION_NORM_SQL}
          )
            upper(btrim(c.model_number)) AS model_number,
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
            AND (
              ($1 = 'brand' AND lower(btrim(c.brand)) = lower(btrim($2)))
              OR
              ($1 = 'category' AND lower(btrim(c.category)) = lower(btrim($2)))
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
          ORDER BY brand NULLS LAST, category NULLS LAST, model_name NULLS LAST, model_number, version_norm
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
            a.version_norm,
            MIN(l.current_price_cents) FILTER (WHERE l.current_price_cents IS NOT NULL) AS best_price_cents
          FROM anchors a
          LEFT JOIN public.catalog c
            ON upper(btrim(c.model_number)) = a.model_number
           AND COALESCE(NULLIF(lower(btrim(c.version)), ''), '') = a.version_norm
          LEFT JOIN public.listings l
            ON (
              (c.pci IS NOT NULL AND btrim(c.pci) <> '' AND l.pci IS NOT NULL AND btrim(l.pci) <> '' AND upper(btrim(l.pci)) = upper(btrim(c.pci)))
              OR
              (c.upc IS NOT NULL AND btrim(c.upc) <> '' AND l.upc IS NOT NULL AND btrim(l.upc) <> '' AND public.norm_upc(l.upc) = public.norm_upc(c.upc))
            )
          GROUP BY a.model_number, a.version_norm
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
          ON ch.model_number = a.model_number
         AND ch.version_norm = a.version_norm
        ORDER BY a.brand NULLS LAST, a.category NULLS LAST, a.model_name NULLS LAST, a.model_number, a.version_norm
      `;

      const { rows } = await client.query(listSql, [type, value, limit, offset]);

      return {
        total,
        pages: Math.max(1, Math.ceil(total / limit)),
        results: rows || [],
      };
    }

    if (brandProducts > 0 || categoryProducts > 0) {
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

    // 3) Fallback: product search in catalog.model_name + model_number + version
    const countSql = `
      WITH base AS (
        SELECT DISTINCT
          upper(btrim(model_number)) AS model_number,
          COALESCE(NULLIF(lower(btrim(version)), ''), '') AS version_norm
        FROM public.catalog
        WHERE model_number IS NOT NULL AND btrim(model_number) <> ''
          AND (
            lower(coalesce(model_name,'')) LIKE $1
            OR lower(coalesce(model_number,'')) LIKE $1
            OR lower(coalesce(version,'')) LIKE $1
          )
      )
      SELECT COUNT(*)::int AS total
      FROM base
    `;
    const total = (await client.query(countSql, [like])).rows?.[0]?.total ?? 0;

    const listSql = `
      WITH picked AS (
        SELECT DISTINCT ON (
          upper(btrim(c.model_number)),
          ${VERSION_NORM_SQL}
        )
          upper(btrim(c.model_number)) AS model_number,
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
          AND (
            lower(coalesce(c.model_name,'')) LIKE $1
            OR lower(coalesce(c.model_number,'')) LIKE $1
            OR lower(coalesce(c.version,'')) LIKE $1
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
        ORDER BY brand NULLS LAST, category NULLS LAST, model_name NULLS LAST, model_number, version_norm
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
          a.version_norm,
          MIN(l.current_price_cents) FILTER (WHERE l.current_price_cents IS NOT NULL) AS best_price_cents
        FROM anchors a
        LEFT JOIN public.catalog c
          ON upper(btrim(c.model_number)) = a.model_number
         AND COALESCE(NULLIF(lower(btrim(c.version)), ''), '') = a.version_norm
        LEFT JOIN public.listings l
          ON (
            (c.pci IS NOT NULL AND btrim(c.pci) <> '' AND l.pci IS NOT NULL AND btrim(l.pci) <> '' AND upper(btrim(l.pci)) = upper(btrim(c.pci)))
            OR
            (c.upc IS NOT NULL AND btrim(c.upc) <> '' AND l.upc IS NOT NULL AND btrim(l.upc) <> '' AND public.norm_upc(l.upc) = public.norm_upc(c.upc))
          )
        GROUP BY a.model_number, a.version_norm
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
        ON ch.model_number = a.model_number
       AND ch.version_norm = a.version_norm
      ORDER BY a.brand NULLS LAST, a.category NULLS LAST, a.model_name NULLS LAST, a.model_number, a.version_norm
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
          upper(btrim(model_number)) AS model_number,
          COALESCE(NULLIF(lower(btrim(version)), ''), '') AS version_norm
        FROM public.catalog
        WHERE model_number IS NOT NULL AND btrim(model_number) <> ''
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
    const total = (await client.query(countSql, [type, value, brand, category])).rows?.[0]?.total ?? 0;

    const listSql = `
      WITH picked AS (
        SELECT DISTINCT ON (
          upper(btrim(c.model_number)),
          ${VERSION_NORM_SQL}
        )
          upper(btrim(c.model_number)) AS model_number,
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
        ORDER BY brand NULLS LAST, category NULLS LAST, model_name NULLS LAST, model_number, version_norm
        LIMIT $5 OFFSET $6
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
          a.version_norm,
          MIN(l.current_price_cents) FILTER (WHERE l.current_price_cents IS NOT NULL) AS best_price_cents
        FROM anchors a
        LEFT JOIN public.catalog c
          ON upper(btrim(c.model_number)) = a.model_number
         AND COALESCE(NULLIF(lower(btrim(c.version)), ''), '') = a.version_norm
        LEFT JOIN public.listings l
          ON (
            (c.pci IS NOT NULL AND btrim(c.pci) <> '' AND l.pci IS NOT NULL AND btrim(l.pci) <> '' AND upper(btrim(l.pci)) = upper(btrim(c.pci)))
            OR
            (c.upc IS NOT NULL AND btrim(c.upc) <> '' AND l.upc IS NOT NULL AND btrim(l.upc) <> '' AND public.norm_upc(l.upc) = public.norm_upc(c.upc))
          )
        GROUP BY a.model_number, a.version_norm
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
        ON ch.model_number = a.model_number
       AND ch.version_norm = a.version_norm
      ORDER BY a.brand NULLS LAST, a.category NULLS LAST, a.model_name NULLS LAST, a.model_number, a.version_norm
    `;

    const { rows } = await client.query(listSql, [type, value, brand, category, limit, offset]);

    res.json({
      ok: true,
      type,
      value,
      brand: hasBrand ? brand : "",
      category: hasCategory ? category : "",
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
          COUNT(DISTINCT (model_number || '|' || version_norm))::int AS products
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