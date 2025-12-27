// routes/dashboard.js
const path = require('path');
const express = require('express');
const { Pool } = require('pg');

const router = express.Router();

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

function normStoreName(s) {
  const k = String(s || '').trim().toLowerCase();
  if (k === 'best buy') return 'bestbuy';
  if (k === 'bestbuy') return 'bestbuy';
  return k;
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

// -------------------------
// resolution flow (listings -> catalog)
// -------------------------

/**
 * Step 1: resolve a "seed" from listings based on input key.
 * ASIN is allowed ONLY to find PCI/UPC from Amazon listing.
 */
async function findSeedFromListings(client, parsed) {
  const { kind, value } = parsed;

  // ASIN means Amazon listing, ASIN stored in listings.store_sku where store='Amazon'
  if (kind === 'asin') {
    const r = await client.query(
      `
      select store, store_sku, upc, pci, title, url, current_price_cents, current_price_observed_at, created_at
      from public.listings
      where lower(btrim(store)) = 'amazon'
        and norm_sku(store_sku) = norm_sku($1)
      order by current_price_observed_at desc nulls last, created_at desc
      limit 1
      `,
      [value]
    );

    if (r.rowCount) {
      const row = r.rows[0];
      return {
        // keep asin only as "input echo", never for matching
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
 * IMPORTANT: no catalog.asin usage anywhere (column removed).
 */
async function resolveCatalogIdentity(client, seedKeys) {
  const pci = seedKeys?.pci ? String(seedKeys.pci).trim() : '';
  const upc = seedKeys?.upc ? String(seedKeys.upc).trim() : '';

  const pick = (rows) => (rows && rows.length ? rows[0] : null);

  // 1) PCI
  if (pci) {
    const r = await client.query(
      `
      select id, upc, pci, model_name, model_number, brand, category, image_url, variant_label, created_at
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
      select id, upc, pci, model_name, model_number, brand, category, image_url, variant_label, created_at
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
 */
async function getVariantsFromCatalog(client, catalogIdentity) {
  const modelNumber = catalogIdentity?.model_number ? String(catalogIdentity.model_number).trim() : '';
  if (!modelNumber) return [];

  const r = await client.query(
    `
    select id, upc, pci, model_name, model_number, brand, category, image_url, variant_label, created_at
    from public.catalog
    where model_number is not null and btrim(model_number) <> ''
      and upper(btrim(model_number)) = upper(btrim($1))
    order by
      (case when variant_label is null or btrim(variant_label) = '' then 1 else 0 end),
      variant_label nulls last,
      (case when model_name is null or btrim(model_name) = '' then 1 else 0 end),
      model_name nulls last,
      id
    limit 500
    `,
    [modelNumber]
  );

  return r.rows.map((row) => {
    const label =
      (row.variant_label && String(row.variant_label).trim()) ||
      (row.model_name && String(row.model_name).trim()) ||
      'Default';

    const key =
      (row.pci && String(row.pci).trim() ? `pci:${String(row.pci).trim()}` : null) ||
      (row.upc && String(row.upc).trim() ? `upc:${String(row.upc).trim()}` : null);

    return {
      id: row.id,
      key,
      upc: row.upc || null,
      pci: row.pci || null,
      model_name: row.model_name || null,
      model_number: row.model_number || null,
      variant_label: label,
      brand: row.brand || null,
      category: row.category || null,
      image_url: row.image_url || null
    };
  });
}

/**
 * Offers: match ONLY by PCI and/or UPC.
 * No ASIN matching.
 */
async function getOffersForSelectedVariant(client, selectedKeys) {
  const pci = selectedKeys?.pci ? String(selectedKeys.pci).trim() : '';
  const upc = selectedKeys?.upc ? String(selectedKeys.upc).trim() : '';

  const r = await client.query(
    `
    select store, store_sku, upc, pci, url, title, offer_tag, current_price_cents, current_price_observed_at, created_at
    from public.listings
    where
      (
        ($1::text <> '' and pci is not null and btrim(pci) <> '' and upper(btrim(pci)) = upper(btrim($1)))
        or
        ($2::text <> '' and norm_upc(upc) = norm_upc($2))
      )
    `,
    [pci, upc]
  );

  const amazon = [];
  const nonAmazonBestByStore = new Map();

  for (const row of r.rows) {
    const store = normStoreName(row.store);

    const candidate = {
      store,
      store_sku: row.store_sku || null,
      url: row.url || null,
      title: row.title || null,
      offer_tag: row.offer_tag || null,
      price_cents: row.current_price_cents ?? null,
      observed_at: row.current_price_observed_at ?? null,
      upc: row.upc || null,
      pci: row.pci || null
    };

    if (store === 'amazon') {
      amazon.push(candidate);
      continue;
    }

    // keep just the newest per non-amazon store
    const prev = nonAmazonBestByStore.get(store);
    if (!prev) {
      nonAmazonBestByStore.set(store, candidate);
      continue;
    }

    const tNew = candidate.observed_at ? new Date(candidate.observed_at).getTime() : 0;
    const tOld = prev.observed_at ? new Date(prev.observed_at).getTime() : 0;

    if (tNew > tOld) nonAmazonBestByStore.set(store, candidate);
    else if (tNew === tOld && prev.price_cents == null && candidate.price_cents != null) {
      nonAmazonBestByStore.set(store, candidate);
    }
  }

  amazon.sort((a, b) => {
    const ta = a.observed_at ? new Date(a.observed_at).getTime() : 0;
    const tb = b.observed_at ? new Date(b.observed_at).getTime() : 0;
    return tb - ta;
  });

  const AMAZON_MAX = 10;
  const amazonCapped = amazon.slice(0, AMAZON_MAX);

  const nonAmazon = Array.from(nonAmazonBestByStore.values());
  nonAmazon.sort((a, b) => a.store.localeCompare(b.store));

  return [...amazonCapped, ...nonAmazon];
}

/**
 * Selected variant resolution:
 * - pci/upc are direct.
 * - asin is converted to pci/upc via Amazon listing (NO selected_asin).
 * - store keys resolved to listing then use its pci/upc.
 */
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

async function getObservationLog(client, selectedKeys) {
  const pci = selectedKeys?.pci ? String(selectedKeys.pci).trim() : '';
  const upc = selectedKeys?.upc ? String(selectedKeys.upc).trim() : '';

  const rL = await client.query(
    `
    select
      coalesce(current_price_observed_at, created_at) as t,
      lower(btrim(store)) as store,
      store_sku,
      current_price_cents as price_cents
    from public.listings
    where
      (
        ($1::text <> '' and pci is not null and btrim(pci) <> '' and upper(btrim(pci)) = upper(btrim($1)))
        or
        ($2::text <> '' and norm_upc(upc) = norm_upc($2))
      )
      and (current_price_observed_at is not null or created_at is not null)
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
        store: normStoreName(r.store),
        store_sku: r.store_sku || null,
        price_cents: r.price_cents ?? null,
        note: 'pass'
      };
    });
}

// -------------------------
// routes
// -------------------------
router.get('/dashboard', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'dashboard', 'index.html'));
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

    // Enrich through catalog (PCI -> UPC) so we stay inside the same model_number group if possible
    const selectedCatalog = await resolveCatalogIdentity(client, selectedBase);
    const selectedKeys = {
      pci: selectedCatalog?.pci || selectedBase.pci || seed.pci || null,
      upc: selectedCatalog?.upc || selectedBase.upc || seed.upc || null
    };

    // 5) offers for selected variant (PCI/UPC only)
    const offers = await getOffersForSelectedVariant(client, selectedKeys);

    // 6) observation log (PCI/UPC only)
    const observed = await getObservationLog(client, selectedKeys);

    res.json({
      identity: {
        // seed keys (what we found in listings)
        pci: seed.pci || null,
        upc: seed.upc || null,
        // keep ASIN only as an input echo for the UI, never used for matching
        asin: seed.asin_input || null,

        // catalog meta
        model_number: catalogIdentity?.model_number || null,
        model_name: catalogIdentity?.model_name || null,
        brand: catalogIdentity?.brand || null,
        category: catalogIdentity?.category || null,
        image_url: catalogIdentity?.image_url || null,

        // selected anchors (PCI/UPC only)
        selected_pci: selectedKeys.pci || null,
        selected_upc: selectedKeys.upc || null,
        selected_asin: null
      },
      variants,
      offers,
      observed
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'server_error' });
  } finally {
    client.release();
  }
});

module.exports = router;