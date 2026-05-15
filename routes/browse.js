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

function limitText(v, max = 500) {
  return String(v ?? "").trim().slice(0, max);
}

function cleanEventInt(v, fallback = null) {
  const n = Number.parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : fallback;
}

function cleanPriceCents(v) {
  const raw = String(v ?? "").trim();
  if (!raw) return null;

  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return null;

  return Math.max(0, Math.min(100000000, n));
}

function cleanModelYear(v) {
  const raw = String(v ?? "").trim();
  if (!raw) return null;

  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return null;

  if (n < 1990 || n > 2100) return null;
  return n;
}

function normalizeFilterText(v) {
  return String(v ?? "")
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "");
}

function waterRatingScore(v) {
  const s = String(v ?? "").trim().toUpperCase().replace(/\s+/g, "");
  if (!s) return null;

  const ipx = s.match(/^IPX([0-9])$/);
  if (ipx) return 10 + Number(ipx[1]);

  const ip = s.match(/^IP([0-9])([0-9])$/);
  if (ip) return Number(ip[1]) * 10 + Number(ip[2]);

  return null;
}

function parseSpecFilters(raw) {
  if (!raw) return [];

  let parsed = [];
  try {
    parsed = JSON.parse(String(raw));
  } catch (_e) {
    return [];
  }

  if (!Array.isArray(parsed)) return [];

  return parsed
    .map((f) => {
      const id = limitText(f.id, 80);
      const op = limitText(f.op, 20).toLowerCase();

      const keys = Array.isArray(f.keys)
        ? f.keys
            .map((k) => normalizeFilterText(limitText(k, 120)))
            .filter(Boolean)
            .slice(0, 16)
        : [];

      if (!id || !keys.length) return null;

      if (
        op !== "eq" &&
        op !== "bool" &&
        op !== "gte" &&
        op !== "lte" &&
        op !== "contains" &&
        op !== "rating_gte"
      ) {
        return null;
      }

      if (op === "bool") {
        return {
          id,
          op,
          keys,
          value: f.value === true || String(f.value).toLowerCase() === "true",
        };
      }

      if (op === "gte") {
        const n = Number(f.value);
        if (!Number.isFinite(n)) return null;

        return {
          id,
          op,
          keys,
          value: n,
        };
      }

      if (op === "rating_gte") {
        const score = waterRatingScore(f.value);
        if (!Number.isFinite(score)) return null;

        return {
          id,
          op,
          keys,
          value: score,
        };
      }

      const value = limitText(f.value, 120);
      if (!value) return null;

      return {
        id,
        op,
        keys,
        value,
      };
    })
    .filter(Boolean)
    .slice(0, 24);
}

function buildSpecFilterSql(filters, startParamIndex) {
  const clauses = [];
  const params = [];
  let p = startParamIndex;

  const specValuesSql = `
    SELECT
      regexp_replace(lower(kv.key), '[^a-z0-9]+', '', 'g') AS key_norm,
      kv.value AS value_json,
      kv.value::text AS value_text
    FROM jsonb_each(
      CASE
        WHEN jsonb_typeof(c.specs_norm) = 'object' THEN c.specs_norm
        ELSE '{}'::jsonb
      END
    ) AS kv(key, value)

    UNION ALL

    SELECT
      regexp_replace(lower(kv.key), '[^a-z0-9]+', '', 'g') AS key_norm,
      kv.value AS value_json,
      kv.value::text AS value_text
    FROM jsonb_each(
      CASE
        WHEN jsonb_typeof(c.specs) = 'object' THEN c.specs
        ELSE '{}'::jsonb
      END
    ) AS kv(key, value)
  `;

  const normalizedValueSql = `
    regexp_replace(
      lower(
        trim(both '"' from sv.value_text)
      ),
      '[^a-z0-9]+',
      '',
      'g'
    )
  `;

  for (const filter of filters) {
    if (filter.op === "eq") {
      const keysParam = `$${p++}`;
      const valueParam = `$${p++}`;

      params.push(filter.keys, normalizeFilterText(filter.value));

      clauses.push(`
        AND EXISTS (
          SELECT 1
          FROM (${specValuesSql}) sv
          WHERE sv.key_norm = ANY(${keysParam}::text[])
            AND ${normalizedValueSql} = ${valueParam}
        )
      `);
    }

    if (filter.op === "contains") {
      const keysParam = `$${p++}`;
      const valueParam = `$${p++}`;

      params.push(filter.keys, normalizeFilterText(filter.value));

      clauses.push(`
        AND EXISTS (
          SELECT 1
          FROM (${specValuesSql}) sv
          WHERE sv.key_norm = ANY(${keysParam}::text[])
            AND (
              ${normalizedValueSql} = ${valueParam}
              OR EXISTS (
                SELECT 1
                FROM jsonb_array_elements_text(
                  CASE
                    WHEN jsonb_typeof(sv.value_json) = 'array' THEN sv.value_json
                    ELSE '[]'::jsonb
                  END
                ) AS arr(v)
                WHERE regexp_replace(lower(arr.v), '[^a-z0-9]+', '', 'g') = ${valueParam}
              )
            )
        )
      `);
    }

    if (filter.op === "bool") {
      const keysParam = `$${p++}`;
      const valueParam = `$${p++}`;

      params.push(filter.keys, filter.value);

      clauses.push(`
        AND EXISTS (
          SELECT 1
          FROM (${specValuesSql}) sv
          WHERE sv.key_norm = ANY(${keysParam}::text[])
            AND (
              (
                ${valueParam}::boolean = true
                AND ${normalizedValueSql} IN ('true','yes','included','1')
              )
              OR
              (
                ${valueParam}::boolean = false
                AND ${normalizedValueSql} IN ('false','no','notincluded','0','none')
              )
            )
        )
      `);
    }

    if (filter.op === "gte") {
      const keysParam = `$${p++}`;
      const valueParam = `$${p++}`;

      params.push(filter.keys, filter.value);

      clauses.push(`
        AND EXISTS (
          SELECT 1
          FROM (${specValuesSql}) sv
          WHERE sv.key_norm = ANY(${keysParam}::text[])
            AND NULLIF(
              regexp_replace(sv.value_text, '[^0-9.]', '', 'g'),
              ''
            )::numeric >= ${valueParam}::numeric
        )
      `);
    }

    if (filter.op === "lte") {
      const keysParam = `$${p++}`;
      const valueParam = `$${p++}`;

      params.push(filter.keys, filter.value);

      clauses.push(`
        AND EXISTS (
          SELECT 1
          FROM (${specValuesSql}) sv
          WHERE sv.key_norm = ANY(${keysParam}::text[])
            AND NULLIF(
              regexp_replace(sv.value_text, '[^0-9.]', '', 'g'),
              ''
            )::numeric <= ${valueParam}::numeric
        )
      `);
    }

    if (filter.op === "rating_gte") {
      const keysParam = `$${p++}`;
      const valueParam = `$${p++}`;

      params.push(filter.keys, filter.value);

      clauses.push(`
        AND EXISTS (
          SELECT 1
          FROM (${specValuesSql}) sv
          WHERE sv.key_norm = ANY(${keysParam}::text[])
            AND (
              CASE
                WHEN upper(trim(both '"' from sv.value_text)) ~ '^IPX[0-9]$'
                  THEN 10 + substring(upper(trim(both '"' from sv.value_text)) from '^IPX([0-9])$')::int
                WHEN upper(trim(both '"' from sv.value_text)) ~ '^IP[0-9][0-9]$'
                  THEN
                    substring(upper(trim(both '"' from sv.value_text)) from '^IP([0-9])')::int * 10
                    + substring(upper(trim(both '"' from sv.value_text)) from '^IP[0-9]([0-9])$')::int
                ELSE NULL
              END
            ) >= ${valueParam}::int
        )
      `);
    }
  }

  return {
    sql: clauses.join("\n"),
    params,
  };
}

// Helper SQL snippet: normalize version for grouping.
const VERSION_NORM_SQL = "COALESCE(NULLIF(lower(btrim(c.version)), ''), '')";

// Serve browse page (SPA HTML for all browse paths)
const BROWSE_HTML = path.join(__dirname, "..", "public", "browse", "index.html");

const SHORTLIST_HTML = path.join(__dirname, "..", "public", "shortlist", "index.html");

router.get("/browse", (_req, res) => res.redirect(301, "/browse/"));
router.get("/browse/", (_req, res) => res.sendFile(BROWSE_HTML));
router.get("/browse/*", (_req, res) => res.sendFile(BROWSE_HTML));
router.get("/shortlist", (_req, res) => res.redirect(301, "/shortlist/"));
router.get("/shortlist/", (_req, res) => res.sendFile(SHORTLIST_HTML));

// GET /api/browse?type=brand&value=Sony&page=1&limit=24
router.get("/api/browse", async (req, res) => {
  let type = String(req.query.type || "").toLowerCase();
  let value = normText(req.query.value);

  const brand = normText(req.query.brand);
  const category = normText(req.query.category);
  const family = normText(req.query.family);
  const hasFamily = !!family;
  const variant = normText(req.query.variant);
  const color = normText(req.query.color);
  const hasVariant = !!variant;
  const hasColor = !!color;
  const sort = normText(req.query.sort).toLowerCase();
  const sortKey =
    sort === "lowest-price" || sort === "highest-price" || sort === "az"
      ? sort
      : "recommended";

  if (brand) {
    type = "brand";
    value = brand;
  } else if (category) {
    type = "category";
    value = category;
  }

  const hasBrand = !!brand;
  const hasCategory = !!category;
  const conditionParam = normText(req.query.condition).toLowerCase();
  const condition = (conditionParam === "refurbished" || conditionParam === "bundle") ? conditionParam : "new";

  const priceMinCents = cleanPriceCents(req.query.price_min);
  const priceMaxCents = cleanPriceCents(req.query.price_max);
  const modelYear = cleanModelYear(req.query.year);

  const specFilters = parseSpecFilters(req.query.spec_filters);

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
    const baseParams = [
      type, value, brand, category,
      family || "", variant || "", color || "", modelYear,
    ];

    const countSpecFilterBlock = buildSpecFilterSql(specFilters, 12);
    const listSpecFilterBlock = buildSpecFilterSql(specFilters, 15);

    const countParams = [
      ...baseParams,
      condition,
      priceMinCents,
      priceMaxCents,
      ...countSpecFilterBlock.params,
    ];

    const browseParams = [
      ...baseParams,
      condition,
      limit,
      offset,
      sortKey,
      priceMinCents,
      priceMaxCents,
      ...listSpecFilterBlock.params,
    ];
    const detectSql = `
      SELECT
        COUNT(*) FILTER (WHERE c.is_refurbished = false AND c.is_bundle = false)::int > 0 AS has_new,
        COUNT(*) FILTER (WHERE c.is_refurbished = true)::int  > 0 AS has_refurbished,
        COUNT(*) FILTER (WHERE c.is_bundle = true)::int        > 0 AS has_bundle
      FROM public.catalog c
      WHERE c.model_number IS NOT NULL
        AND btrim(c.model_number) <> ''
        AND ($5 = '' OR upper(btrim(c.model_number)) = upper(btrim($5)))
        AND ($6 = '' OR (c.variant IS NOT NULL AND btrim(c.variant) <> ''
              AND lower(btrim(c.variant)) = lower(btrim($6))))
        AND ($7 = '' OR (c.color IS NOT NULL AND btrim(c.color) <> ''
              AND lower(btrim(c.color)) = lower(btrim($7))))
        AND ($8::int IS NULL OR c.model_year::int = $8::int)
        AND (
          ($1 = 'brand'    AND lower(btrim(c.brand))    = lower(btrim($2)))
          OR ($1 = 'category' AND lower(btrim(c.category)) = lower(btrim($2)))
          OR ($1 = 'combo'    AND lower(btrim(c.brand))    = lower(btrim($3))
                              AND lower(btrim(c.category)) = lower(btrim($4)))
        )
    `;

    const countSql = `
      WITH base AS (
        SELECT DISTINCT
          upper(btrim(c.model_number)) AS model_number_norm,
          ${VERSION_NORM_SQL} AS version_norm
        FROM public.catalog c
        WHERE c.model_number IS NOT NULL
          AND btrim(c.model_number) <> ''
          AND ($5 = '' OR upper(btrim(c.model_number)) = upper(btrim($5)))
          AND ($6 = '' OR (c.variant IS NOT NULL AND btrim(c.variant) <> ''
                AND lower(btrim(c.variant)) = lower(btrim($6))))
          AND ($7 = '' OR (c.color IS NOT NULL AND btrim(c.color) <> ''
                AND lower(btrim(c.color)) = lower(btrim($7))))
          AND ($8::int IS NULL OR c.model_year::int = $8::int)
          AND (
            ($9 = 'new'         AND c.is_refurbished = false AND c.is_bundle = false)
            OR ($9  = 'refurbished' AND c.is_refurbished = true)
            OR ($9 = 'bundle'      AND c.is_bundle = true)
          )
          ${countSpecFilterBlock.sql}
          AND (
            ($1 = 'brand'    AND lower(btrim(c.brand))    = lower(btrim($2)))
            OR ($1 = 'category' AND lower(btrim(c.category)) = lower(btrim($2)))
            OR ($1 = 'combo'    AND lower(btrim(c.brand))    = lower(btrim($3))
                                AND lower(btrim(c.category)) = lower(btrim($4)))
          )
      ),

      listing_rollup AS (
        SELECT
          b.model_number_norm,
          b.version_norm,
          MIN(l.current_price_cents) FILTER (
            WHERE l.current_price_cents IS NOT NULL
          ) AS best_price_cents
        FROM base b
        LEFT JOIN public.catalog c
          ON upper(btrim(c.model_number)) = b.model_number_norm
         AND COALESCE(NULLIF(lower(btrim(c.version)), ''), '') = b.version_norm
        LEFT JOIN public.listings l
          ON (
            (c.pci IS NOT NULL AND btrim(c.pci) <> '' AND l.pci IS NOT NULL AND btrim(l.pci) <> ''
              AND upper(btrim(l.pci)) = upper(btrim(c.pci)))
            OR
            (c.upc IS NOT NULL AND btrim(c.upc) <> '' AND l.upc IS NOT NULL AND btrim(l.upc) <> ''
              AND public.norm_upc(l.upc) = public.norm_upc(c.upc))
          )
        GROUP BY b.model_number_norm, b.version_norm
      )

      SELECT COUNT(*)::int AS total
      FROM base b
      LEFT JOIN listing_rollup lr
        ON lr.model_number_norm = b.model_number_norm
       AND lr.version_norm = b.version_norm
      WHERE ($10::int IS NULL OR (lr.best_price_cents IS NOT NULL AND lr.best_price_cents >= $10::int))
        AND ($11::int IS NULL OR (lr.best_price_cents IS NOT NULL AND lr.best_price_cents <= $11::int))
    `;

    const [detectRow, total] = await Promise.all([
      client.query(detectSql, baseParams).then(r => r.rows?.[0] ?? {}),
      client.query(countSql, countParams)
        .then(r => r.rows?.[0]?.total ?? 0),
    ]);

    const listSql = `
      WITH picked AS (
        SELECT DISTINCT ON (
          upper(btrim(c.model_number)),
          ${VERSION_NORM_SQL}
        )
          btrim(c.model_number) AS model_number,
          upper(btrim(c.model_number)) AS model_number_norm,
          ${VERSION_NORM_SQL} AS version_norm,
          btrim(COALESCE(c.version, '')) AS version,
          NULLIF(btrim(c.model_name), '') AS model_name,
          NULLIF(btrim(c.brand), '') AS brand,
          c.model_year::int AS model_year,
          NULLIF(btrim(c.category), '') AS category,
          NULLIF(btrim(c.image_url), '') AS image_url,
          COALESCE(c.dropship_warning, false) AS dropship_warning,
          NULLIF(btrim(c.pci), '') AS pci,
          NULLIF(btrim(c.upc), '') AS upc,
          c.specs,
          c.specs_norm AS norm_specs,
          c.is_refurbished,
          c.is_bundle,
          c.created_at,
          c.id
        FROM public.catalog c
        WHERE c.model_number IS NOT NULL
          AND btrim(c.model_number) <> ''
          AND ($5 = '' OR upper(btrim(c.model_number)) = upper(btrim($5)))
          AND ($6 = '' OR (c.variant IS NOT NULL AND btrim(c.variant) <> ''
                AND lower(btrim(c.variant)) = lower(btrim($6))))
          AND ($7 = '' OR (c.color IS NOT NULL AND btrim(c.color) <> ''
                AND lower(btrim(c.color)) = lower(btrim($7))))
          AND ($8::int IS NULL OR c.model_year::int = $8::int)      
          AND (
            ($9 = 'new'         AND c.is_refurbished = false AND c.is_bundle = false)
            OR ($9 = 'refurbished' AND c.is_refurbished = true)
            OR ($9 = 'bundle'      AND c.is_bundle = true)
          )
          ${listSpecFilterBlock.sql}
          AND (
            ($1 = 'brand'    AND lower(btrim(c.brand))    = lower(btrim($2)))
            OR ($1 = 'category' AND lower(btrim(c.category)) = lower(btrim($2)))
            OR ($1 = 'combo'    AND lower(btrim(c.brand))    = lower(btrim($3))
                                AND lower(btrim(c.category)) = lower(btrim($4)))
          )
        ORDER BY
          upper(btrim(c.model_number)),
          ${VERSION_NORM_SQL},
          (NULLIF(btrim(c.image_url), '') IS NOT NULL) DESC,
          (NULLIF(btrim(c.model_name), '') IS NOT NULL) DESC,
          c.created_at DESC NULLS LAST,
          c.id DESC
      ),

      anchors AS (
        SELECT
          p.*,
          CASE
            WHEN p.pci IS NOT NULL THEN ('pci:' || p.pci)
            WHEN p.upc IS NOT NULL THEN ('upc:' || p.upc)
            ELSE NULL
          END AS dashboard_key
        FROM picked p
      ),

      listing_rollup AS (
        SELECT
          a.model_number_norm,
          a.version_norm,
          MIN(l.current_price_cents) FILTER (
            WHERE l.current_price_cents IS NOT NULL
          ) AS best_price_cents,
          COUNT(*) FILTER (
            WHERE l.current_price_cents IS NOT NULL
          )::int AS priced_listing_count,
          COUNT(DISTINCT lower(btrim(l.store))) FILTER (
            WHERE l.store IS NOT NULL
              AND btrim(l.store) <> ''
              AND l.current_price_cents IS NOT NULL
          )::int AS priced_store_count
        FROM anchors a
        LEFT JOIN public.catalog c
          ON upper(btrim(c.model_number)) = a.model_number_norm
         AND ${VERSION_NORM_SQL.replace(/c\./g, "c.")} = a.version_norm
        LEFT JOIN public.listings l
          ON (
            (c.pci IS NOT NULL AND btrim(c.pci) <> '' AND l.pci IS NOT NULL AND btrim(l.pci) <> ''
              AND upper(btrim(l.pci)) = upper(btrim(c.pci)))
            OR
            (c.upc IS NOT NULL AND btrim(c.upc) <> '' AND l.upc IS NOT NULL AND btrim(l.upc) <> ''
              AND public.norm_upc(l.upc) = public.norm_upc(c.upc))
          )
        GROUP BY a.model_number_norm, a.version_norm
      ),

      scored AS (
        SELECT
          a.model_number,
          a.model_number_norm,
          a.version,
          a.version_norm,
          a.model_name,
          a.brand,
          a.model_year,
          a.category,
          a.image_url,
          a.dropship_warning,
          a.specs,
          a.norm_specs,
          a.is_refurbished,
          a.is_bundle,
          a.dashboard_key,
          lr.best_price_cents,
          COALESCE(lr.priced_listing_count, 0) AS priced_listing_count,
          COALESCE(lr.priced_store_count, 0) AS priced_store_count,
          CASE WHEN a.image_url IS NOT NULL THEN 1 ELSE 0 END AS has_image,
          CASE WHEN lr.best_price_cents IS NOT NULL THEN 1 ELSE 0 END AS has_price,
          CASE WHEN a.dashboard_key IS NOT NULL THEN 1 ELSE 0 END AS has_dashboard,
          CASE WHEN a.model_name IS NOT NULL THEN 1 ELSE 0 END AS has_model_name,
          (
            CASE WHEN a.image_url IS NOT NULL THEN 100 ELSE 0 END +
            CASE WHEN lr.best_price_cents IS NOT NULL THEN 80 ELSE 0 END +
            CASE WHEN a.dashboard_key IS NOT NULL THEN 50 ELSE 0 END +
            CASE WHEN a.model_name IS NOT NULL THEN 15 ELSE 0 END +
            LEAST(COALESCE(lr.priced_store_count, 0), 6) * 12 +
            LEAST(COALESCE(lr.priced_listing_count, 0), 8) * 4
          )::int AS browse_score
        FROM anchors a
        LEFT JOIN listing_rollup lr
          ON lr.model_number_norm = a.model_number_norm
        AND lr.version_norm = a.version_norm
      ),

      ranked AS (
        SELECT
          s.*
        FROM scored s
      ),

      ordered AS (
        SELECT *
        FROM ranked
        WHERE ($13::int IS NULL OR (best_price_cents IS NOT NULL AND best_price_cents >= $13::int))
          AND ($14::int IS NULL OR (best_price_cents IS NOT NULL AND best_price_cents <= $14::int))
        ORDER BY
          CASE
            WHEN $12 = 'lowest-price' THEN CASE WHEN best_price_cents IS NULL THEN 1 ELSE 0 END
            WHEN $12 = 'highest-price' THEN CASE WHEN best_price_cents IS NULL THEN 1 ELSE 0 END
            ELSE 0
          END ASC,

          CASE WHEN $12 = 'lowest-price'  THEN best_price_cents END ASC NULLS LAST,
          CASE WHEN $12 = 'highest-price' THEN best_price_cents END DESC NULLS LAST,
          CASE WHEN $12 = 'az' THEN lower(COALESCE(model_name, model_number, 'zzzzzz')) END ASC,

          CASE WHEN $12 = 'recommended' THEN browse_score END DESC,
          CASE WHEN $12 = 'recommended' THEN priced_store_count END DESC,
          CASE WHEN $12 = 'recommended' THEN priced_listing_count END DESC,

          lower(COALESCE(brand, 'zzzzzz')) ASC,
          lower(COALESCE(model_name, model_number, 'zzzzzz')) ASC,
          model_number_norm ASC,
          version_norm ASC
      )

      SELECT
        model_number,
        version,
        model_name,
        brand,
        model_year,
        category,
        image_url,
        dropship_warning,
        dashboard_key,
        best_price_cents,
        specs,
        norm_specs,
        is_refurbished,
        is_bundle
      FROM ordered
      LIMIT $10 OFFSET $11
    `;

    const { rows } = await client.query(listSql, browseParams);

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
      has_new: !!detectRow.has_new,
      has_refurbished: !!detectRow.has_refurbished,
      has_bundle: !!detectRow.has_bundle,
      condition,
      price_min: priceMinCents,
      price_max: priceMaxCents,
      year: modelYear,
      spec_filters: specFilters,
      results: rows || [],
    });
  } catch (e) {
    console.error("browse error:", e);
    res.status(500).json({ ok: false, error: "server_error" });
  } finally {
    client.release();
  }
});

// GET /api/shortlist_specs?keys=pci:ABC,upc:123

// POST /api/browse_events
router.post("/api/browse_events", express.json({ limit: "64kb" }), async (req, res) => {
  const rawEvents = Array.isArray(req.body?.events)
    ? req.body.events
    : [req.body || {}];

  const events = rawEvents
    .slice(0, 100)
    .map((e) => {
      const eventType = limitText(e.event_type || e.eventType, 24).toLowerCase();

      return {
        event_type: eventType,
        session_id: limitText(e.session_id, 120),

        page_url: limitText(e.page_url, 1000),
        referrer: limitText(e.referrer, 1000),
        viewport: limitText(e.viewport, 80),

        active_tab: limitText(e.active_tab, 60),
        browse_q: limitText(e.browse_q, 200),
        browse_brand: limitText(e.browse_brand, 200),
        browse_category: limitText(e.browse_category, 200),
        browse_family: limitText(e.browse_family, 200),
        browse_variant: limitText(e.browse_variant, 200),
        browse_color: limitText(e.browse_color, 200),
        browse_condition: limitText(e.browse_condition, 60),
        browse_sort: limitText(e.browse_sort, 60),
        browse_page: cleanEventInt(e.browse_page),

        result_position: cleanEventInt(e.result_position),

        dashboard_key: limitText(e.dashboard_key, 240),
        href: limitText(e.href, 1000),
        product_title: limitText(e.product_title, 300),
        product_brand: limitText(e.product_brand, 200),

        source: "browse"
      };
    })
    .filter((e) => {
      if (e.event_type !== "impression" && e.event_type !== "click") return false;
      if (!e.dashboard_key && !e.href) return false;
      return true;
    });

  if (!events.length) {
    return res.json({ ok: true, inserted: 0 });
  }

  try {
    await pool.query(
      `
      INSERT INTO public.browse_product_events (
        event_type,
        session_id,
        page_url,
        referrer,
        viewport,
        active_tab,
        browse_q,
        browse_brand,
        browse_category,
        browse_family,
        browse_variant,
        browse_color,
        browse_condition,
        browse_sort,
        browse_page,
        result_position,
        dashboard_key,
        href,
        product_title,
        product_brand,
        source
      )
      SELECT
        x.event_type,
        NULLIF(x.session_id, ''),
        NULLIF(x.page_url, ''),
        NULLIF(x.referrer, ''),
        NULLIF(x.viewport, ''),
        NULLIF(x.active_tab, ''),
        NULLIF(x.browse_q, ''),
        NULLIF(x.browse_brand, ''),
        NULLIF(x.browse_category, ''),
        NULLIF(x.browse_family, ''),
        NULLIF(x.browse_variant, ''),
        NULLIF(x.browse_color, ''),
        NULLIF(x.browse_condition, ''),
        NULLIF(x.browse_sort, ''),
        x.browse_page,
        x.result_position,
        NULLIF(x.dashboard_key, ''),
        NULLIF(x.href, ''),
        NULLIF(x.product_title, ''),
        NULLIF(x.product_brand, ''),
        'browse'
      FROM jsonb_to_recordset($1::jsonb) AS x (
        event_type TEXT,
        session_id TEXT,
        page_url TEXT,
        referrer TEXT,
        viewport TEXT,
        active_tab TEXT,
        browse_q TEXT,
        browse_brand TEXT,
        browse_category TEXT,
        browse_family TEXT,
        browse_variant TEXT,
        browse_color TEXT,
        browse_condition TEXT,
        browse_sort TEXT,
        browse_page INTEGER,
        result_position INTEGER,
        dashboard_key TEXT,
        href TEXT,
        product_title TEXT,
        product_brand TEXT
      )
      `,
      [JSON.stringify(events)]
    );

    return res.json({ ok: true, inserted: events.length });
  } catch (e) {
    console.error("browse_events error:", e);
    return res.status(500).json({ ok: false, error: "server_error" });
  }
});

router.get("/api/shortlist_specs", async (req, res) => {
  const rawKeys = String(req.query.keys || "").trim();

  const keys = rawKeys
    .split(",")
    .map((s) => String(s || "").trim())
    .filter(Boolean)
    .slice(0, 24);

  if (!keys.length) {
    return res.json({
      ok: true,
      results: [],
    });
  }

  const parsed = keys.map((key) => {
    const i = key.indexOf(":");
    if (i === -1) return null;

    const kind = key.slice(0, i).trim().toLowerCase();
    const value = key.slice(i + 1).trim();

    if (!value) return null;
    if (kind !== "pci" && kind !== "upc") return null;

    return { kind, value };
  }).filter(Boolean);

  if (!parsed.length) {
    return res.json({
      ok: true,
      results: [],
    });
  }

  const client = await pool.connect();
  try {
    const values = [];
    const matchSql = parsed.map((entry, idx) => {
      const p = idx + 1;
      values.push(entry.value);

      if (entry.kind === "pci") {
        return `(c.pci IS NOT NULL AND btrim(c.pci) <> '' AND upper(btrim(c.pci)) = upper(btrim($${p})))`;
      }

      return `(c.upc IS NOT NULL AND btrim(c.upc) <> '' AND public.norm_upc(c.upc) = public.norm_upc($${p}))`;
    }).join(" OR ");

    const sql = `
      WITH matched AS (
        SELECT DISTINCT ON (
          upper(btrim(c.model_number)),
          COALESCE(NULLIF(lower(btrim(c.version)), ''), '')
        )
          btrim(c.model_number) AS model_number,
          upper(btrim(c.model_number)) AS model_number_norm,
          COALESCE(NULLIF(lower(btrim(c.version)), ''), '') AS version_norm,
          btrim(COALESCE(c.version, '')) AS version,
          NULLIF(btrim(c.model_name), '') AS model_name,
          NULLIF(btrim(c.brand), '') AS brand,
          NULLIF(btrim(c.category), '') AS category,
          NULLIF(btrim(c.image_url), '') AS image_url,
          COALESCE(c.dropship_warning, false) AS dropship_warning,
          NULLIF(btrim(c.pci), '') AS pci,
          NULLIF(btrim(c.upc), '') AS upc,
          c.specs,
          c.is_refurbished,
          c.is_bundle,
          c.created_at,
          c.id
        FROM public.catalog c
        WHERE c.model_number IS NOT NULL
          AND btrim(c.model_number) <> ''
          AND (${matchSql})
        ORDER BY
          upper(btrim(c.model_number)),
          COALESCE(NULLIF(lower(btrim(c.version)), ''), ''),
          (NULLIF(btrim(c.image_url), '') IS NOT NULL) DESC,
          (NULLIF(btrim(c.model_name), '') IS NOT NULL) DESC,
          c.created_at DESC NULLS LAST,
          c.id DESC
      ),

      anchors AS (
        SELECT
          m.*,
          CASE
            WHEN m.pci IS NOT NULL THEN ('pci:' || m.pci)
            WHEN m.upc IS NOT NULL THEN ('upc:' || m.upc)
            ELSE NULL
          END AS dashboard_key
        FROM matched m
      ),

      listing_rollup AS (
        SELECT
          a.model_number_norm,
          a.version_norm,
          MIN(l.current_price_cents) FILTER (
            WHERE l.current_price_cents IS NOT NULL
          ) AS best_price_cents,
          COUNT(*) FILTER (
            WHERE l.current_price_cents IS NOT NULL
          )::int AS priced_listing_count,
          COUNT(DISTINCT lower(btrim(l.store))) FILTER (
            WHERE l.store IS NOT NULL
              AND btrim(l.store) <> ''
              AND l.current_price_cents IS NOT NULL
          )::int AS priced_store_count
        FROM anchors a
        LEFT JOIN public.catalog c
          ON upper(btrim(c.model_number)) = a.model_number_norm
         AND COALESCE(NULLIF(lower(btrim(c.version)), ''), '') = a.version_norm
        LEFT JOIN public.listings l
          ON (
            (c.pci IS NOT NULL AND btrim(c.pci) <> '' AND l.pci IS NOT NULL AND btrim(l.pci) <> ''
              AND upper(btrim(l.pci)) = upper(btrim(c.pci)))
            OR
            (c.upc IS NOT NULL AND btrim(c.upc) <> '' AND l.upc IS NOT NULL AND btrim(l.upc) <> ''
              AND public.norm_upc(l.upc) = public.norm_upc(c.upc))
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
        lr.best_price_cents,
        a.specs,
        a.is_refurbished,
        a.is_bundle
      FROM anchors a
      LEFT JOIN listing_rollup lr
        ON lr.model_number_norm = a.model_number_norm
       AND lr.version_norm = a.version_norm
      ORDER BY lower(COALESCE(a.brand, '')), lower(COALESCE(a.model_name, a.model_number, ''))
    `;

    const { rows } = await client.query(sql, values);

    return res.json({
      ok: true,
      results: rows || [],
    });
  } catch (e) {
    console.error("shortlist_specs error:", e);
    return res.status(500).json({ ok: false, error: "server_error" });
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

// GET /api/family_panel?family=<model_number>&brand=<optional>&category=<optional>
router.get("/api/family_panel", async (req, res) => {
  const family = normText(req.query.family);
  const brand = normText(req.query.brand);
  const category = normText(req.query.category);

  if (!family) return res.status(400).json({ ok: false, error: "family is required" });

  const client = await pool.connect();
  try {
    const variantsSql = `
  SELECT v
  FROM (
    SELECT DISTINCT
      btrim(variant) AS v,
      lower(btrim(variant)) AS v_sort
    FROM public.catalog
    WHERE model_number IS NOT NULL AND btrim(model_number) <> ''
      AND upper(btrim(model_number)) = upper(btrim($1))
      AND ($2 = '' OR (brand IS NOT NULL AND btrim(brand) <> '' AND lower(btrim(brand)) = lower(btrim($2))))
      AND ($3 = '' OR (category IS NOT NULL AND btrim(category) <> '' AND lower(btrim(category)) = lower(btrim($3))))
      AND variant IS NOT NULL AND btrim(variant) <> ''
  ) s
  ORDER BY s.v_sort ASC, s.v ASC
`;

const colorsSql = `
  SELECT c
  FROM (
    SELECT DISTINCT
      btrim(color) AS c,
      lower(btrim(color)) AS c_sort
    FROM public.catalog
    WHERE model_number IS NOT NULL AND btrim(model_number) <> ''
      AND upper(btrim(model_number)) = upper(btrim($1))
      AND ($2 = '' OR (brand IS NOT NULL AND btrim(brand) <> '' AND lower(btrim(brand)) = lower(btrim($2))))
      AND ($3 = '' OR (category IS NOT NULL AND btrim(category) <> '' AND lower(btrim(category)) = lower(btrim($3))))
      AND color IS NOT NULL AND btrim(color) <> ''
  ) s
  ORDER BY s.c_sort ASC, s.c ASC
`;


    const variants = (await client.query(variantsSql, [family, brand || "", category || ""])).rows || [];
    const colors = (await client.query(colorsSql, [family, brand || "", category || ""])).rows || [];

    return res.json({
      ok: true,
      family,
      brand: brand || "",
      category: category || "",
      variants: variants.map((r) => r.v).filter(Boolean),
      colors: colors.map((r) => r.c).filter(Boolean),
    });
  } catch (e) {
    console.error("family_panel error:", e);
    return res.status(500).json({ ok: false, error: "server_error" });
  } finally {
    client.release();
  }
});

module.exports = router;
