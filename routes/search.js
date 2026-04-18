// routes/search.js
const path = require("path");
const express = require("express");
const pool = require("../db");

const router = express.Router();
const MAX_Q_LEN = 120;

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

// Helper SQL snippet: normalize version for grouping.
const VERSION_NORM_SQL = "COALESCE(NULLIF(lower(btrim(c.version)), ''), '')";

// A stable key even when model_number is missing.
const PRODUCT_KEY_SQL =
  "COALESCE(" +
  "NULLIF(upper(btrim(model_number)), '')," +
  "NULLIF(upper(btrim(pci)), '')," +
  "NULLIF(public.norm_upc(upc), '')," +
  "id::text" +
  ")";

async function didYouMeanForQuery(client, qLower) {
  const q = normLower(qLower);
  if (!q || q.length < 2) return null;

  const toks = tokenize(q);
  const allowCombo = toks.length >= 2;

  try {
    if (allowCombo) {
      const comboSql = `
        WITH base AS (
          SELECT
            ${PRODUCT_KEY_SQL} AS product_key,
            COALESCE(NULLIF(lower(btrim(version)), ''), '') AS version_norm,
            btrim(brand) AS brand,
            btrim(category) AS category
          FROM public.catalog
          WHERE (
            (model_number IS NOT NULL AND btrim(model_number) <> '')
            OR (pci IS NOT NULL AND btrim(pci) <> '')
            OR (upc IS NOT NULL AND btrim(upc) <> '')
          )
            AND brand IS NOT NULL AND btrim(brand) <> ''
            AND category IS NOT NULL AND btrim(category) <> ''
        ),
        combos AS (
          SELECT
            MIN(brand) AS brand_label,
            MIN(category) AS category_label,
            COUNT(DISTINCT (product_key || '|' || version_norm))::int AS products,
            similarity(lower(MIN(brand) || ' ' || MIN(category)), $1) AS sim
          FROM base
          GROUP BY lower(brand), lower(category)
        )
        SELECT brand_label, category_label, products, sim
        FROM combos
        WHERE sim >= 0.24
        ORDER BY sim DESC, products DESC, brand_label ASC, category_label ASC
        LIMIT 1
      `;

      const comboRow = (await client.query(comboSql, [q])).rows?.[0];
      if (comboRow?.brand_label && comboRow?.category_label) {
        const href =
          `/browse/?brand=${encodeURIComponent(comboRow.brand_label)}` +
          `&category=${encodeURIComponent(comboRow.category_label)}`;

        return {
          kind: "combo",
          value: `${comboRow.brand_label} ${comboRow.category_label}`,
          brand: comboRow.brand_label,
          category: comboRow.category_label,
          href,
        };
      }
    }

    const brandSql = `
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
      brands AS (
        SELECT
          MIN(brand) AS label,
          COUNT(DISTINCT (product_key || '|' || version_norm))::int AS products,
          similarity(lower(MIN(brand)), $1) AS sim
        FROM base
        GROUP BY lower(brand)
      )
      SELECT label, products, sim
      FROM brands
      WHERE sim >= 0.26
      ORDER BY sim DESC, products DESC, label ASC
      LIMIT 1
    `;

    const brandRow = (await client.query(brandSql, [q])).rows?.[0];
    if (brandRow?.label) {
      return {
        kind: "brand",
        value: brandRow.label,
        href: `/browse/?brand=${encodeURIComponent(brandRow.label)}`,
      };
    }

    const catSql = `
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
      cats AS (
        SELECT
          MIN(category) AS label,
          COUNT(DISTINCT (product_key || '|' || version_norm))::int AS products,
          similarity(lower(MIN(category)), $1) AS sim
        FROM base
        GROUP BY lower(category)
      )
      SELECT label, products, sim
      FROM cats
      WHERE sim >= 0.26
      ORDER BY sim DESC, products DESC, label ASC
      LIMIT 1
    `;

    const catRow = (await client.query(catSql, [q])).rows?.[0];
    if (catRow?.label) {
      return {
        kind: "category",
        value: catRow.label,
        href: `/browse/?category=${encodeURIComponent(catRow.label)}`,
      };
    }

    return null;
  } catch (e) {
    console.warn("did_you_mean disabled (pg_trgm missing?):", e?.message || e);
    return null;
  }
}

// Serve search page (SPA HTML for all search paths)
const SEARCH_HTML = path.join(__dirname, "..", "public", "search", "index.html");

router.get("/search", (_req, res) => res.redirect(301, "/search/"));
router.get("/search/", (_req, res) => res.sendFile(SEARCH_HTML));
router.get("/search/*", (_req, res) => res.sendFile(SEARCH_HTML));

router.get("/api/suggest", async (req, res) => {
  res.set("Cache-Control", "no-store");

  const q = normText(req.query.q).slice(0, MAX_Q_LEN);
  const popular =
    String(req.query.popular || "").trim() === "1" ||
    String(req.query.popular || "").trim().toLowerCase() === "true";

  if (!q && !popular) return res.json({ ok: true, q: "", results: [] });

  const limit = clampInt(req.query.limit, 1, 20, 8);

  const qLower = normLower(q);
  const toks = tokenize(qLower);
  const tokArr = toks;
  const likeLoose = toks.length ? `%${toks.join("%")}%` : `%${qLower}%`;

  const client = await pool.connect();
  try {
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
            'brand'::text AS kind,
            MIN(btrim(brand)) AS value,
            COUNT(DISTINCT (product_key || '|' || version_norm))::int AS products
          FROM base
          WHERE brand IS NOT NULL AND btrim(brand) <> ''
          GROUP BY lower(btrim(brand))
        ),
        category_counts AS (
          SELECT
            'category'::text AS kind,
            MIN(btrim(category)) AS value,
            COUNT(DISTINCT (product_key || '|' || version_norm))::int AS products
          FROM base
          WHERE category IS NOT NULL AND btrim(category) <> ''
          GROUP BY lower(btrim(category))
        )
        SELECT kind, value, products
        FROM (
          SELECT * FROM brand_counts
          UNION ALL
          SELECT * FROM category_counts
        ) ranked
        ORDER BY products DESC, kind ASC, value ASC
        LIMIT $1
      `;

      const r = await client.query(popularSql, [limit]);
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
          'brand'::text AS kind,
          lower(btrim(brand)) AS facet_norm,
          MIN(btrim(brand)) AS value,
          COUNT(DISTINCT (product_key || '|' || version_norm))::int AS products
        FROM base
        WHERE brand IS NOT NULL AND btrim(brand) <> ''
          AND lower(btrim(brand)) LIKE $1
        GROUP BY lower(btrim(brand))
      ),
      category_counts AS (
        SELECT
          'category'::text AS kind,
          lower(btrim(category)) AS facet_norm,
          MIN(btrim(category)) AS value,
          COUNT(DISTINCT (product_key || '|' || version_norm))::int AS products
        FROM base
        WHERE category IS NOT NULL AND btrim(category) <> ''
          AND lower(btrim(category)) LIKE $1
        GROUP BY lower(btrim(category))
      )
      SELECT kind, value, products
      FROM (
        SELECT * FROM brand_counts
        UNION ALL
        SELECT * FROM category_counts
      ) ranked
      ORDER BY products DESC, kind ASC, value ASC
      LIMIT $2
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
          'brand'::text AS kind,
          lower(btrim(brand)) AS facet_norm,
          MIN(btrim(brand)) AS value,
          COUNT(DISTINCT (product_key || '|' || version_norm))::int AS products,
          similarity(lower(btrim(brand)), $1) AS sim
        FROM base
        WHERE brand IS NOT NULL AND btrim(brand) <> ''
          AND lower(btrim(brand)) % $1
        GROUP BY lower(btrim(brand))
      ),
      category_counts AS (
        SELECT
          'category'::text AS kind,
          lower(btrim(category)) AS facet_norm,
          MIN(btrim(category)) AS value,
          COUNT(DISTINCT (product_key || '|' || version_norm))::int AS products,
          similarity(lower(btrim(category)), $1) AS sim
        FROM base
        WHERE category IS NOT NULL AND btrim(category) <> ''
          AND lower(btrim(category)) % $1
        GROUP BY lower(btrim(category))
      )
      SELECT kind, value, products
      FROM (
        SELECT * FROM brand_counts
        UNION ALL
        SELECT * FROM category_counts
      ) ranked
      ORDER BY sim DESC, products DESC, kind ASC, value ASC
      LIMIT $2
    `;

    const modelsSql = `
  WITH picked AS (
    SELECT DISTINCT ON (
      upper(btrim(c.model_number)),
      COALESCE(NULLIF(lower(btrim(c.version)), ''), '')
    )
      c.model_name,
      btrim(c.model_number) AS model_number,
      upper(btrim(c.model_number)) AS model_number_norm,
      COALESCE(NULLIF(lower(btrim(c.version)), ''), '') AS version_norm,
      btrim(c.brand) AS brand,
      btrim(c.category) AS category,
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
      COALESCE(NULLIF(lower(btrim(c.version)), ''), ''),
      c.created_at DESC NULLS LAST,
      c.id DESC
  )
  SELECT
    btrim(model_number) AS value,
    pci,
    upc,
    brand,
    category
  FROM picked
  ORDER BY value ASC
  LIMIT $2
`;

    let facetRows = [];
    {
      const r1 = await client.query(facetsLikeSql, [likeLoose, limit]);
      facetRows = r1.rows || [];
    }

    if ((!facetRows || facetRows.length === 0) && qLower.length >= 3) {
      try {
        const r2 = await client.query(facetsFuzzySql, [qLower, limit]);
        facetRows = r2.rows || [];
      } catch (e) {
        console.warn("fuzzy facets disabled (pg_trgm missing?):", e?.message || e);
      }
    }

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

    let modelResults = [];

  if (qLower.length >= 2) {
    const mr = await client.query(modelsSql, [likeLoose, limit]);
    const rows = Array.isArray(mr.rows) ? mr.rows : [];

    modelResults = rows
      .filter((r) => r && r.value)
      .map((r) => {
        const pci = String(r.pci || "").trim();
        const upc = String(r.upc || "").trim();

        let href = null;
        if (pci) href = `/dashboard/pci/${encodeURIComponent(pci)}/`;
        else if (upc) href = `/dashboard/upc/${encodeURIComponent(upc.replace(/\D/g, ""))}/`;

        return {
          kind: "family",
          value: String(r.value || "").trim(),
          products: 0,
          href,
        };
      });
  }

    const merged = [];
  if (comboItem) merged.push(comboItem);
  for (const r of facetResults) merged.push(r);
  for (const r of modelResults) merged.push(r);

  merged.sort((a, b) => {
    const ap = Number(a.products || 0);
    const bp = Number(b.products || 0);
    if (bp !== ap) return bp - ap;

    const aKind = String(a.kind || "");
    const bKind = String(b.kind || "");
    const kindRank = { combo: 0, brand: 1, category: 2, family: 3 };
    const ak = kindRank[aKind] ?? 99;
    const bk = kindRank[bKind] ?? 99;
    if (ak !== bk) return ak - bk;

    return String(a.value || "").localeCompare(String(b.value || ""));
  });

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
  res.set("Cache-Control", "no-store");

  const q = normText(req.query.q).slice(0, MAX_Q_LEN);
  if (!q) return res.status(400).json({ ok: false, error: "q is required" });

  const page = clampInt(req.query.page, 1, 1000000, 1);
  const limit = clampInt(req.query.limit, 6, 500, 60);
  const offset = (page - 1) * limit;

  const qLower = normLower(q);
  const toks = tokenize(qLower);
  const likeLoose = toks.length ? `%${toks.join("%")}%` : `%${qLower}%`;

  const client = await pool.connect();
  try {
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
            upper(btrim(model_number)) AS model_number_norm,
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
            btrim(c.model_number) AS model_number,
            upper(btrim(c.model_number)) AS model_number_norm,
            COALESCE(NULLIF(lower(btrim(c.version)), ''), '') AS version_norm,
            c.version,
            c.model_name,
            c.brand,
            c.category,
            c.image_url,
            COALESCE(c.dropship_warning, false) AS dropship_warning,
            c.about,
            COALESCE(c.is_refurbished, false) AS is_refurbished,
            COALESCE(c.is_bundle, false) AS is_bundle,
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
          ORDER BY brand NULLS LAST, category NULLS LAST, model_name NULLS LAST, model_number_norm, version_norm
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
      ),
      scored AS (
        SELECT
          a.*,
          ch.best_price_cents,
          pr.overall_score
        FROM anchors a
        LEFT JOIN cheapest ch
          ON ch.model_number_norm = a.model_number_norm
         AND ch.version_norm = a.version_norm
      LEFT JOIN LATERAL (
        SELECT picked_score.overall_score
        FROM (
          SELECT
            pr2.overall_score,
            0 AS priority,
            pr2.updated_at,
            pr2.id
          FROM public.product_recommendations pr2
          WHERE
            (
              a.pci IS NOT NULL
              AND btrim(a.pci) <> ''
              AND pr2.pci IS NOT NULL
              AND btrim(pr2.pci) <> ''
              AND upper(btrim(pr2.pci)) = upper(btrim(a.pci))
            )
            OR
            (
              a.upc IS NOT NULL
              AND btrim(a.upc) <> ''
              AND pr2.upc IS NOT NULL
              AND btrim(pr2.upc) <> ''
              AND public.norm_upc(pr2.upc) = public.norm_upc(a.upc)
            )

          UNION ALL

          SELECT
            pr3.overall_score,
            1 AS priority,
            pr3.updated_at,
            pr3.id
          FROM public.catalog c_same
          JOIN public.product_recommendations pr3
            ON (
              (pr3.pci IS NOT NULL AND btrim(pr3.pci) <> '' AND c_same.pci IS NOT NULL AND btrim(c_same.pci) <> '' AND upper(btrim(pr3.pci)) = upper(btrim(c_same.pci)))
              OR
              (pr3.upc IS NOT NULL AND btrim(pr3.upc) <> '' AND c_same.upc IS NOT NULL AND btrim(c_same.upc) <> '' AND public.norm_upc(pr3.upc) = public.norm_upc(c_same.upc))
            )
          WHERE
            a.model_number_norm IS NOT NULL
            AND a.model_number_norm <> ''
            AND upper(btrim(c_same.model_number)) = a.model_number_norm
            AND COALESCE(NULLIF(lower(btrim(c_same.version)), ''), '') = a.version_norm
        ) picked_score
        ORDER BY picked_score.priority ASC, picked_score.updated_at DESC NULLS LAST, picked_score.id DESC
        LIMIT 1
      ) pr ON true
      )
          SELECT
            s.model_number,
            s.version,
            s.model_name,
            s.brand,
            s.category,
            s.image_url,
            s.dropship_warning,
            s.about,
            s.is_refurbished,
            s.is_bundle,
            s.dashboard_key,
            s.best_price_cents,
            s.overall_score
          FROM scored s
          ORDER BY s.brand NULLS LAST, s.category NULLS LAST, s.model_name NULLS LAST, s.model_number_norm, s.version_norm
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

    const countSql = `
      WITH base AS (
        SELECT DISTINCT
          upper(btrim(model_number)) AS model_number_norm,
          COALESCE(NULLIF(lower(btrim(version)), ''), '') AS version_norm
        FROM public.catalog
        WHERE model_number IS NOT NULL AND btrim(model_number) <> ''
          AND (
            lower(coalesce(model_name,'')) LIKE $1
            OR lower(coalesce(model_number,'')) LIKE $1
            OR lower(coalesce(version,'')) LIKE $1
            OR lower(coalesce(brand,'')) LIKE $1
            OR lower(coalesce(category,'')) LIKE $1
          )
      )
      SELECT COUNT(*)::int AS total
      FROM base
    `;

    const total = (await client.query(countSql, [likeLoose])).rows?.[0]?.total ?? 0;

    if (total === 0) {
      const dym = await didYouMeanForQuery(client, qLower);

      return res.json({
        ok: true,
        kind: "product",
        value: q,
        page,
        limit,
        total: 0,
        pages: 1,
        results: [],
        also: [],
        did_you_mean: dym,
      });
    }

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
      c.about,
      COALESCE(c.is_refurbished, false) AS is_refurbished,
      COALESCE(c.is_bundle, false) AS is_bundle,
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
        OR lower(coalesce(c.brand,'')) LIKE $1
        OR lower(coalesce(c.category,'')) LIKE $1
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
  ),
  scored AS (
    SELECT
      a.*,
      ch.best_price_cents,
      pr.overall_score
    FROM anchors a
    LEFT JOIN cheapest ch
      ON ch.model_number_norm = a.model_number_norm
     AND ch.version_norm = a.version_norm
    LEFT JOIN LATERAL (
      SELECT picked_score.overall_score
      FROM (
        SELECT
          pr2.overall_score,
          0 AS priority,
          pr2.updated_at,
          pr2.id
        FROM public.product_recommendations pr2
        WHERE
          (
            a.pci IS NOT NULL
            AND btrim(a.pci) <> ''
            AND pr2.pci IS NOT NULL
            AND btrim(pr2.pci) <> ''
            AND upper(btrim(pr2.pci)) = upper(btrim(a.pci))
          )
          OR
          (
            a.upc IS NOT NULL
            AND btrim(a.upc) <> ''
            AND pr2.upc IS NOT NULL
            AND btrim(pr2.upc) <> ''
            AND public.norm_upc(pr2.upc) = public.norm_upc(a.upc)
          )

        UNION ALL

        SELECT
          pr3.overall_score,
          1 AS priority,
          pr3.updated_at,
          pr3.id
        FROM public.catalog c_same
        JOIN public.product_recommendations pr3
          ON (
            (pr3.pci IS NOT NULL AND btrim(pr3.pci) <> '' AND c_same.pci IS NOT NULL AND btrim(c_same.pci) <> '' AND upper(btrim(pr3.pci)) = upper(btrim(c_same.pci)))
            OR
            (pr3.upc IS NOT NULL AND btrim(pr3.upc) <> '' AND c_same.upc IS NOT NULL AND btrim(c_same.upc) <> '' AND public.norm_upc(pr3.upc) = public.norm_upc(c_same.upc))
          )
        WHERE
          a.model_number_norm IS NOT NULL
          AND a.model_number_norm <> ''
          AND upper(btrim(c_same.model_number)) = a.model_number_norm
          AND COALESCE(NULLIF(lower(btrim(c_same.version)), ''), '') = a.version_norm
      ) picked_score
      ORDER BY picked_score.priority ASC, picked_score.updated_at DESC NULLS LAST, picked_score.id DESC
      LIMIT 1
    ) pr ON true
  )
  SELECT
    s.model_number,
    s.version,
    s.model_name,
    s.brand,
    s.category,
    s.image_url,
    s.dropship_warning,
    s.about,
    s.is_refurbished,
    s.is_bundle,
    s.dashboard_key,
    s.best_price_cents,
    s.overall_score
  FROM scored s
  ORDER BY s.brand NULLS LAST, s.category NULLS LAST, s.model_name NULLS LAST, s.model_number_norm, s.version_norm
`;

    const { rows } = await client.query(listSql, [likeLoose, limit, offset]);

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

module.exports = router;