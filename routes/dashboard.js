// routes/dashboard.js
const path = require('path');
const express = require('express');
const { Pool } = require('pg');
const fs = require('fs');
const router = express.Router();

const DASHBOARD_INDEX_PATH = path.join(__dirname, '..', 'public', 'dashboard', 'index.html');
let DASHBOARD_TEMPLATE = null;

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

function slugifyTitleServer(s) {
  const raw = String(s || '').trim().toLowerCase();
  if (!raw) return 'product';
  return raw
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'product';
}

function originFromReq(req) {
  const env = process.env.PUBLIC_BASE_URL;

  const s = String(env || '').trim().replace(/\/+$/g, '');
  if (s) return s;

  return `${req.protocol}://${req.get('host')}`;
}

function prettyDashboardPath(key, title) {
  const slug = slugifyTitleServer(title);
  const [kindRaw, ...rest] = String(key || '').trim().split(':');
  const kind = (kindRaw || '').toLowerCase();
  const value = rest.join(':').trim();

  if (kind && value) return `/dashboard/${slug}/${kind}/${encodeURIComponent(value)}/`;
  return `/dashboard/${slug}/`;
}

function upsertTag(html, pattern, replacement) {
  const re = new RegExp(pattern, 'i');
  if (re.test(html)) return html.replace(re, replacement);
  // If missing, insert before </head>
  return html.replace(/<\/head>/i, `${replacement}\n</head>`);
}

function escText(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function renderDashboardHtml(meta, robotsContent) {
  const m = meta || {};

  const titleStr = m.title || "PriceCheck Dashboard - PriceCheck";
  const titleText = escText(titleStr);

  const desc = escAttr(m.desc || "Compare prices on PriceCheck.");
  const robots = escAttr(robotsContent || "noindex,follow");

  const canonical = escAttr(m.canonicalUrl || "");
  const img = escAttr(m.imageUrl || "");

  let html = getDashboardTemplate();

  // title
  html = upsertTag(
    html,
    "<title[^>]*>[\\s\\S]*?</title>",
    `<title>${titleText}</title>`
  );

  // description + robots
  html = upsertTag(
    html,
    `<meta\\s+name=["']description["'][^>]*>`,
    `<meta name="description" content="${desc}">`
  );

  html = upsertTag(
    html,
    `<meta\\s+name=["']robots["'][^>]*>`,
    `<meta name="robots" content="${robots}">`
  );

  // canonical + og:url
  if (canonical) {
    html = upsertTag(
      html,
      `<link\\s+rel=["']canonical["'][^>]*>`,
      `<link rel="canonical" href="${canonical}">`
    );

    html = upsertTag(
      html,
      `<meta\\s+property=["']og:url["'][^>]*>`,
      `<meta property="og:url" content="${canonical}">`
    );
  }

  // OG tags
  html = upsertTag(
    html,
    `<meta\\s+property=["']og:title["'][^>]*>`,
    `<meta property="og:title" content="${escAttr(titleStr)}">`
  );

  html = upsertTag(
    html,
    `<meta\\s+property=["']og:description["'][^>]*>`,
    `<meta property="og:description" content="${desc}">`
  );

  if (img) {
    html = upsertTag(
      html,
      `<meta\\s+property=["']og:image["'][^>]*>`,
      `<meta property="og:image" content="${img}">`
    );
  }

  // Twitter tags
  html = upsertTag(
    html,
    `<meta\\s+name=["']twitter:card["'][^>]*>`,
    `<meta name="twitter:card" content="summary_large_image">`
  );

  html = upsertTag(
    html,
    `<meta\\s+name=["']twitter:title["'][^>]*>`,
    `<meta name="twitter:title" content="${escAttr(titleStr)}">`
  );

  html = upsertTag(
    html,
    `<meta\\s+name=["']twitter:description["'][^>]*>`,
    `<meta name="twitter:description" content="${desc}">`
  );

  if (img) {
    html = upsertTag(
      html,
      `<meta\\s+name=["']twitter:image["'][^>]*>`,
      `<meta name="twitter:image" content="${img}">`
    );
  }

  return html;
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

function uniqOfferKey(store, storeSku) {
  const st = normStoreKey(store);
  const sku = normSkuLocal(storeSku);
  return `${st}:S:${sku || ''}`;
}

async function getDashboardSeoMeta(client, rawKey, req) {
  const parsed = parseKey(rawKey);

  // Use your existing resolution chain
  const seed = await findSeedFromListings(client, parsed);
  const selectedBase = await resolveSelectedVariant(client, rawKey);
  const selectedCatalog = await resolveCatalogIdentity(client, selectedBase);
  const catalogIdentity = await resolveCatalogIdentity(client, seed);

  const meta = selectedCatalog || catalogIdentity || null;
  const listingTitle = seed?.seed_listing?.title ? String(seed.seed_listing.title).trim() : '';

  const titleBase = (meta?.model_name || listingTitle || 'Product').trim();

  const canonicalPci = (meta?.pci || selectedBase.pci || seed.pci || '').trim();
  const canonicalUpc = (meta?.upc || selectedBase.upc || seed.upc || '').trim();

  const canonicalKey =
    (canonicalPci ? `pci:${canonicalPci}` : null) ||
    (canonicalUpc ? `upc:${canonicalUpc}` : null) ||
    null;

  const origin = originFromReq(req);
  const canonicalPath = canonicalKey ? prettyDashboardPath(canonicalKey, titleBase) : '/dashboard/';
  const canonicalUrl = `${origin}${canonicalPath}`;

  const img = (meta?.image_url || '/content-img/default.webp').trim();
  const absImg = img.startsWith('http') ? img : `${origin}${img.startsWith('/') ? '' : '/'}${img}`;

  const desc =
    `Compare prices for ${titleBase} across stores. See price history, cross-store offers, and any verified coupons, matched to the exact variant by PCI and UPC.`;

  return {
    title: `${titleBase} - PriceCheck`,
    titleBase,
    desc,
    canonicalKey,
    canonicalPath,
    canonicalUrl,
    imageUrl: absImg,
    kind: (canonicalKey ? canonicalKey.split(':')[0] : ''),
    seed
  };
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
      select store, store_sku, upc, pci, title, url, current_price_cents, current_price_observed_at, created_at
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
      select store, store_sku, upc, pci, title, url, current_price_cents, current_price_observed_at, created_at
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
      select store, store_sku, upc, pci, title, url, current_price_cents, current_price_observed_at, created_at
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
      select store, store_sku, upc, pci, title, url, current_price_cents, current_price_observed_at, created_at
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

/**
 * Step 2: catalog identity via PCI -> UPC.
 * IMPORTANT: no catalog.asin usage anywhere.
 */
async function resolveCatalogIdentity(client, seedKeys) {
  const pci = seedKeys?.pci ? String(seedKeys.pci).trim() : '';
  const upc = seedKeys?.upc ? String(seedKeys.upc).trim() : '';

  const pick = (rows) => (rows && rows.length ? rows[0] : null);

  // 1) PCI
  if (pci) {
    const r = await client.query(
      `
      select id, upc, pci, model_name, model_number, brand, category, image_url,
             version, color, variant, created_at,
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
             version, color, variant, created_at,
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

/**
 * Step 3: variants come from catalog by model_number.
 * Variant key priority: pci -> upc (NO asin keys).
 * Include catalog.variant (you have that column now).
 */
async function getVariantsFromCatalog(client, catalogIdentity) {
  const modelNumber = catalogIdentity?.model_number ? String(catalogIdentity.model_number).trim() : '';
  if (!modelNumber) return [];

  const r = await client.query(
    `
    select id, upc, pci, model_name, model_number, brand, category, image_url,
           version, color, variant, created_at
    from public.catalog
    where model_number is not null and btrim(model_number) <> ''
      and upper(btrim(model_number)) = upper(btrim($1))
    order by
      (case when version is null or btrim(version) = '' then 1 else 0 end),
      version nulls last,
      (case when variant is null or btrim(variant) = '' then 1 else 0 end),
      variant nulls last,
      (case when color is null or btrim(color) = '' then 1 else 0 end),
      color nulls last,
      id
    limit 500
    `,
    [modelNumber]
  );

  return r.rows
    .map((row) => {
      const key =
        (row.pci && String(row.pci).trim() ? `pci:${String(row.pci).trim()}` : null) ||
        (row.upc && String(row.upc).trim() ? `upc:${String(row.upc).trim()}` : null);

      // If a catalog row has neither PCI nor UPC, it is not selectable as a variant anchor.
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
        image_url: row.image_url || null
      };
    })
    .filter(Boolean);
}

const OFFER_COLS = `
  store, store_sku, upc, pci, url, title, offer_tag,
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

async function getObservationLog(client, selectedKeys, seed) {
  const pci = selectedKeys?.pci ? String(selectedKeys.pci).trim() : '';
  const upc = selectedKeys?.upc ? String(selectedKeys.upc).trim() : '';

  // If no PCI/UPC, still show the seed listing if present
  if (!pci && !upc) {
    const seedStore = seed?.seed_listing?.store || null;
    const seedSku = seed?.seed_listing?.store_sku || null;
    if (!seedStore || !seedSku) return [];

    const rSeed = await client.query(
      `
      select
        coalesce(current_price_observed_at, created_at) as t,
        store,
        store_sku,
        current_price_cents as price_cents,
        effective_price_cents as effective_price_cents,
        coupon_text as coupon_text
      from public.listings
      where replace(lower(btrim(store)), ' ', '') = replace(lower(btrim($1)), ' ', '')
        and norm_sku(store_sku) = norm_sku($2)
        and coalesce(nullif(lower(btrim(status)), ''), 'active') <> 'hidden'
      order by coalesce(current_price_observed_at, created_at) desc
      limit 1
      `,
      [seedStore, seedSku]
    );

    if (!rSeed.rowCount) return [];

    const r = rSeed.rows[0];
    const t = r.t ? new Date(r.t).toISOString() : null;

    return [{
      t,
      observed_at: t,
      store: normStoreKey(r.store),
      store_sku: r.store_sku || null,
      price_cents: r.price_cents ?? null,
      effective_price_cents: r.effective_price_cents ?? null,
      coupon_text: r.coupon_text || null,
      note: 'pass'
    }];
  }

  const rL = await client.query(
    `
    select
      coalesce(current_price_observed_at, created_at) as t,
      store,
      store_sku,
      current_price_cents as price_cents,
      effective_price_cents as effective_price_cents,
      coupon_text as coupon_text
    from public.listings
    where
      (
        ($1::text <> '' and pci is not null and btrim(pci) <> '' and upper(btrim(pci)) = upper(btrim($1)))
        or
        ($2::text <> '' and norm_upc(upc) = norm_upc($2))
      )
      and (current_price_observed_at is not null or created_at is not null)
      and coalesce(nullif(lower(btrim(status)), ''), 'active') <> 'hidden'
    order by coalesce(current_price_observed_at, created_at) desc
    limit 250
    `,
    [pci, upc]
  );

  return rL.rows
    .filter(r => r.t)
    .map((r) => {
      const t = r.t ? new Date(r.t).toISOString() : null;
      return {
        t,
        observed_at: t,
        store: normStoreKey(r.store),
        store_sku: r.store_sku || null,
        price_cents: r.price_cents ?? null,
        effective_price_cents: r.effective_price_cents ?? null,
        coupon_text: r.coupon_text || null,
        note: 'pass'
      };
    });
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

// -------------------------
// routes
// -------------------------
router.get(['/dashboard', '/dashboard/'], (req, res) => {
  // Base page, not indexable
  const origin = originFromReq(req);
  const meta = {
    title: 'PriceCheck Dashboard - PriceCheck',
    desc: 'PriceCheck dashboard.',
    canonicalUrl: `${origin}/dashboard/`,
    imageUrl: `${origin}/content-img/default.webp`
  };
  const html = renderDashboardHtml(meta, 'noindex,follow');
  res.type('html').send(html);
});

const ALLOWED_KIND = new Set(['asin', 'upc', 'pci', 'tcin', 'bby', 'wal']);

router.get(['/dashboard/:kind/:value', '/dashboard/:kind/:value/'], async (req, res, next) => {
  const kind = String(req.params.kind || '').toLowerCase();
  const value = String(req.params.value || '');
  if (!ALLOWED_KIND.has(kind)) return next();

  const rawKey = `${kind}:${decodeURIComponent(value)}`;

  const client = await pool.connect();
  try {
    const meta = await getDashboardSeoMeta(client, rawKey, req);

    // If we can canonicalize to PCI or UPC, redirect to the pretty canonical URL
    if (meta.canonicalKey) {
      return res.redirect(301, meta.canonicalPath);
    }

    // If nothing to canonicalize, serve noindex
    const html = renderDashboardHtml(meta, 'noindex,follow');
    return res.type('html').send(html);
  } catch (e) {
    console.error(e);
    return next();
  } finally {
    client.release();
  }
});

router.get(['/dashboard/:slug/:kind/:value', '/dashboard/:slug/:kind/:value/'], async (req, res, next) => {
  const kind = String(req.params.kind || '').toLowerCase();
  const value = String(req.params.value || '');
  if (!ALLOWED_KIND.has(kind)) return next();

  const rawKey = `${kind}:${decodeURIComponent(value)}`;

  const client = await pool.connect();
  try {
    const meta = await getDashboardSeoMeta(client, rawKey, req);

    // If we have a canonical key, enforce:
    // 1) canonical key (PCI preferred)
    // 2) correct slug
    if (meta.canonicalKey) {
      const expectedPath = prettyDashboardPath(meta.canonicalKey, meta.titleBase);
      const gotPath = req.path.endsWith('/') ? req.path : `${req.path}/`;

      if (expectedPath !== gotPath) {
        return res.redirect(301, expectedPath);
      }

      // PCI pages are indexable
      const robots = meta.kind === 'pci' ? 'index,follow' : 'noindex,follow';
      const html = renderDashboardHtml(meta, robots);
      return res.type('html').send(html);
    }

    const html = renderDashboardHtml(meta, 'noindex,follow');
    return res.type('html').send(html);
  } catch (e) {
    console.error(e);
    return next();
  } finally {
    client.release();
  }
});

router.get('/api/compare/:key', async (req, res) => {
  const rawKey = req.params.key;

  const client = await pool.connect();
  try {
    const parsed = parseKey(rawKey);

    // 1) seed keys come from listings resolution (TCIN/BBY/WAL/ASIN all work here)
    const seed = await findSeedFromListings(client, parsed);

    // If literally nothing was found and user didn't provide a meaningful key
    if (!seed?.asin_input && !seed?.upc && !seed?.pci && !seed?.seed_listing) {
      return res.status(404).json({
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

    // 6) observation log (PCI/UPC only, but seed fallback)
    const observed = await getObservationLog(client, selectedKeys, seed);

    // 7) price history (only if PCI/UPC exists)
    const history = await getPriceHistoryDailyAndStats(client, selectedKeys, 90);

    const meta = selectedCatalog || catalogIdentity || null;
    const listingTitle = seed?.seed_listing?.title ? String(seed.seed_listing.title).trim() : '';

    res.json({
      identity: {
        // seed keys (what we found in listings)
        pci: seed.pci || null,
        upc: seed.upc || null,
        // keep ASIN only as an input echo for the UI, never used for matching
        asin: seed.asin_input || null,

        // catalog meta (fallback to listing title for model_name if catalog missing)
        model_number: meta?.model_number || null,
        model_name: (meta?.model_name || listingTitle || null),
        brand: meta?.brand || null,
        category: meta?.category || null,
        image_url: meta?.image_url || null,
        dropship_warning: !!meta?.dropship_warning,
        recall_url: meta?.recall_url || null,
        coverage_warning: !!meta?.coverage_warning,

        // selected anchors (PCI/UPC only)
        selected_pci: selectedKeys.pci || null,
        selected_upc: selectedKeys.upc || null,
        selected_asin: null
      },
      variants,
      selected_variant: {
        key:
          (selectedKeys.pci ? `pci:${selectedKeys.pci}` : null) ||
          (selectedKeys.upc ? `upc:${selectedKeys.upc}` : null)
      },
      offers,
      observed,
      history
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'server_error' });
  } finally {
    client.release();
  }
});

module.exports = router;