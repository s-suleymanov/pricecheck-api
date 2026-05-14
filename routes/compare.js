const express = require("express");
const fs = require("fs");
const path = require("path");
const pool = require("../db");

const router = express.Router();

const SITE_ORIGIN = process.env.SITE_ORIGIN || "https://www.pricechecktool.com";
const DEFAULT_IMAGE = `${SITE_ORIGIN}/logo/default.webp`;
const TEMPLATE_PATH = path.join(__dirname, "..", "public", "compare", "compare.html");
const BUYING_PAGES_PATH =
  process.env.BUYING_PAGES_PATH ||
  path.join(__dirname, "..", "public", "data", "buying-pages.json");

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function safeJsonForHtml(value) {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function slugify(s) {
  return String(s || "product")
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90) || "product";
}

function normalizePath(value) {
  const clean = String(value || "")
    .split("?")[0]
    .trim();

  if (!clean) return "/";

  const withLead = clean.startsWith("/") ? clean : `/${clean}`;
  return withLead.endsWith("/") ? withLead : `${withLead}/`;
}

function loadBuyingPages() {
  try {
    const parsed = JSON.parse(fs.readFileSync(BUYING_PAGES_PATH, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error("Failed to load buying-pages.json", err);
    return [];
  }
}

function absImageUrl(url) {
  const u = String(url || "").trim();

  if (!u) return DEFAULT_IMAGE;
  if (/^https?:\/\//i.test(u)) return u;

  return `${SITE_ORIGIN}${u.startsWith("/") ? "" : "/"}${u}`;
}

function cleanKind(value) {
  const kind = String(value || "").trim().toLowerCase();

  if (kind === "bestbuy") return "bby";
  if (kind === "walmart") return "wal";
  if (kind === "target") return "tcin";
  if (kind === "amazon") return "asin";

  if (["pci", "upc", "asin", "tcin", "bby", "wal", "sku", "match"].includes(kind)) {
    return kind;
  }

  return "";
}

function storeForKind(kind) {
  if (kind === "asin") return "amazon";
  if (kind === "tcin") return "target";
  if (kind === "wal") return "walmart";
  if (kind === "bby") return "best buy";
  return "";
}

function money(cents) {
  const n = Number(cents);

  if (!Number.isFinite(n) || n <= 0) return "N/A";

  return `$${(n / 100).toFixed(2)}`;
}

function productTitle(row, config = {}) {
  return String(config.label || `${row.brand || ""} ${row.model_name || row.model_number || "Product"}`)
    .replace(/\s+/g, " ")
    .trim();
}

function dashboardKey(row) {
  if (row.pci) return `pci:${String(row.pci).trim()}`;
  if (row.upc) return `upc:${String(row.upc).trim()}`;
  return "";
}

function dashboardUrl(row, config = {}) {
  const key = dashboardKey(row);

  if (!key) return "#";

  const [kind, ...rest] = key.split(":");
  const value = rest.join(":");

  return `/dashboard/${slugify(productTitle(row, config))}/${kind}/${encodeURIComponent(value)}/`;
}

function normalizeJson(value, fallback) {
  if (!value) return fallback;
  if (typeof value !== "object") return fallback;
  return value;
}

function normalizeJsonArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  return [];
}

function productLookupFromConfig(config = {}) {
  const keys = ["pci", "upc", "asin", "tcin", "wal", "bby", "sku"];

  for (const key of keys) {
    const value = String(config[key] || "").trim();
    if (value) return { kind: cleanKind(key), value };
  }

  const match = String(config.match || config.label || "").trim();
  if (match) return { kind: "match", value: match };

  return { kind: "", value: "" };
}

function productPayload(row, config, requested) {
  const sellers = normalizeJsonArray(row.sellers);
  const bestSeller = sellers[0] || null;
  const colorsAvailable = normalizeJsonArray(row.colors_available)
    .filter(item => item && (item.color || item.variant || item.pci));

  return {
    slot: config.slot || "",
    requested_key: `${requested.kind}:${requested.value}`,
    requested_kind: requested.kind,
    requested_value: requested.value,

    title: productTitle(row, config),
    label: config.label || productTitle(row, config),
    brand: row.brand || config.brand || "",
    model_name: row.model_name || "",
    model_number: row.model_number || "",
    category: row.category || "",
    image_url: absImageUrl(config.image_url || row.image_url),
    dashboard_url: dashboardUrl(row, config),

    pci: row.pci || "",
    upc: row.upc || "",
    version: row.version || "",
    color: "",
    variant: "",
    colors_available: colorsAvailable,
    color_count: colorsAvailable.length,

    dropship_warning: Boolean(row.dropship_warning),
    coverage_warning: Boolean(row.coverage_warning),
    recall_url: row.recall_url || "",
    is_refurbished: Boolean(row.is_refurbished),
    is_bundle: Boolean(row.is_bundle),

    best_price_cents: Number(row.best_price_cents || 0),
    best_price: money(row.best_price_cents),
    store_count: Number(row.store_count || 0),
    best_seller: bestSeller,
    sellers,

    ratings: {
      avg_rating: row.avg_rating == null ? null : Number(row.avg_rating),
      max_review_count: row.max_review_count == null ? null : Number(row.max_review_count),
      expert_reviews: normalizeJsonArray(row.expert_reviews),
      review_distribution: normalizeJsonArray(row.review_distribution)
    },

    specs_norm: normalizeJson(row.specs_norm, {}),
    specs: normalizeJson(row.specs, {}),
    dimensions: normalizeJson(row.dimensions, {}),
    verdict_json: normalizeJson(row.catalog_verdict, {})
  };
}

async function getCompareProduct(config = {}) {
  const lookup = productLookupFromConfig(config);
  const kind = lookup.kind;
  const value = lookup.value;
  const store = storeForKind(kind);
  const brand = String(config.brand || "").trim();

  if (!kind || !value) return null;

  const q = await pool.query(
    `
    WITH anchor_listing AS (
      SELECT l.*
      FROM public.listings l
      WHERE
        (
          $1 IN ('asin', 'tcin', 'wal', 'bby')
          AND lower(btrim(l.store)) = $3
          AND l.store_sku IS NOT NULL
          AND btrim(l.store_sku) <> ''
          AND lower(btrim(l.store_sku)) = lower(btrim($2))
        )
        OR
        (
          $1 = 'sku'
          AND l.store_sku IS NOT NULL
          AND btrim(l.store_sku) <> ''
          AND lower(btrim(l.store_sku)) = lower(btrim($2))
        )
      ORDER BY
        CASE
          WHEN current_price_cents IS NOT NULL AND current_price_cents > 0 THEN 0
          WHEN effective_price_cents IS NOT NULL AND effective_price_cents > 0 THEN 0
          ELSE 1
        END,
        COALESCE(current_price_observed_at, created_at) DESC NULLS LAST,
        id DESC
      LIMIT 1
    ),
    candidate_catalog AS (
      SELECT c.*
      FROM public.catalog c
      WHERE
        (
          (
            $1 = 'pci'
            AND c.pci IS NOT NULL
            AND btrim(c.pci) <> ''
            AND upper(btrim(c.pci)) = upper(btrim($2))
          )
          OR
          (
            $1 = 'upc'
            AND c.upc IS NOT NULL
            AND btrim(c.upc) <> ''
            AND public.norm_upc(c.upc) = public.norm_upc($2)
          )
          OR
          (
            $1 = 'match'
            AND (
              lower(coalesce(c.model_name, '')) LIKE '%' || lower($2) || '%'
              OR lower(coalesce(c.model_number, '')) LIKE '%' || lower($2) || '%'
            )
            AND (
              $4 = ''
              OR lower(coalesce(c.brand, '')) = lower($4)
            )
          )
          OR
          EXISTS (
            SELECT 1
            FROM anchor_listing al
            WHERE
              (
                al.pci IS NOT NULL
                AND btrim(al.pci) <> ''
                AND c.pci IS NOT NULL
                AND btrim(c.pci) <> ''
                AND upper(btrim(al.pci)) = upper(btrim(c.pci))
              )
              OR
              (
                al.upc IS NOT NULL
                AND btrim(al.upc) <> ''
                AND c.upc IS NOT NULL
                AND btrim(c.upc) <> ''
                AND public.norm_upc(al.upc) = public.norm_upc(c.upc)
              )
          )
        )
        AND COALESCE(c.is_refurbished, false) = false
        AND COALESCE(c.is_bundle, false) = false
      ORDER BY
        CASE
          WHEN $1 = 'pci'
            AND c.pci IS NOT NULL
            AND upper(btrim(c.pci)) = upper(btrim($2))
          THEN 0
          WHEN $1 = 'upc'
            AND c.upc IS NOT NULL
            AND public.norm_upc(c.upc) = public.norm_upc($2)
          THEN 0
          WHEN $1 = 'match'
            AND lower(coalesce(c.model_name, '')) = lower($2)
          THEN 0
          ELSE 1
        END,
        CASE WHEN c.image_url IS NULL OR btrim(c.image_url) = '' THEN 1 ELSE 0 END,
        CASE WHEN c.pci IS NULL OR btrim(c.pci) = '' THEN 1 ELSE 0 END,
        c.created_at DESC NULLS LAST,
        c.id DESC
      LIMIT 1
    ),
    family_catalog AS (
      SELECT f.*
      FROM public.catalog f
      JOIN candidate_catalog c
        ON (
          (
            c.model_number IS NOT NULL
            AND btrim(c.model_number) <> ''
            AND f.model_number IS NOT NULL
            AND btrim(f.model_number) <> ''
            AND lower(btrim(f.model_number)) = lower(btrim(c.model_number))
          )
          OR
          (
            c.pci IS NOT NULL
            AND btrim(c.pci) <> ''
            AND f.pci IS NOT NULL
            AND btrim(f.pci) <> ''
            AND upper(btrim(f.pci)) = upper(btrim(c.pci))
          )
          OR
          (
            c.upc IS NOT NULL
            AND btrim(c.upc) <> ''
            AND f.upc IS NOT NULL
            AND btrim(f.upc) <> ''
            AND public.norm_upc(f.upc) = public.norm_upc(c.upc)
          )
        )
      WHERE COALESCE(f.is_refurbished, false) = false
        AND COALESCE(f.is_bundle, false) = false
    ),
    color_rows AS (
      SELECT DISTINCT ON (
        lower(coalesce(color, '')),
        lower(coalesce(variant, '')),
        coalesce(pci, ''),
        coalesce(upc, '')
      )
        color,
        variant,
        pci,
        upc,
        image_url
      FROM family_catalog
      ORDER BY
        lower(coalesce(color, '')),
        lower(coalesce(variant, '')),
        coalesce(pci, ''),
        coalesce(upc, ''),
        CASE WHEN image_url IS NULL OR btrim(image_url) = '' THEN 1 ELSE 0 END
    ),
    color_summary AS (
      SELECT COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'color', color,
            'variant', variant,
            'pci', pci,
            'upc', upc,
            'image_url', image_url
          )
          ORDER BY lower(coalesce(color, '')), lower(coalesce(variant, ''))
        ),
        '[]'::jsonb
      ) AS colors_available
      FROM color_rows
    ),
    listing_matches AS (
      SELECT
        l.*,
        COALESCE(l.current_price_observed_at, l.created_at) AS observed_at,
        CASE
          WHEN l.effective_price_cents IS NOT NULL
           AND l.effective_price_cents > 0
           AND (
             l.current_price_cents IS NULL
             OR l.current_price_cents <= 0
             OR l.effective_price_cents <= l.current_price_cents
           )
          THEN l.effective_price_cents
          WHEN l.current_price_cents IS NOT NULL AND l.current_price_cents > 0
          THEN l.current_price_cents
          ELSE NULL
        END AS price_cents
      FROM public.listings l
      JOIN family_catalog f
        ON (
          (
            f.pci IS NOT NULL
            AND btrim(f.pci) <> ''
            AND l.pci IS NOT NULL
            AND btrim(l.pci) <> ''
            AND upper(btrim(f.pci)) = upper(btrim(l.pci))
          )
          OR
          (
            f.upc IS NOT NULL
            AND btrim(f.upc) <> ''
            AND l.upc IS NOT NULL
            AND btrim(l.upc) <> ''
            AND public.norm_upc(f.upc) = public.norm_upc(l.upc)
          )
        )
      WHERE coalesce(nullif(lower(btrim(l.status)), ''), 'active') <> 'hidden'
    ),
    seller_rows AS (
      SELECT DISTINCT ON (
        lower(btrim(store)),
        lower(btrim(COALESCE(store_sku, '')))
      )
        store,
        store_sku,
        url,
        status,
        offer_tag,
        coupon_text,
        coupon_type,
        coupon_value_cents,
        coupon_value_pct,
        coupon_requires_clip,
        coupon_code,
        coupon_expires_at,
        current_price_cents,
        effective_price_cents,
        price_cents,
        rating,
        review_count,
        observed_at
      FROM listing_matches
      ORDER BY
        lower(btrim(store)),
        lower(btrim(COALESCE(store_sku, ''))),
        price_cents ASC NULLS LAST,
        observed_at DESC NULLS LAST
    ),
    seller_summary AS (
      SELECT
        COALESCE(
          jsonb_agg(
            jsonb_build_object(
              'store', store,
              'store_sku', store_sku,
              'url', url,
              'status', status,
              'offer_tag', offer_tag,
              'coupon_text', coupon_text,
              'coupon_type', coupon_type,
              'coupon_value_cents', coupon_value_cents,
              'coupon_value_pct', coupon_value_pct,
              'coupon_requires_clip', coupon_requires_clip,
              'coupon_code', coupon_code,
              'coupon_expires_at', coupon_expires_at,
              'current_price_cents', current_price_cents,
              'effective_price_cents', effective_price_cents,
              'price_cents', price_cents,
              'price', CASE
                WHEN price_cents IS NOT NULL AND price_cents > 0
                THEN ('$' || to_char(price_cents / 100.0, 'FM999999990.00'))
                ELSE 'N/A'
              END,
              'rating', rating,
              'review_count', review_count,
              'observed_at', observed_at
            )
            ORDER BY price_cents ASC NULLS LAST, lower(btrim(store)) ASC
          ),
          '[]'::jsonb
        ) AS sellers,
        MIN(price_cents) FILTER (WHERE price_cents IS NOT NULL AND price_cents > 0) AS best_price_cents,
        COUNT(DISTINCT lower(btrim(store))) FILTER (WHERE price_cents IS NOT NULL AND price_cents > 0) AS store_count,
        ROUND(AVG(rating)::numeric, 2) AS avg_rating,
        MAX(review_count) AS max_review_count
      FROM seller_rows
    )
    SELECT
      c.id,
      c.created_at,
      c.upc,
      c.model_name,
      c.model_number,
      c.category,
      c.brand,
      c.image_url,
      c.pci,
      c.version,
      c.dropship_warning,
      c.recall_url,
      c.color,
      c.coverage_warning,
      c.variant,
      c.specs,
      c.dimensions,
      c.verdict AS catalog_verdict,
      c.is_refurbished,
      c.is_bundle,
      c.specs_norm,

      COALESCE(cs.colors_available, '[]'::jsonb) AS colors_available,
      COALESCE(ss.sellers, '[]'::jsonb) AS sellers,
      ss.best_price_cents,
      COALESCE(ss.store_count, 0) AS store_count,
      ss.avg_rating,
      ss.max_review_count,
      '[]'::jsonb AS expert_reviews,
      '[]'::jsonb AS review_distribution
    FROM candidate_catalog c
    LEFT JOIN color_summary cs ON TRUE
    LEFT JOIN seller_summary ss ON TRUE
    LIMIT 1
    `,
    [kind, value, store, brand]
  );

  if (!q.rows.length) return null;

  return productPayload(q.rows[0], config, lookup);
}

function comparisonCanonicalPath(pageConfig) {
  const products = Array.isArray(pageConfig.products) ? pageConfig.products : [];
  const leftProduct = products[0] || {};
  const rightProduct = products[1] || {};

  const leftSlug = slugify(leftProduct.slug || leftProduct.label || leftProduct.match || "left-product");
  const rightSlug = slugify(rightProduct.slug || rightProduct.label || rightProduct.match || "right-product");

  return `/compare/${leftSlug}/versus/${rightSlug}/`;
}

function findComparisonPage(reqPath) {
  const pages = loadBuyingPages()
    .filter(page => page && page.type === "comparison" && page.category === "earbuds");

  const incoming = normalizePath(reqPath);

  return pages.find(page => normalizePath(page.path) === incoming)
    || pages.find(page => comparisonCanonicalPath(page) === incoming)
    || null;
}

function buildJsonLd(payload, canonicalUrl) {
  return {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: payload.page.title,
    description: payload.page.description,
    url: canonicalUrl,
    about: [
      {
        "@type": "Product",
        name: payload.left.title,
        brand: payload.left.brand || undefined
      },
      {
        "@type": "Product",
        name: payload.right.title,
        brand: payload.right.brand || undefined
      }
    ]
  };
}

async function buildComparisonPayload(req) {
  const pageConfig = findComparisonPage(req.path);

  if (!pageConfig) {
    return { missing_page: true };
  }

  const products = Array.isArray(pageConfig.products) ? pageConfig.products : [];

  if (products.length < 2) {
    return { missing_page: true };
  }

  const left = await getCompareProduct(products[0]);
  const right = await getCompareProduct(products[1]);

  if (!left || !right) {
    return {
      missing: {
        left: !left,
        right: !right
      }
    };
  }

  const canonicalPath = comparisonCanonicalPath(pageConfig);
  const canonicalUrl = `${SITE_ORIGIN}${canonicalPath}`;
  const hero = pageConfig.hero && typeof pageConfig.hero === "object" ? pageConfig.hero : {};

  const payload = {
    page: {
      ...pageConfig,
      title: pageConfig.seo_title || `${pageConfig.title || hero.heading || `${left.title} vs ${right.title}`} - PriceCheck`,
      heading: hero.heading || pageConfig.title || `${left.title} vs ${right.title}`,
      eyebrow: hero.eyebrow || "Comparison",
      description: pageConfig.description || hero.dek || `Compare ${left.title} and ${right.title}.`,
      canonical_url: canonicalUrl,
      robots: "index,follow",
      generated_at: new Date().toISOString()
    },
    left,
    right
  };

  payload.json_ld = buildJsonLd(payload, canonicalUrl);

  return payload;
}

async function sendComparisonPage(req, res, next) {
  try {
    const payload = await buildComparisonPayload(req);

    if (payload.missing_page) {
      return res.status(404).send("Comparison page not found.");
    }

    if (payload.missing) {
      return res.status(404).send("Comparison products not found.");
    }

    const canonicalPath = normalizePath(new URL(payload.page.canonical_url).pathname);
    const incomingPath = normalizePath(req.path);

    if (incomingPath !== canonicalPath) {
      return res.redirect(301, canonicalPath);
    }

    const template = fs.readFileSync(TEMPLATE_PATH, "utf8");
    const html = template
      .replaceAll("__PAGE_TITLE__", esc(payload.page.title))
      .replaceAll("__PAGE_DESCRIPTION__", esc(payload.page.description))
      .replaceAll("__ROBOTS__", esc(payload.page.robots))
      .replaceAll("__CANONICAL_URL__", esc(payload.page.canonical_url))
      .replaceAll("__OG_IMAGE__", esc(payload.page.infographic?.src ? absImageUrl(payload.page.infographic.src) : (payload.left.image_url || payload.right.image_url || DEFAULT_IMAGE)))
      .replaceAll("__JSON_LD__", safeJsonForHtml(payload.json_ld))
      .replaceAll("__HEAD_TO_HEAD_JSON__", safeJsonForHtml(payload));

    return res.type("html").send(html);
  } catch (err) {
    next(err);
  }
}

router.get([
  "/compare/:leftSlug/versus/:rightSlug",
  "/compare/:leftSlug/versus/:rightSlug/"
], sendComparisonPage);

router.get([
  "/api/compare/:leftSlug/versus/:rightSlug",
  "/api/compare/:leftSlug/versus/:rightSlug/"
], async (req, res, next) => {
  try {
    const payload = await buildComparisonPayload(req);

    if (payload.missing_page) {
      return res.status(404).json({
        ok: false,
        error: "comparison_page_not_found"
      });
    }

    if (payload.missing) {
      return res.status(404).json({
        ok: false,
        error: "comparison_products_not_found",
        missing: payload.missing
      });
    }

    return res.json({
      ok: true,
      ...payload
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;