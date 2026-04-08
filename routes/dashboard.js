// routes/dashboard.js
const path = require('path');
const fs = require('fs');
const express = require('express');
const crypto = require('crypto');
const { Pool } = require('pg');

const router = express.Router();

// -------------------------
// dashboard HTML template + SEO injection
// -------------------------
const DASHBOARD_INDEX_PATH = path.join(__dirname, '..', 'public', 'dashboard', 'index.html');
let DASHBOARD_TEMPLATE = null;

const CANONICAL_ORIGIN = 'https://www.pricechecktool.com';

function getDashboardTemplate() {
  if (!DASHBOARD_TEMPLATE) {
    DASHBOARD_TEMPLATE = fs.readFileSync(DASHBOARD_INDEX_PATH, 'utf8');
  }
  return DASHBOARD_TEMPLATE;
}

function escAttr(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function slugifyTitleServer(s) {
  const raw = String(s || '').trim().toLowerCase();
  if (!raw) return 'product';
  return raw
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'product';
}

function absImageUrl(url) {
  const u = String(url || '').trim();
  if (!u) return `${CANONICAL_ORIGIN}/logo/default.webp`;
  if (/^https?:\/\//i.test(u)) return u;
  return `${CANONICAL_ORIGIN}${u.startsWith('/') ? '' : '/'}${u}`;
}

function seoDescription(title) {
  const t = String(title || 'this product').trim();
  return `Compare prices for ${t} across stores. See price history, cross-store offers, and any verified coupons, matched to the exact variant by PCI and UPC.`;
}

function replaceOrInsert(html, re, tag) {
  if (re.test(html)) return html.replace(re, tag);
  return html.replace(/<\/head>/i, `${tag}\n</head>`);
}

function setTitleTag(html, title) {
  const tag = `<title>${escHtml(title)}</title>`;
  return replaceOrInsert(html, /<title>[\s\S]*?<\/title>/i, tag);
}

function setMetaName(html, name, content) {
  const re = new RegExp(`<meta\\s+[^>]*name=["']${name}["'][^>]*>`, 'i');
  const tag = `<meta name="${name}" content="${escAttr(content)}">`;
  return replaceOrInsert(html, re, tag);
}

function setMetaProp(html, prop, content) {
  const re = new RegExp(`<meta\\s+[^>]*property=["']${prop}["'][^>]*>`, 'i');
  const tag = `<meta property="${prop}" content="${escAttr(content)}">`;
  return replaceOrInsert(html, re, tag);
}

function setCanonicalLink(html, href) {
  const re = /<link\s+[^>]*rel=["']canonical["'][^>]*>/i;
  const tag = `<link rel="canonical" href="${escAttr(href)}" id="pcCanonical" />`;
  return replaceOrInsert(html, re, tag);
}

function renderDashboardHtml({ pageTitle, desc, canonicalUrl, robots, imageUrl }) {
  let html = getDashboardTemplate();

  html = setTitleTag(html, pageTitle);
  html = setMetaName(html, 'description', desc);
  html = setCanonicalLink(html, canonicalUrl);

  html = setMetaName(html, 'robots', robots);

  html = setMetaProp(html, 'og:title', pageTitle);
  html = setMetaProp(html, 'og:description', desc);
  html = setMetaProp(html, 'og:url', canonicalUrl);
  html = setMetaProp(html, 'og:image', imageUrl);

  html = setMetaName(html, 'twitter:card', 'summary_large_image');
  html = setMetaName(html, 'twitter:title', pageTitle);
  html = setMetaName(html, 'twitter:description', desc);
  html = setMetaName(html, 'twitter:image', imageUrl);

  return html;
}

function canonicalPathFromKey(key, title) {
  const slug = slugifyTitleServer(title);
  const [kindRaw, ...rest] = String(key || '').trim().split(':');
  const kind = (kindRaw || '').toLowerCase();
  const value = rest.join(':').trim();

  if (kind && value) return `/dashboard/${slug}/${kind}/${encodeURIComponent(value)}/`;
  return `/dashboard/${slug}/`;
}

// Create pool here (matches your "router exports directly" server.js mount style)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false }
});

// -------------------------
// small helpers
// -------------------------
function normalizePrefix(raw) {
  const s = String(raw || '').trim();
  const i = s.indexOf(':');
  if (i === -1) return { prefix: null, val: s };
  return { prefix: s.slice(0, i).toLowerCase(), val: s.slice(i + 1).trim() };
}

function isLikelyUPC(s) {
  const v = String(s || '').replace(/[\s-]/g, '');
  return /^[0-9]{12,14}$/.test(v);
}

function isLikelyPCI(s) {
  const v = String(s || '').trim();
  return /^[A-Z][A-Z0-9]{7}$/i.test(v);
}

function isLikelyASIN(s) {
  const v = String(s || '').trim();
  return /^[A-Z0-9]{10}$/i.test(v);
}

function normStoreKey(s) {
  // Normalize to your canonical store keys used by frontend storeKey()
  const k = String(s || '').trim().toLowerCase();
  if (!k) return '';
  const compact = k.replace(/\s+/g, '');
  if (compact === 'bestbuy') return 'bestbuy';
  if (compact === 'walmart') return 'walmart';
  if (compact === 'amazon') return 'amazon';
  if (compact === 'target') return 'target';
  if (compact === 'apple') return 'apple';
  return compact;
}

function storeForKind(kind) {
  if (kind === 'bby') return 'bestbuy';
  if (kind === 'wal') return 'walmart';
  if (kind === 'tcin') return 'target';
  return null;
}

async function getFamiliesForBrand(client, brandRaw) {
  const brand = String(brandRaw || '').trim();
  if (!brand) return [];

  const r = await client.query(
    `
    with ranked as (
      select
        model_number,
        created_at,
        pci,
        upc,
        case
          when pci is not null and btrim(pci) <> '' then 0
          when upc is not null and btrim(upc) <> '' then 1
          else 2
        end as key_rank
      from public.catalog
      where brand is not null and btrim(brand) <> ''
        and lower(btrim(brand)) = lower(btrim($1))
        and model_number is not null and btrim(model_number) <> ''
    ),
    picked as (
      select distinct on (upper(btrim(model_number)))
        model_number,
        case
          when pci is not null and btrim(pci) <> '' then 'pci:' || btrim(pci)
          when upc is not null and btrim(upc) <> '' then 'upc:' || btrim(upc)
          else null
        end as key
      from ranked
      order by upper(btrim(model_number)), key_rank asc, created_at desc nulls last
    )
    select model_number, key
    from picked
    where key is not null and btrim(key) <> ''
    order by lower(model_number) asc
    limit 300
    `,
    [brand]
  );

  return (r.rows || []).map(x => ({
    model_number: x.model_number,
    key: x.key
  }));
}

async function getSimilarProducts(client, selectedMeta, anchorPriceCents = null, limit = 48) {
  const category = String(selectedMeta?.category || '').trim();
  const currentModelNumber = String(selectedMeta?.model_number || '').trim();

  if (!category) return [];

  const anchor =
    Number.isFinite(Number(anchorPriceCents)) && Number(anchorPriceCents) > 0
      ? Math.round(Number(anchorPriceCents))
      : null;

  const r = await client.query(
    `
    WITH picked AS (
      SELECT DISTINCT ON (
        upper(btrim(c.model_number)),
        COALESCE(NULLIF(lower(btrim(c.version)), ''), '')
      )
        btrim(c.model_number) AS model_number,
        upper(btrim(c.model_number)) AS model_number_norm,
        COALESCE(NULLIF(lower(btrim(c.version)), ''), '') AS version_norm,
        c.model_name,
        c.brand,
        c.category,
        c.image_url,
        c.pci,
        c.upc,
        c.created_at,
        c.id
      FROM public.catalog c
      WHERE c.model_number IS NOT NULL
        AND btrim(c.model_number) <> ''
        AND c.category IS NOT NULL
        AND btrim(c.category) <> ''
        AND lower(btrim(c.category)) = lower(btrim($1))
        AND (
          $2::text = ''
          OR upper(btrim(c.model_number)) <> upper(btrim($2))
        )
      ORDER BY
        upper(btrim(c.model_number)),
        COALESCE(NULLIF(lower(btrim(c.version)), ''), ''),
        CASE
          WHEN c.pci IS NOT NULL AND btrim(c.pci) <> '' THEN 0
          WHEN c.upc IS NOT NULL AND btrim(c.upc) <> '' THEN 1
          ELSE 2
        END,
        c.created_at DESC NULLS LAST,
        c.id DESC
    ),
    anchors AS (
      SELECT
        p.*,
        CASE
          WHEN p.pci IS NOT NULL AND btrim(p.pci) <> '' THEN 'pci:' || btrim(p.pci)
          WHEN p.upc IS NOT NULL AND btrim(p.upc) <> '' THEN 'upc:' || btrim(p.upc)
          ELSE NULL
        END AS dashboard_key
      FROM picked p
    ),
    cheapest AS (
      SELECT
        a.model_number_norm,
        a.version_norm,
        MIN(
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
          END
        ) AS best_price_cents
      FROM anchors a
      LEFT JOIN public.catalog c2
        ON upper(btrim(c2.model_number)) = a.model_number_norm
       AND COALESCE(NULLIF(lower(btrim(c2.version)), ''), '') = a.version_norm
      LEFT JOIN public.listings l
        ON (
          (
            c2.pci IS NOT NULL
            AND btrim(c2.pci) <> ''
            AND l.pci IS NOT NULL
            AND btrim(l.pci) <> ''
            AND upper(btrim(l.pci)) = upper(btrim(c2.pci))
          )
          OR
          (
            c2.upc IS NOT NULL
            AND btrim(c2.upc) <> ''
            AND l.upc IS NOT NULL
            AND btrim(l.upc) <> ''
            AND public.norm_upc(l.upc) = public.norm_upc(c2.upc)
          )
        )
       AND coalesce(nullif(lower(btrim(l.status)), ''), 'active') <> 'hidden'
      GROUP BY a.model_number_norm, a.version_norm
    )
    SELECT
      a.model_name,
      a.brand,
      a.category,
      a.image_url,
      a.dashboard_key,
      ch.best_price_cents
    FROM anchors a
    LEFT JOIN cheapest ch
      ON ch.model_number_norm = a.model_number_norm
     AND ch.version_norm = a.version_norm
    WHERE a.dashboard_key IS NOT NULL
    ORDER BY
      CASE
        WHEN $3::int IS NOT NULL AND ch.best_price_cents IS NOT NULL
        THEN ABS(ch.best_price_cents - $3::int)
        ELSE 2147483647
      END ASC,
      CASE WHEN ch.best_price_cents IS NULL THEN 1 ELSE 0 END,
      ch.best_price_cents ASC NULLS LAST,
      a.brand ASC NULLS LAST,
      a.model_name ASC NULLS LAST,
      a.model_number_norm,
      a.version_norm
    LIMIT $4
    `,
    [category, currentModelNumber, anchor, limit]
  );

  return r.rows || [];
}

async function getLineupData(client, selectedMeta) {
  const brand = String(selectedMeta?.brand || '').trim();
  const category = String(selectedMeta?.category || '').trim();
  const currentFamily = String(selectedMeta?.model_number || '').trim();
  const currentVersion = String(selectedMeta?.version || '').trim();

  if (!brand) return null;

const familiesRes = await client.query(
  `
  WITH family_pick AS (
    SELECT DISTINCT ON (
      upper(btrim(c.model_number))
    )
      c.model_number,
      c.category,
      CASE
        WHEN c.pci IS NOT NULL AND btrim(c.pci) <> '' THEN 'pci:' || btrim(c.pci)
        WHEN c.upc IS NOT NULL AND btrim(c.upc) <> '' THEN 'upc:' || btrim(c.upc)
        ELSE NULL
      END AS key
    FROM public.catalog c
    WHERE c.brand IS NOT NULL
      AND btrim(c.brand) <> ''
      AND lower(btrim(c.brand)) = lower(btrim($1))
      AND c.model_number IS NOT NULL
      AND btrim(c.model_number) <> ''
    ORDER BY
      upper(btrim(c.model_number)),
      CASE
        WHEN c.pci IS NOT NULL AND btrim(c.pci) <> '' THEN 0
        WHEN c.upc IS NOT NULL AND btrim(c.upc) <> '' THEN 1
        ELSE 2
      END,
      c.created_at DESC NULLS LAST,
      c.id DESC
  ),
  family_counts AS (
    SELECT
      upper(btrim(c.model_number)) AS family_norm,
      COUNT(
        DISTINCT COALESCE(NULLIF(lower(btrim(c.version)), ''), '__default__')
      )::int AS product_count
    FROM public.catalog c
    WHERE c.brand IS NOT NULL
      AND btrim(c.brand) <> ''
      AND lower(btrim(c.brand)) = lower(btrim($1))
      AND c.model_number IS NOT NULL
      AND btrim(c.model_number) <> ''
    GROUP BY upper(btrim(c.model_number))
  )
  SELECT
    fp.model_number,
    fp.category,
    fp.key,
    COALESCE(fc.product_count, 0)::int AS product_count
  FROM family_pick fp
  LEFT JOIN family_counts fc
    ON fc.family_norm = upper(btrim(fp.model_number))
  ORDER BY
    CASE
      WHEN $2 <> '' AND upper(btrim(fp.model_number)) = upper(btrim($2)) THEN 0
      ELSE 1
    END,
    CASE
      WHEN $3 <> ''
       AND fp.category IS NOT NULL
       AND btrim(fp.category) <> ''
       AND lower(btrim(fp.category)) = lower(btrim($3)) THEN 0
      ELSE 1
    END,
    lower(btrim(fp.model_number)) ASC
  LIMIT 60
  `,
  [brand, currentFamily, category]
);

  let current_family = null;

  if (currentFamily) {
    const currentRes = await client.query(
      `
      SELECT DISTINCT ON (
        COALESCE(NULLIF(lower(btrim(c.version)), ''), '__default__')
      )
        c.version,
        c.model_name,
        c.category,
        c.image_url,
        CASE
          WHEN c.pci IS NOT NULL AND btrim(c.pci) <> '' THEN 'pci:' || btrim(c.pci)
          WHEN c.upc IS NOT NULL AND btrim(c.upc) <> '' THEN 'upc:' || btrim(c.upc)
          ELSE NULL
        END AS key
      FROM public.catalog c
      WHERE c.brand IS NOT NULL
        AND btrim(c.brand) <> ''
        AND lower(btrim(c.brand)) = lower(btrim($1))
        AND c.model_number IS NOT NULL
        AND btrim(c.model_number) <> ''
        AND upper(btrim(c.model_number)) = upper(btrim($2))
      ORDER BY
        COALESCE(NULLIF(lower(btrim(c.version)), ''), '__default__'),
        CASE
          WHEN c.pci IS NOT NULL AND btrim(c.pci) <> '' THEN 0
          WHEN c.upc IS NOT NULL AND btrim(c.upc) <> '' THEN 1
          ELSE 2
        END,
        c.created_at DESC NULLS LAST,
        c.id DESC
      `,
      [brand, currentFamily]
    );

    current_family = {
      model_number: currentFamily,
      brand,
      category: category || null,
      selected_version: currentVersion || null,
      products: (currentRes.rows || [])
        .filter(r => r.key)
        .map(r => ({
          version: String(r.version || '').trim() || 'Default',
          model_name: r.model_name || null,
          category: r.category || null,
          image_url: r.image_url || null,
          key: r.key
        }))
    };
  }

  return {
    brand,
    category: category || null,
    current_family,
    families: familiesRes.rows || []
  };
}

function parseKey(rawKey) {
  const { prefix, val } = normalizePrefix(rawKey);
  const v = String(val || '').trim();
  const p = (prefix || '').toLowerCase();

  if (p === 'asin') return { kind: 'asin', value: v.toUpperCase() };
  if (p === 'upc') return { kind: 'upc', value: v };
  if (p === 'pci' || p === 'pc') return { kind: 'pci', value: v };
  if (p === 'bby' || p === 'bestbuy' || p === 'sku') return { kind: 'bby', value: v };
  if (p === 'wal' || p === 'walmart') return { kind: 'wal', value: v };
  if (p === 'tcin' || p === 'target') return { kind: 'tcin', value: v };

  // no prefix: guess
  if (isLikelyASIN(v)) return { kind: 'asin', value: v.toUpperCase() };
  if (isLikelyUPC(v)) return { kind: 'upc', value: v };
  if (isLikelyPCI(v)) return { kind: 'pci', value: v };

  return { kind: 'raw', value: v };
}

function normSkuLocal(v) {
  const s = String(v || '').trim().toUpperCase().replace(/[^0-9A-Z]/g, '');
  return s || null;
}

function hashSessionToken(token) {
  return crypto
    .createHash('sha256')
    .update(String(token || ''), 'utf8')
    .digest('hex');
}

function uniqOfferKey(store, storeSku) {
  const st = normStoreKey(store);
  const sku = normSkuLocal(storeSku);
  return `${st}:S:${sku || ''}`;
}

// -------------------------
// resolution flow (listings -> catalog)
// -------------------------

/**
 * Step 1: resolve a "seed" from listings based on input key.
 * ASIN is allowed ONLY to find PCI/UPC from Amazon listing.
 * Also keep the actual seed listing row (so the dashboard can show it even if PCI/UPC are missing).
 */
async function findSeedFromListings(client, parsed) {
  const { kind, value } = parsed;

  // ASIN means Amazon listing, ASIN stored in listings.store_sku where store='amazon'
  if (kind === 'asin') {
    const r = await client.query(
      `
      select store, store_sku, upc, pci, url, current_price_cents, current_price_observed_at, created_at
      from public.listings
      where lower(btrim(store)) = 'amazon'
        and norm_sku(store_sku) = norm_sku($1)
        and coalesce(nullif(lower(btrim(status)), ''), 'active') <> 'hidden'
      order by current_price_observed_at desc nulls last, created_at desc
      limit 1
      `,
      [value]
    );

    if (r.rowCount) {
      const row = r.rows[0];
      return {
        asin_input: value,
        upc: row.upc || null,
        pci: row.pci || null,
        seed_listing: row
      };
    }

    return { asin_input: value, upc: null, pci: null, seed_listing: null };
  }

  if (kind === 'upc') {
    const r = await client.query(
      `
      select store, store_sku, upc, pci, url, current_price_cents, current_price_observed_at, created_at
      from public.listings
      where norm_upc(upc) = norm_upc($1)
        and coalesce(nullif(lower(btrim(status)), ''), 'active') <> 'hidden'
      order by current_price_observed_at desc nulls last, created_at desc
      limit 1
      `,
      [value]
    );
    if (r.rowCount) {
      const row = r.rows[0];
      return { asin_input: null, upc: row.upc || value, pci: row.pci || null, seed_listing: row };
    }
    return { asin_input: null, upc: value, pci: null, seed_listing: null };
  }

  if (kind === 'pci') {
    const r = await client.query(
      `
      select store, store_sku, upc, pci, url, current_price_cents, current_price_observed_at, created_at
      from public.listings
      where pci is not null and btrim(pci) <> ''
        and upper(btrim(pci)) = upper(btrim($1))
        and coalesce(nullif(lower(btrim(status)), ''), 'active') <> 'hidden'
      order by current_price_observed_at desc nulls last, created_at desc
      limit 1
      `,
      [value]
    );
    if (r.rowCount) {
      const row = r.rows[0];
      return { asin_input: null, upc: row.upc || null, pci: row.pci || value, seed_listing: row };
    }
    return { asin_input: null, upc: null, pci: value, seed_listing: null };
  }

  if (kind === 'bby' || kind === 'wal' || kind === 'tcin') {
    const store = storeForKind(kind);
    const r = await client.query(
      `
      select store, store_sku, upc, pci, url, current_price_cents, current_price_observed_at, created_at
      from public.listings
      where replace(lower(btrim(store)), ' ', '') = $1
        and norm_sku(store_sku) = norm_sku($2)
        and coalesce(nullif(lower(btrim(status)), ''), 'active') <> 'hidden'
      order by current_price_observed_at desc nulls last, created_at desc
      limit 1
      `,
      [store, value]
    );
    if (r.rowCount) {
      const row = r.rows[0];
      return { asin_input: null, upc: row.upc || null, pci: row.pci || null, seed_listing: row };
    }
    return { asin_input: null, upc: null, pci: null, seed_listing: null };
  }

  // raw fallback: try like upc/asin/pci guesses
  if (isLikelyASIN(value)) return findSeedFromListings(client, { kind: 'asin', value: value.toUpperCase() });
  if (isLikelyUPC(value)) return findSeedFromListings(client, { kind: 'upc', value });
  if (isLikelyPCI(value)) return findSeedFromListings(client, { kind: 'pci', value });
  return { asin_input: null, upc: null, pci: null, seed_listing: null };
}

async function resolveCatalogIdentity(client, seedKeys) {
  const pci = seedKeys?.pci ? String(seedKeys.pci).trim() : '';
  const upc = seedKeys?.upc ? String(seedKeys.upc).trim() : '';

  const pick = (rows) => (rows && rows.length ? rows[0] : null);

  // 1) PCI
  if (pci) {
    const r = await client.query(
      `
      select id, upc, pci, model_name, model_number, brand, category, image_url,
        version, color, variant, dimensions, specs, media, marketing_images, timeline, files, contents, about, created_at,
        dropship_warning, recall_url, coverage_warning
      from public.catalog
      where pci is not null and btrim(pci) <> ''
        and upper(btrim(pci)) = upper(btrim($1))
      order by created_at desc
      limit 1
      `,
      [pci]
    );
    const row = pick(r.rows);
    if (row) return row;
  }

  // 2) UPC
  if (upc) {
    const r = await client.query(
      `
      select id, upc, pci, model_name, model_number, brand, category, image_url,
        version, color, variant, dimensions, specs, media, marketing_images, timeline, files, contents, about, created_at,
        dropship_warning, recall_url, coverage_warning
      from public.catalog
      where norm_upc(upc) = norm_upc($1)
      order by created_at desc
      limit 1
      `,
      [upc]
    );
    const row = pick(r.rows);
    if (row) return row;
  }

  return null;
}

async function getColorGroupKeysFromCatalog(client, catalogIdentity, fallbackKeys = null) {
  const brand = String(catalogIdentity?.brand || '').trim();
  const modelNumber = String(catalogIdentity?.model_number || '').trim();
  const version = String(catalogIdentity?.version || '').trim();
  const variant = String(catalogIdentity?.variant || '').trim();

  const fallbackPci = String(fallbackKeys?.pci || '').trim();
  const fallbackUpc = String(fallbackKeys?.upc || '').trim();

  if (!brand || !modelNumber) {
    return {
      pcis: fallbackPci ? [fallbackPci] : [],
      upcs: fallbackUpc ? [fallbackUpc] : []
    };
  }

  const r = await client.query(
    `
    SELECT pci, upc
    FROM public.catalog
    WHERE brand IS NOT NULL
      AND btrim(brand) <> ''
      AND lower(btrim(brand)) = lower(btrim($1))
      AND model_number IS NOT NULL
      AND btrim(model_number) <> ''
      AND upper(btrim(model_number)) = upper(btrim($2))
      AND COALESCE(NULLIF(btrim(version), ''), '') = COALESCE(NULLIF(btrim($3), ''), '')
      AND COALESCE(NULLIF(btrim(variant), ''), '') = COALESCE(NULLIF(btrim($4), ''), '')
    `,
    [brand, modelNumber, version, variant]
  );

  const pciSet = new Set();
  const upcSet = new Set();

  for (const row of r.rows || []) {
    const pci = String(row?.pci || '').trim();
    const upc = String(row?.upc || '').trim();

    if (pci) pciSet.add(pci);
    if (upc) upcSet.add(upc);
  }

  if (!pciSet.size && fallbackPci) pciSet.add(fallbackPci);
  if (!upcSet.size && fallbackUpc) upcSet.add(fallbackUpc);

  return {
    pcis: [...pciSet],
    upcs: [...upcSet]
  };
}

async function getVariantsFromCatalog(client, catalogIdentity) {
  const modelNumber = catalogIdentity?.model_number ? String(catalogIdentity.model_number).trim() : '';
  if (!modelNumber) return [];

  const brand = catalogIdentity?.brand ? String(catalogIdentity.brand).trim() : '';

  // If we do not have a brand, do not trust model_number alone.
  if (!brand) {
    const row = catalogIdentity;
    const key =
      (row.pci && String(row.pci).trim() ? `pci:${String(row.pci).trim()}` : null) ||
      (row.upc && String(row.upc).trim() ? `upc:${String(row.upc).trim()}` : null);

    return key ? [{
      id: row.id,
      key,
      upc: row.upc || null,
      pci: row.pci || null,
      model_name: row.model_name || null,
      model_number: row.model_number || null,
      variant_label: (row.version && row.color) ? `${row.version} • ${row.color}` : (row.version || row.color || 'Default'),
      version: row.version || null,
      variant: row.variant || null,
      color: row.color || null,
      brand: row.brand || null,
      category: row.category || null,
      image_url: row.image_url || null,
      dimensions: (row.dimensions && typeof row.dimensions === 'object' && !Array.isArray(row.dimensions)) ? row.dimensions : null,
      specs: (row.specs && typeof row.specs === 'object' && !Array.isArray(row.specs)) ? row.specs : null,
      timeline: Array.isArray(row.timeline) ? row.timeline : null,
      media: Array.isArray(row.media) ? row.media : null,
      marketing_images: Array.isArray(row.marketing_images)
      ? row.marketing_images
          .map(v => String(v || '').trim())
          .filter(Boolean)
      : null,
      files: (
        row.files &&
        typeof row.files === 'object' &&
        (Array.isArray(row.files) || Array.isArray(row.files.items))
      ) ? row.files : null,
      contents: Array.isArray(row.contents) ? row.contents : null,
      about: (row.about && typeof row.about === 'object' && !Array.isArray(row.about)) ? row.about : null
    }] : [];
  }

  const r = await client.query(
    `
    select id, upc, pci, model_name, model_number, brand, category, image_url,
      version, color, variant, dimensions, specs, media, timeline, files, contents, about, created_at
    from public.catalog
    where model_number is not null and btrim(model_number) <> ''
      and upper(btrim(model_number)) = upper(btrim($1))
      and brand is not null and btrim(brand) <> ''
      and lower(btrim(brand)) = lower(btrim($2))
    order by
      (case when version is null or btrim(version) = '' then 1 else 0 end),
      version nulls last,
      (case when variant is null or btrim(variant) = '' then 1 else 0 end),
      variant nulls last,
      (case when color is null or btrim(color) = '' then 1 else 0 end),
      color nulls last,
      (case when category is null or btrim(category) = '' then 1 else 0 end),
      lower(btrim(category)) nulls last,
      id
    limit 500
    `,
    [modelNumber, brand]
  );

  return (r.rows || [])
    .map((row) => {
      const key =
        (row.pci && String(row.pci).trim() ? `pci:${String(row.pci).trim()}` : null) ||
        (row.upc && String(row.upc).trim() ? `upc:${String(row.upc).trim()}` : null);

      if (!key) return null;

      const v = row.version && String(row.version).trim();
      const c = row.color && String(row.color).trim();
      const label =
        (v && c ? `${v} • ${c}` : (v || c)) ||
        (row.model_name && String(row.model_name).trim()) ||
        'Default';

      return {
        id: row.id,
        key,
        upc: row.upc || null,
        pci: row.pci || null,
        model_name: row.model_name || null,
        model_number: row.model_number || null,
        variant_label: label,
        version: row.version || null,
        variant: row.variant || null,
        color: row.color || null,
        brand: row.brand || null,
        category: row.category || null,
        image_url: row.image_url || null,
        dimensions: (row.dimensions && typeof row.dimensions === 'object' && !Array.isArray(row.dimensions)) ? row.dimensions : null,
        specs: (row.specs && typeof row.specs === 'object' && !Array.isArray(row.specs)) ? row.specs : null,
        timeline: Array.isArray(row.timeline) ? row.timeline : null,
        media: Array.isArray(row.media) ? row.media : null,
        files: (
          row.files &&
          typeof row.files === 'object' &&
          (Array.isArray(row.files) || Array.isArray(row.files.items))
        ) ? row.files : null,
        contents: Array.isArray(row.contents) ? row.contents : null,
        about: (row.about && typeof row.about === 'object' && !Array.isArray(row.about)) ? row.about : null,
        marketing_images: Array.isArray(row.marketing_images) ? row.marketing_images : null
      };
    })
    .filter(Boolean);
}

const OFFER_COLS = `
  store, store_sku, upc, pci, url, offer_tag,
  current_price_cents, current_price_observed_at, created_at,
  coupon_text,
  coupon_type,
  coupon_value_cents,
  coupon_value_pct,
  coupon_requires_clip,
  coupon_code,
  coupon_expires_at,
  effective_price_cents,
  coupon_observed_at
`;

function rowToOfferCandidate(row) {
  const storeKey = normStoreKey(row.store);

  return {
    store: storeKey,
    store_sku: row.store_sku || null,
    url: row.url || null,
    title: row.title || null,
    offer_tag: row.offer_tag || null,

    price_cents: row.current_price_cents ?? null,
    effective_price_cents: row.effective_price_cents ?? null,

    coupon_text: row.coupon_text || null,
    coupon_type: row.coupon_type || null,
    coupon_value_cents: row.coupon_value_cents ?? null,
    coupon_value_pct: row.coupon_value_pct ?? null,
    coupon_requires_clip: row.coupon_requires_clip ?? null,
    coupon_code: row.coupon_code || null,
    coupon_expires_at: row.coupon_expires_at || null,
    coupon_observed_at: row.coupon_observed_at || null,

    // Use coalesce for ordering and UI
    observed_at: row.current_price_observed_at ?? row.created_at ?? null,

    upc: row.upc || null,
    pci: row.pci || null
  };
}

/**
 * Offers: match by PCI/UPC. If PCI/UPC missing, still return the exact seed listing.
 * Multi-offer rule: Amazon can have multiple rows. Non-Amazon is newest per store.
 */
async function getOffersForSelectedVariant(client, selectedKeys, seed) {
  const pci = selectedKeys?.pci ? String(selectedKeys.pci).trim() : '';
  const upc = selectedKeys?.upc ? String(selectedKeys.upc).trim() : '';

  let rows = [];

  // 1) If we have PCI/UPC, pull matching offers
  if (pci || upc) {
    const r = await client.query(
      `
      select ${OFFER_COLS}
      from public.listings
      where
        (
          ($1::text <> '' and pci is not null and btrim(pci) <> '' and upper(btrim(pci)) = upper(btrim($1)))
          or
          ($2::text <> '' and norm_upc(upc) = norm_upc($2))
        )
        and coalesce(nullif(lower(btrim(status)), ''), 'active') <> 'hidden'
      order by coalesce(current_price_observed_at, created_at) desc nulls last
      limit 2000
      `,
      [pci, upc]
    );
    rows = r.rows || [];
  }

  // 2) Always try to include the exact seed listing (helps when PCI/UPC missing)
  const seedStore = seed?.seed_listing?.store || null;
  const seedSku = seed?.seed_listing?.store_sku || null;

  if (seedStore && seedSku) {
    const rSeed = await client.query(
      `
      select ${OFFER_COLS}
      from public.listings
      where replace(lower(btrim(store)), ' ', '') = replace(lower(btrim($1)), ' ', '')
        and norm_sku(store_sku) = norm_sku($2)
        and coalesce(nullif(lower(btrim(status)), ''), 'active') <> 'hidden'
      order by current_price_observed_at desc nulls last, created_at desc
      limit 1
      `,
      [seedStore, seedSku]
    );

    const seedRow = rSeed.rowCount ? rSeed.rows[0] : null;
    if (seedRow) {
      const want = uniqOfferKey(seedRow.store, seedRow.store_sku);
      const have = new Set(rows.map(r => uniqOfferKey(r.store, r.store_sku)));
      if (!have.has(want)) rows.push(seedRow);
    }
  }

  if (!rows.length) return [];

  // Convert to candidates
  const candidates = rows.map(rowToOfferCandidate);

  // Sort newest first (so first per store is newest)
  candidates.sort((a, b) => {
    const ta = a.observed_at ? new Date(a.observed_at).getTime() : 0;
    const tb = b.observed_at ? new Date(b.observed_at).getTime() : 0;
    return tb - ta;
  });

  const amazon = [];
  const nonAmazonBestByStore = new Map(); // newest per store

  for (const c of candidates) {
    const st = normStoreKey(c.store);
    if (!st) continue;

    if (st === 'amazon') {
      amazon.push(c);
      continue;
    }

    if (!nonAmazonBestByStore.has(st)) {
      nonAmazonBestByStore.set(st, c);
    }
  }

  const AMAZON_MAX = 10;
  const amazonCapped = amazon.slice(0, AMAZON_MAX);

  const nonAmazon = Array.from(nonAmazonBestByStore.values());
  nonAmazon.sort((a, b) => a.store.localeCompare(b.store));

  return [...amazonCapped, ...nonAmazon];
}

async function resolveSelectedVariant(client, rawKey) {
  const parsed = parseKey(rawKey);

  if (parsed.kind === 'pci') return { pci: parsed.value, upc: null };
  if (parsed.kind === 'upc') return { pci: null, upc: parsed.value };

  if (parsed.kind === 'asin') {
    // convert ASIN -> (pci/upc) using listings
    const r = await client.query(
      `
      select upc, pci
      from public.listings
      where lower(btrim(store)) = 'amazon'
        and norm_sku(store_sku) = norm_sku($1)
        and coalesce(nullif(lower(btrim(status)), ''), 'active') <> 'hidden'
      order by current_price_observed_at desc nulls last, created_at desc
      limit 1
      `,
      [parsed.value.toUpperCase()]
    );
    if (!r.rowCount) return { pci: null, upc: null };
    const row = r.rows[0];
    return { pci: row.pci || null, upc: row.upc || null };
  }

  if (parsed.kind === 'bby' || parsed.kind === 'wal' || parsed.kind === 'tcin') {
    const store = storeForKind(parsed.kind);
    const r = await client.query(
      `
      select upc, pci
      from public.listings
      where replace(lower(btrim(store)), ' ', '') = $1
        and norm_sku(store_sku) = norm_sku($2)
        and coalesce(nullif(lower(btrim(status)), ''), 'active') <> 'hidden'
      order by current_price_observed_at desc nulls last, created_at desc
      limit 1
      `,
      [store, parsed.value]
    );
    if (!r.rowCount) return { pci: null, upc: null };
    const row = r.rows[0];
    return { pci: row.pci || null, upc: row.upc || null };
  }

  // raw guess
  if (isLikelyUPC(parsed.value)) return { pci: null, upc: parsed.value };
  if (isLikelyPCI(parsed.value)) return { pci: parsed.value, upc: null };
  if (isLikelyASIN(parsed.value)) return resolveSelectedVariant(client, `asin:${parsed.value.toUpperCase()}`);

  return { pci: null, upc: null };
}

async function getPriceHistoryDailyAndStats(client, selectedKeys, days) {
  const pci = String(selectedKeys?.pci || '').trim();
  const upc = String(selectedKeys?.upc || '').trim();

  // If we do not have a stable anchor, do not run heavy history queries.
  if (!pci && !upc) {
    return {
      daily: [],
      stats: {
        typical_low_90_cents: null,
        typical_low_30_cents: null,
        low_30_cents: null,
        low_30_date: null
      }
    };
  }

  // Daily lows
  const dailySql = `
    with base as (
      select
        (date_trunc('day', observed_at at time zone 'utc'))::date as d,
        coalesce(effective_price_cents, price_cents) as p
      from public.price_history
      where observed_at >= now() - make_interval(days => $3::int)
        and (
          ($1 <> '' and pci is not null and btrim(pci) <> '' and upper(btrim(pci)) = upper(btrim($1)))
          or
          ($2 <> '' and norm_upc(upc) = norm_upc($2))
        )
        and coalesce(effective_price_cents, price_cents) is not null
        and coalesce(effective_price_cents, price_cents) > 0
    )
    select d::text as d, min(p)::int as price_cents
    from base
    group by d
    order by d asc;
  `;

  const dailyRes = await client.query(dailySql, [pci, upc, days]);

  // Stats computed from daily lows (not raw events)
  const statsSql = `
    with daily as (
      select
        (date_trunc('day', observed_at at time zone 'utc'))::date as d,
        min(coalesce(effective_price_cents, price_cents))::int as low_cents
      from public.price_history
      where observed_at >= now() - make_interval(days => $3::int)
        and (
          ($1 <> '' and pci is not null and btrim(pci) <> '' and upper(btrim(pci)) = upper(btrim($1)))
          or
          ($2 <> '' and norm_upc(upc) = norm_upc($2))
        )
        and coalesce(effective_price_cents, price_cents) is not null
        and coalesce(effective_price_cents, price_cents) > 0
      group by 1
    ),
    lows30 as (
      select * from daily where d >= (now() at time zone 'utc')::date - 30
    )
    select
      percentile_cont(0.20) within group (order by low_cents)
        filter (where d >= (now() at time zone 'utc')::date - 90) as typical_low_90_cents,
      percentile_cont(0.20) within group (order by low_cents)
        filter (where d >= (now() at time zone 'utc')::date - 30) as typical_low_30_cents,
      (select min(low_cents) from lows30) as low_30_cents,
      (select d from lows30 order by low_cents asc, d asc limit 1) as low_30_date
    from daily
  `;

  const statsRes = await client.query(statsSql, [pci, upc, days]);

  const statsRow = statsRes.rows[0] || {};
  const stats = {
    typical_low_90_cents: statsRow.typical_low_90_cents != null ? Math.round(Number(statsRow.typical_low_90_cents)) : null,
    typical_low_30_cents: statsRow.typical_low_30_cents != null ? Math.round(Number(statsRow.typical_low_30_cents)) : null,
    low_30_cents: statsRow.low_30_cents != null ? Number(statsRow.low_30_cents) : null,
    low_30_date: statsRow.low_30_date || null,
  };

  return { daily: dailyRes.rows, stats };
}

async function getSeoForRawKey(client, rawKey) {
  const parsed = parseKey(rawKey);

  // seed from listings
  const seed = await findSeedFromListings(client, parsed);
  const hasAny =
    !!seed?.upc || !!seed?.pci || !!seed?.seed_listing;

  if (!hasAny) return null;

  // catalog identity from seed (PCI -> UPC)
  const catalogIdentity = await resolveCatalogIdentity(client, seed);

  // selected keys from incoming key (asin/bby/wal/tcin can map to pci/upc)
  const selectedBase = await resolveSelectedVariant(client, rawKey);
  const selectedCatalog = await resolveCatalogIdentity(client, selectedBase);

  const selectedKeys = {
    pci: (selectedCatalog?.pci || selectedBase.pci || seed.pci || null),
    upc: (selectedCatalog?.upc || selectedBase.upc || seed.upc || null)
  };

  // canonical key preference: PCI -> UPC -> fallback to incoming kind/value
  const canonicalKey =
    (selectedKeys.pci ? `pci:${String(selectedKeys.pci).trim()}` : null) ||
    (selectedKeys.upc ? `upc:${String(selectedKeys.upc).trim()}` : null) ||
    `${parsed.kind}:${parsed.value}`;

  const meta = selectedCatalog || catalogIdentity || null;
  const listingTitle = seed?.seed_listing?.title ? String(seed.seed_listing.title).trim() : '';

  const title = String(meta?.model_name || listingTitle || 'Product').trim() || 'Product';
  const image_url = meta?.image_url ? String(meta.image_url).trim() : '';

  return { title, image_url: image_url || null, canonicalKey };
}

function communityDisplayName(row) {
  return String(
    row?.nickname ||
    row?.display_name ||
    'User'
  ).trim() || 'User';
}

function safeInt(val) {
  const n = Number(val);
  return Number.isFinite(n) ? n : 0;
}

const SESSION_COOKIE_NAME = 'pc_session';

function cleanText(v) {
  return String(v || '').trim();
}

function collapseSpaces(v) {
  return cleanText(v).replace(/\s+/g, ' ');
}

function normalizeSpamText(v) {
  return collapseSpaces(v).toLowerCase();
}

function toPositiveInt(v) {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

async function getSignedInUserId(req) {
  const attachedUserId =
    toPositiveInt(req.user?.id) ||
    toPositiveInt(req.authUser?.id);

  if (attachedUserId) return attachedUserId;

  const rawToken = cleanText(req.cookies?.[SESSION_COOKIE_NAME]);
  if (!rawToken) return null;

  const tokenHash = hashSessionToken(rawToken);

  const q = await pool.query(
    `
    SELECT
      u.id,
      s.id AS session_id
    FROM public.user_sessions s
    JOIN public.users u
      ON u.id = s.user_id
    WHERE s.session_token_hash = $1
      AND s.revoked_at IS NULL
      AND s.expires_at > now()
      AND u.is_active = true
    LIMIT 1
    `,
    [tokenHash]
  );

  const row = q.rows[0];
  if (!row) return null;

  await pool.query(
    `
    UPDATE public.user_sessions
    SET last_seen_at = now()
    WHERE id = $1
    `,
    [row.session_id]
  ).catch(() => {});

  return toPositiveInt(row.id);
}

function validateCommunityAnswerPayload(input) {
  const body = collapseSpaces(input?.body || '');

  if (!body || body.length < 2) {
    return { ok: false, error: 'Reply is too short.' };
  }

  if (body.length > 1000) {
    return { ok: false, error: 'Reply is too long.' };
  }

  return {
    ok: true,
    value: { body }
  };
}

function validateCommunityPayload(input) {
  const postType = cleanText(input?.post_type).toLowerCase();
  const title = collapseSpaces(input?.title || '');
  const body = collapseSpaces(input?.body || '');
  const ratingRaw = input?.rating;
  const visitedAtRaw = cleanText(input?.visited_at || '');

  if (!['tip', 'question', 'review'].includes(postType)) {
    return { ok: false, error: 'Invalid post type.' };
  }

  if (postType === 'tip') {
    if (!body || body.length < 8) {
      return { ok: false, error: 'Tip is too short.' };
    }
    if (body.length > 600) {
      return { ok: false, error: 'Tip is too long.' };
    }

    let visitedAt = null;
    if (visitedAtRaw) {
      const d = new Date(visitedAtRaw);
      if (Number.isNaN(d.getTime())) {
        return { ok: false, error: 'Visited date is invalid.' };
      }
      visitedAt = visitedAtRaw.slice(0, 10);
    }

    return {
      ok: true,
      value: {
        post_type: 'tip',
        title: null,
        body,
        rating: null,
        visited_at: visitedAt
      }
    };
  }

  if (postType === 'question') {
    if (!title || title.length < 6) {
      return { ok: false, error: 'Question title is too short.' };
    }
    if (title.length > 160) {
      return { ok: false, error: 'Question title is too long.' };
    }
    if (!body || body.length < 8) {
      return { ok: false, error: 'Question details are too short.' };
    }
    if (body.length > 1000) {
      return { ok: false, error: 'Question details are too long.' };
    }

    return {
      ok: true,
      value: {
        post_type: 'question',
        title,
        body,
        rating: null,
        visited_at: null
      }
    };
  }

  if (postType === 'review') {
    const rating = Number(ratingRaw);

    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return { ok: false, error: 'Review rating must be 1 to 5.' };
    }
    if (!body || body.length < 12) {
      return { ok: false, error: 'Review is too short.' };
    }
    if (body.length > 1200) {
      return { ok: false, error: 'Review is too long.' };
    }

    return {
      ok: true,
      value: {
        post_type: 'review',
        title: null,
        body,
        rating,
        visited_at: null
      }
    };
  }

  return { ok: false, error: 'Invalid post.' };
}

// -------------------------
// routes
// -------------------------
router.get(['/dashboard', '/dashboard/'], (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'dashboard', 'index.html'));
});

const ALLOWED_KIND = new Set(['asin', 'upc', 'pci', 'tcin', 'bby', 'wal']);

async function serveDashboardIndexWithSeo(req, res, next) {
  const kind = String(req.params.kind || '').toLowerCase();
  if (!ALLOWED_KIND.has(kind)) return next();

  const value = String(req.params.value || '').trim();
  const rawKey = `${kind}:${value}`;

  const client = await pool.connect();
  try {
    const seo = await getSeoForRawKey(client, rawKey);

    // No match, serve the generic dashboard
    if (!seo) {
      return res.sendFile(DASHBOARD_INDEX_PATH);
    }

    const canonicalPath = canonicalPathFromKey(seo.canonicalKey, seo.title);
    const canonicalUrl = `${CANONICAL_ORIGIN}${canonicalPath}`;

    const pageTitle = `${seo.title} - PriceCheck`;
    const desc = seoDescription(seo.title);
    const imageUrl = absImageUrl(seo.image_url);

    // Index only the pretty, correct-slug, PCI canonical page
    const canonicalKind = String(seo.canonicalKey || '').split(':')[0].toLowerCase();
    const canonicalVal  = String(seo.canonicalKey || '').split(':').slice(1).join(':').trim();

    const reqSlug = req.params.slug ? String(req.params.slug).trim() : '';
    const wantSlug = slugifyTitleServer(seo.title);

    const isPretty = !!req.params.slug;
    const isCanonicalPci =
      canonicalKind === 'pci' &&
      kind === 'pci' &&
      String(value).trim().toUpperCase() === String(canonicalVal).trim().toUpperCase() &&
      isPretty &&
      reqSlug === wantSlug;

    const robots = isCanonicalPci ? 'index,follow' : 'noindex,follow';

    const html = renderDashboardHtml({
      pageTitle,
      desc,
      canonicalUrl,
      robots,
      imageUrl
    });

    return res.status(200).type('html').send(html);
  } catch (e) {
    console.error(e);
    return res.sendFile(DASHBOARD_INDEX_PATH);
  } finally {
    client.release();
  }
}

// Canonical key-in-path pages (no slug)
router.get(['/dashboard/:kind/:value', '/dashboard/:kind/:value/'], serveDashboardIndexWithSeo);

// Canonical slug + key-in-path pages
router.get(['/dashboard/:slug/:kind/:value', '/dashboard/:slug/:kind/:value/'], serveDashboardIndexWithSeo);

router.get('/api/compare/:key', async (req, res) => {
  const rawKey = req.params.key;

  const client = await pool.connect();
  try {
    const parsed = parseKey(rawKey);

    // 1) seed keys come from listings resolution (TCIN/BBY/WAL/ASIN all work here)
    const seed = await findSeedFromListings(client, parsed);

    // If literally nothing was found (must have a listing row, or at least a PCI/UPC anchor)
    const hasMatch = !!seed?.seed_listing || !!seed?.upc || !!seed?.pci;
    if (!hasMatch) {
      return res.status(404).json({
        ok: false,
        error: 'not_found',
        hint: 'Try prefixes like asin:..., upc:..., pci:..., bby:..., wal:..., tcin:...'
      });
    }

    // 2) catalog identity via PCI -> UPC
    const catalogIdentity = await resolveCatalogIdentity(client, seed);

    // 3) variants by model_number (from catalog)
    const variants = catalogIdentity ? await getVariantsFromCatalog(client, catalogIdentity) : [];

    // 4) resolve selected variant (based on incoming key)
    const selectedBase = await resolveSelectedVariant(client, rawKey);

    // Enrich through catalog (PCI -> UPC)
    const selectedCatalog = await resolveCatalogIdentity(client, selectedBase);

    const selectedKeys = {
      pci: (selectedCatalog?.pci || selectedBase.pci || seed.pci || null),
      upc: (selectedCatalog?.upc || selectedBase.upc || seed.upc || null)
    };

    // 5) offers for selected variant (PCI/UPC only, but always include seed listing)
    const offers = await getOffersForSelectedVariant(client, selectedKeys, seed);

    // 7) price history (only if PCI/UPC exists)
    const history = await getPriceHistoryDailyAndStats(client, selectedKeys, 90);

    const meta = selectedCatalog || catalogIdentity || null;
    const listingTitle = seed?.seed_listing?.title ? String(seed.seed_listing.title).trim() : '';

    const brand =
    (meta?.brand && String(meta.brand).trim()) ||
    '';

    const families = brand ? await getFamiliesForBrand(client, brand) : [];

const anchorPriceCents = (offers || [])
  .map((o) => {
    const p = Number(o?.price_cents);
    const e = Number(o?.effective_price_cents);

    if (Number.isFinite(e) && e > 0 && (!Number.isFinite(p) || p <= 0 || e <= p)) {
      return e;
    }

    if (Number.isFinite(p) && p > 0) {
      return p;
    }

    return null;
  })
  .filter((v) => typeof v === 'number' && v > 0)
  .sort((a, b) => a - b)[0] || null;

const similar = meta ? await getSimilarProducts(client, meta, anchorPriceCents, 48) : [];
const lineup = meta ? await getLineupData(client, meta) : null;

    return res.json({
      ok: true,
      identity: {
        // seed keys (what we found in listings)
        pci: seed.pci || null,
        upc: seed.upc || null,
        // keep ASIN only as an input echo for the UI, never used for matching
        asin: seed.asin_input || null,
        timeline: Array.isArray(meta?.timeline) ? meta.timeline : null,

        // catalog meta (fallback to listing title for model_name if catalog missing)
        model_number: meta?.model_number || null,
        model_name: (meta?.model_name || listingTitle || null),
        brand: meta?.brand || null,
        category: meta?.category || null,
        image_url: meta?.image_url || null,
        dimensions: (meta?.dimensions && typeof meta.dimensions === 'object' && !Array.isArray(meta.dimensions)) ? meta.dimensions : null,
        specs: (meta?.specs && typeof meta.specs === 'object' && !Array.isArray(meta.specs)) ? meta.specs : null,
        media: Array.isArray(meta?.media) ? meta.media : null,
        marketing_images: Array.isArray(meta?.marketing_images)
          ? meta.marketing_images.map(v => String(v || '').trim()).filter(Boolean)
          : null,
        files: (
          meta?.files &&
          typeof meta.files === 'object' &&
          (Array.isArray(meta.files) || Array.isArray(meta.files.items))
        ) ? meta.files : null,
        contents: Array.isArray(meta?.contents) ? meta.contents : null,
        about: (meta?.about && typeof meta.about === 'object' && !Array.isArray(meta.about)) ? meta.about : null,
        dropship_warning: !!meta?.dropship_warning,
        recall_url: meta?.recall_url || null,
        coverage_warning: !!meta?.coverage_warning,

        // selected anchors (PCI/UPC only)
        selected_pci: selectedKeys.pci || null,
        selected_upc: selectedKeys.upc || null,
        selected_asin: null
      },
      variants,
      families,
      similar,
      lineup,
      selected_variant: {
        key:
          (selectedKeys.pci ? `pci:${selectedKeys.pci}` : null) ||
          (selectedKeys.upc ? `upc:${selectedKeys.upc}` : null)
      },
      offers,
      history
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: 'server_error' });
  } finally {
    client.release();
  }
});

router.get('/api/community/:key', async (req, res) => {
  const rawKey = req.params.key;
  const client = await pool.connect();

  try {
    const parsed = parseKey(rawKey);
    const seed = await findSeedFromListings(client, parsed);

    const selectedBase = await resolveSelectedVariant(client, rawKey);
    const selectedCatalog = await resolveCatalogIdentity(client, selectedBase);

    const selectedKeys = {
      pci: (selectedCatalog?.pci || selectedBase.pci || seed.pci || null),
      upc: (selectedCatalog?.upc || selectedBase.upc || seed.upc || null)
    };

    const pci = String(selectedKeys.pci || '').trim();
    const upc = String(selectedKeys.upc || '').trim();

    const colorGroupKeys = await getColorGroupKeysFromCatalog(
      client,
      selectedCatalog || null,
      selectedKeys
    );

    const groupPcisUpper = (Array.isArray(colorGroupKeys?.pcis) ? colorGroupKeys.pcis : [])
      .map(v => String(v || '').trim().toUpperCase())
      .filter(Boolean);

    const groupUpcsRaw = (Array.isArray(colorGroupKeys?.upcs) ? colorGroupKeys.upcs : [])
      .map(v => String(v || '').trim())
      .filter(Boolean);

    if (!pci && !upc) {
      return res.json({
        ok: true,
        identity: {
          selected_pci: null,
          selected_upc: null
        },
        counts: {
          tips: 0,
          questions: 0,
          reviews: 0
        },
        tips: [],
        questions: [],
        reviews: []
      });
    }

    const countsRes = await client.query(
      `
      SELECT
        post_type,
        COUNT(*)::int AS n
      FROM public.community_posts
      WHERE is_public = true
        AND (
          (
            coalesce(array_length($1::text[], 1), 0) > 0
            AND product_pci IS NOT NULL
            AND btrim(product_pci) <> ''
            AND upper(btrim(product_pci)) = ANY($1::text[])
          )
          OR
          (
            coalesce(array_length($2::text[], 1), 0) > 0
            AND product_upc IS NOT NULL
            AND btrim(product_upc) <> ''
            AND norm_upc(product_upc) = ANY(
              ARRAY(
                SELECT norm_upc(x)
                FROM unnest($2::text[]) AS x
              )
            )
          )
        )
      GROUP BY post_type
      `,
      [groupPcisUpper, groupUpcsRaw]
    );

    const counts = {
      tips: 0,
      questions: 0,
      reviews: 0
    };

    for (const row of countsRes.rows || []) {
      const type = String(row.post_type || '').trim();
      const n = safeInt(row.n);
      if (type === 'tip') counts.tips = n;
      if (type === 'question') counts.questions = n;
      if (type === 'review') counts.reviews = n;
    }

    const tipsRes = await client.query(
      `
      SELECT
        p.id,
        p.body,
        p.visited_at,
        p.created_at,
        u.display_name,
        u.nickname,
        u.profile_image_url
      FROM public.community_posts p
      LEFT JOIN public.users u
        ON u.id = p.user_id
      WHERE p.is_public = true
        AND p.post_type = 'tip'
        AND 
        (
          (
            coalesce(array_length($1::text[], 1), 0) > 0
            AND p.product_pci IS NOT NULL
            AND btrim(p.product_pci) <> ''
            AND upper(btrim(p.product_pci)) = ANY($1::text[])
          )
          OR
          (
            coalesce(array_length($2::text[], 1), 0) > 0
            AND p.product_upc IS NOT NULL
            AND btrim(p.product_upc) <> ''
            AND norm_upc(p.product_upc) = ANY(
              ARRAY(
                SELECT norm_upc(x)
                FROM unnest($2::text[]) AS x
              )
            )
          )
        )
      ORDER BY coalesce(p.visited_at::timestamp, p.created_at) DESC, p.created_at DESC
      LIMIT 12
      `,
      [groupPcisUpper, groupUpcsRaw]
    );

    const questionsRes = await client.query(
  `
  SELECT
    p.id,
    p.title,
    p.body,
    p.created_at,
    u.display_name,
    u.nickname,
    u.profile_image_url,
    COUNT(a.id)::int AS answer_count
  FROM public.community_posts p
  LEFT JOIN public.users u
    ON u.id = p.user_id
  LEFT JOIN public.community_answers a
    ON a.question_id = p.id
   AND a.is_public = true
  WHERE p.is_public = true
    AND p.post_type = 'question'
    AND 
    (
      (
        coalesce(array_length($1::text[], 1), 0) > 0
        AND p.product_pci IS NOT NULL
        AND btrim(p.product_pci) <> ''
        AND upper(btrim(p.product_pci)) = ANY($1::text[])
      )
      OR
      (
        coalesce(array_length($2::text[], 1), 0) > 0
        AND p.product_upc IS NOT NULL
        AND btrim(p.product_upc) <> ''
        AND norm_upc(p.product_upc) = ANY(
          ARRAY(
            SELECT norm_upc(x)
            FROM unnest($2::text[]) AS x
          )
        )
      )
    )
  GROUP BY
    p.id,
    p.title,
    p.body,
    p.created_at,
    u.display_name,
    u.nickname,
    u.profile_image_url
  ORDER BY
    COUNT(a.id) DESC,
    p.created_at DESC
  LIMIT 20
  `,
  [groupPcisUpper, groupUpcsRaw]
);

    const reviewsRes = await client.query(
      `
      SELECT
        p.id,
        p.body,
        p.rating,
        p.created_at,
        u.display_name,
        u.nickname,
        u.profile_image_url
      FROM public.community_posts p
      LEFT JOIN public.users u
        ON u.id = p.user_id
      WHERE p.is_public = true
        AND p.post_type = 'review'
        AND 
        (
          (
            coalesce(array_length($1::text[], 1), 0) > 0
            AND p.product_pci IS NOT NULL
            AND btrim(p.product_pci) <> ''
            AND upper(btrim(p.product_pci)) = ANY($1::text[])
          )
          OR
          (
            coalesce(array_length($2::text[], 1), 0) > 0
            AND p.product_upc IS NOT NULL
            AND btrim(p.product_upc) <> ''
            AND norm_upc(p.product_upc) = ANY(
              ARRAY(
                SELECT norm_upc(x)
                FROM unnest($2::text[]) AS x
              )
            )
          )
        )
      ORDER BY p.created_at DESC
      LIMIT 12
      `,
      [groupPcisUpper, groupUpcsRaw]
    );

    return res.json({
      ok: true,
      identity: {
        selected_pci: selectedKeys.pci || null,
        selected_upc: selectedKeys.upc || null
      },
      counts,
      tips: (tipsRes.rows || []).map((row) => ({
        id: row.id,
        body: row.body || '',
        visited_at: row.visited_at || null,
        created_at: row.created_at || null,
        author_name: communityDisplayName(row),
        profile_image_url: row.profile_image_url || null
      })),
      questions: (questionsRes.rows || []).map((row) => ({
        id: row.id,
        title: row.title || '',
        body: row.body || '',
        created_at: row.created_at || null,
        answer_count: safeInt(row.answer_count),
        author_name: communityDisplayName(row),
        profile_image_url: row.profile_image_url || null
      })),
      reviews: (reviewsRes.rows || []).map((row) => ({
        id: row.id,
        body: row.body || '',
        rating: safeInt(row.rating),
        created_at: row.created_at || null,
        author_name: communityDisplayName(row),
        profile_image_url: row.profile_image_url || null
      }))
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({
      ok: false,
      error: 'community_error'
    });
  } finally {
    client.release();
  }
});

router.get('/api/community/question/:questionId/answers', async (req, res) => {
  const questionId = toPositiveInt(req.params.questionId);
  if (!questionId) {
    return res.status(400).json({ ok: false, error: 'Invalid question id.' });
  }

  const client = await pool.connect();

  try {
    const questionRes = await client.query(
      `
      SELECT
        p.id,
        p.title,
        p.body,
        p.created_at,
        u.display_name,
        u.nickname,
        u.profile_image_url
      FROM public.community_posts p
      LEFT JOIN public.users u
        ON u.id = p.user_id
      WHERE p.id = $1
        AND p.post_type = 'question'
        AND p.is_public = true
      LIMIT 1
      `,
      [questionId]
    );

    const question = questionRes.rows[0];
    if (!question) {
      return res.status(404).json({ ok: false, error: 'Question not found.' });
    }

    const answersRes = await client.query(
      `
      SELECT
        a.id,
        a.body,
        a.created_at,
        u.display_name,
        u.nickname,
        u.profile_image_url
      FROM public.community_answers a
      LEFT JOIN public.users u
        ON u.id = a.user_id
      WHERE a.question_id = $1
        AND a.is_public = true
      ORDER BY a.created_at ASC, a.id ASC
      `,
      [questionId]
    );

    return res.json({
      ok: true,
      question: {
        id: question.id,
        title: question.title || '',
        body: question.body || '',
        created_at: question.created_at || null,
        author_name: communityDisplayName(question),
        profile_image_url: question.profile_image_url || null
      },
      answers: (answersRes.rows || []).map((row) => ({
        id: row.id,
        body: row.body || '',
        created_at: row.created_at || null,
        author_name: communityDisplayName(row),
        profile_image_url: row.profile_image_url || null
      }))
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: 'Could not load answers.' });
  } finally {
    client.release();
  }
});

router.post('/api/community/question/:questionId/answers', async (req, res) => {
  const questionId = toPositiveInt(req.params.questionId);
  if (!questionId) {
    return res.status(400).json({ ok: false, error: 'Invalid question id.' });
  }

  const client = await pool.connect();

  try {
    const userId = await getSignedInUserId(req);

    if (!userId) {
      return res.status(401).json({
        ok: false,
        error: 'Sign in required.'
      });
    }

    const parsedBody = validateCommunityAnswerPayload(req.body || {});
    if (!parsedBody.ok) {
      return res.status(400).json({
        ok: false,
        error: parsedBody.error
      });
    }

    const questionRes = await client.query(
      `
      SELECT id
      FROM public.community_posts
      WHERE id = $1
        AND post_type = 'question'
        AND is_public = true
      LIMIT 1
      `,
      [questionId]
    );

    if (!questionRes.rowCount) {
      return res.status(404).json({
        ok: false,
        error: 'Question not found.'
      });
    }

    const burstRes = await client.query(
      `
      SELECT COUNT(*)::int AS n
      FROM public.community_answers
      WHERE user_id = $1
        AND created_at >= now() - interval '10 minutes'
      `,
      [userId]
    );

    if (safeInt(burstRes.rows[0]?.n) >= 8) {
      return res.status(429).json({
        ok: false,
        error: 'You are replying too fast. Please wait a few minutes.'
      });
    }

    const duplicateKey = normalizeSpamText(parsedBody.value.body);

    const duplicateRes = await client.query(
      `
      SELECT id
      FROM public.community_answers
      WHERE question_id = $1
        AND user_id = $2
        AND lower(regexp_replace(body, '\s+', ' ', 'g')) = $3
        AND created_at >= now() - interval '1 day'
      LIMIT 1
      `,
      [questionId, userId, duplicateKey]
    );

    if (duplicateRes.rowCount) {
      return res.status(409).json({
        ok: false,
        error: 'That looks like a duplicate reply.'
      });
    }

    const insertRes = await client.query(
      `
      INSERT INTO public.community_answers
      (
        question_id,
        user_id,
        body,
        is_public
      )
      VALUES
      (
        $1,
        $2,
        $3,
        true
      )
      RETURNING id, created_at
      `,
      [questionId, userId, parsedBody.value.body]
    );

    return res.json({
      ok: true,
      answer: insertRes.rows[0] || null
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({
      ok: false,
      error: 'Could not save reply.'
    });
  } finally {
    client.release();
  }
});

router.post('/api/community/:key/post', async (req, res) => {
  const rawKey = req.params.key;
  const client = await pool.connect();

  try {
    const userId = await getSignedInUserId(req);

    if (!userId) {
      return res.status(401).json({
        ok: false,
        error: 'Sign in required.'
      });
    }

    const parsedBody = validateCommunityPayload(req.body || {});
    if (!parsedBody.ok) {
      return res.status(400).json({
        ok: false,
        error: parsedBody.error
      });
    }

    const parsed = parseKey(rawKey);
    const seed = await findSeedFromListings(client, parsed);

    const selectedBase = await resolveSelectedVariant(client, rawKey);
    const selectedCatalog = await resolveCatalogIdentity(client, selectedBase);

    const selectedKeys = {
      pci: (selectedCatalog?.pci || selectedBase.pci || seed.pci || null),
      upc: (selectedCatalog?.upc || selectedBase.upc || seed.upc || null)
    };

    const pci = cleanText(selectedKeys.pci);
    const upc = cleanText(selectedKeys.upc);

    const colorGroupKeys = await getColorGroupKeysFromCatalog(
      client,
      selectedCatalog || null,
      selectedKeys
    );

    const groupPcisUpper = (Array.isArray(colorGroupKeys?.pcis) ? colorGroupKeys.pcis : [])
      .map(v => String(v).trim().toUpperCase())
      .filter(Boolean);

    const groupUpcsRaw = (Array.isArray(colorGroupKeys?.upcs) ? colorGroupKeys.upcs : [])
      .map(v => String(v).trim())
      .filter(Boolean);

    if (!pci && !upc) {
      return res.status(400).json({
        ok: false,
        error: 'Could not resolve this product.'
      });
    }

    const payload = parsedBody.value;
    const spamKey = normalizeSpamText(
      [
        payload.post_type,
        payload.title || '',
        payload.body || '',
        payload.rating || ''
      ].join(' | ')
    );

    const burstRes = await client.query(
      `
      SELECT COUNT(*)::int AS n
      FROM public.community_posts
      WHERE user_id = $1
        AND created_at >= now() - interval '10 minutes'
      `,
      [userId]
    );

    if (safeInt(burstRes.rows[0]?.n) >= 3) {
      return res.status(429).json({
        ok: false,
        error: 'You are posting too fast. Please wait a few minutes.'
      });
    }

    const dailyRes = await client.query(
      `
      SELECT COUNT(*)::int AS n
      FROM public.community_posts
      WHERE user_id = $1
        AND created_at >= now() - interval '1 day'
      `,
      [userId]
    );

    if (safeInt(dailyRes.rows[0]?.n) >= 20) {
      return res.status(429).json({
        ok: false,
        error: 'Daily posting limit reached.'
      });
    }

    const duplicateRes = await client.query(
      `
      SELECT id
      FROM public.community_posts
      WHERE user_id = $1
        AND post_type = $2
        AND (
          (
            coalesce(array_length($3::text[], 1), 0) > 0
            AND product_pci IS NOT NULL
            AND btrim(product_pci) <> ''
            AND upper(btrim(product_pci)) = ANY($3::text[])
          )
          OR
          (
            coalesce(array_length($4::text[], 1), 0) > 0
            AND product_upc IS NOT NULL
            AND btrim(product_upc) <> ''
            AND norm_upc(product_upc) = ANY(
              ARRAY(
                SELECT norm_upc(x)
                FROM unnest($4::text[]) AS x
              )
            )
          )
        )
        AND lower(
          regexp_replace(
            coalesce(title, '') || ' | ' || coalesce(body, '') || ' | ' || coalesce(rating::text, ''),
            '\s+',
            ' ',
            'g'
          )
        ) = $5
        AND created_at >= now() - interval '7 days'
      LIMIT 1
      `,
      [userId, payload.post_type, groupPcisUpper, groupUpcsRaw, spamKey]
    );

    if (duplicateRes.rowCount) {
      return res.status(409).json({
        ok: false,
        error: 'That looks like a duplicate post.'
      });
    }

    const insertRes = await client.query(
      `
      INSERT INTO public.community_posts
      (
        product_pci,
        product_upc,
        post_type,
        title,
        body,
        rating,
        visited_at,
        user_id,
        is_public
      )
      VALUES
      (
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7,
        $8,
        true
      )
      RETURNING id, created_at
      `,
      [
        pci || null,
        upc || null,
        payload.post_type,
        payload.title || null,
        payload.body || null,
        payload.rating || null,
        payload.visited_at || null,
        userId
      ]
    );

    return res.json({
      ok: true,
      post: insertRes.rows[0] || null
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({
      ok: false,
      error: 'Could not save post.'
    });
  } finally {
    client.release();
  }
});

module.exports = router;