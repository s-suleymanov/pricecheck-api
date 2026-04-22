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
      family || "", variant || "", color || "",
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
          AND (
            ($8 = 'new'         AND c.is_refurbished = false AND c.is_bundle = false)
            OR ($8 = 'refurbished' AND c.is_refurbished = true)
            OR ($8 = 'bundle'      AND c.is_bundle = true)
          )
          AND (
            ($1 = 'brand'    AND lower(btrim(c.brand))    = lower(btrim($2)))
            OR ($1 = 'category' AND lower(btrim(c.category)) = lower(btrim($2)))
            OR ($1 = 'combo'    AND lower(btrim(c.brand))    = lower(btrim($3))
                                AND lower(btrim(c.category)) = lower(btrim($4)))
          )
      )
      SELECT COUNT(*)::int AS total FROM base
    `;

    const [detectRow, total] = await Promise.all([
      client.query(detectSql, baseParams).then(r => r.rows?.[0] ?? {}),
      client.query(countSql, [...baseParams, condition])
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
          NULLIF(btrim(c.category), '') AS category,
          NULLIF(btrim(c.image_url), '') AS image_url,
          COALESCE(c.dropship_warning, false) AS dropship_warning,
          NULLIF(btrim(c.pci), '') AS pci,
          NULLIF(btrim(c.upc), '') AS upc,
          c.about,
          c.specs,
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
          AND (
            ($8 = 'new'         AND c.is_refurbished = false AND c.is_bundle = false)
            OR ($8 = 'refurbished' AND c.is_refurbished = true)
            OR ($8 = 'bundle'      AND c.is_bundle = true)
          )
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
          a.category,
          a.image_url,
          a.dropship_warning,
          a.about,
          a.specs,
          a.is_refurbished,
          a.is_bundle,
          a.dashboard_key,
          lr.best_price_cents,
          pr.overall_score,
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
      ),

      ranked AS (
        SELECT
          s.*,
          ROW_NUMBER() OVER (
            PARTITION BY lower(COALESCE(s.brand, ''))
            ORDER BY
              s.browse_score DESC,
              lower(COALESCE(s.model_name, '')),
              s.model_number_norm,
              s.version_norm
          ) AS brand_pos,
          ROW_NUMBER() OVER (
            PARTITION BY s.model_number_norm
            ORDER BY
              s.browse_score DESC,
              lower(COALESCE(s.model_name, '')),
              s.version_norm
          ) AS family_pos
        FROM scored s
      ),

      ordered AS (
        SELECT *
        FROM ranked
        ORDER BY
          CASE
            WHEN $11 = 'lowest-price' THEN CASE WHEN best_price_cents IS NULL THEN 1 ELSE 0 END
            WHEN $11 = 'highest-price' THEN CASE WHEN best_price_cents IS NULL THEN 1 ELSE 0 END
            ELSE 0
          END ASC,

          CASE WHEN $1 = 'category' THEN brand_pos  ELSE 0 END ASC,
          CASE WHEN $1 = 'category' THEN family_pos ELSE 0 END ASC,

          CASE WHEN $11 = 'lowest-price'  THEN best_price_cents END ASC NULLS LAST,
          CASE WHEN $11 = 'highest-price' THEN best_price_cents END DESC NULLS LAST,
          CASE WHEN $11 = 'az' THEN lower(COALESCE(model_name, model_number, 'zzzzzz')) END ASC,

          CASE WHEN $11 = 'recommended' THEN browse_score END DESC,
          CASE WHEN $11 = 'recommended' THEN priced_store_count END DESC,
          CASE WHEN $11 = 'recommended' THEN priced_listing_count END DESC,

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
        category,
        image_url,
        dropship_warning,
        dashboard_key,
        best_price_cents,
        overall_score,
        about,
        specs,
        is_refurbished,
        is_bundle
      FROM ordered
      LIMIT $9 OFFSET $10
    `;

    const { rows } = await client.query(listSql, [
      type, value, brand, category,
      family || "", variant || "", color || "",
      condition,
      limit,
      offset,
      sortKey,
    ]);

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
          c.about,
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
        pr.overall_score,
        a.about,
        a.specs,
        a.is_refurbished,
        a.is_bundle
      FROM anchors a
      LEFT JOIN listing_rollup lr
        ON lr.model_number_norm = a.model_number_norm
       AND lr.version_norm = a.version_norm
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
