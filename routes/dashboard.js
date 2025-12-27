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
  return /^[0-9\s-]+$/.test(s || '');
}

function isLikelyPCI(s) {
  // Your PCI generator uses LEN=8 and first char is a letter.
  // Keep permissive but aligned: 8 chars, starts with letter.
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
 * Step 1: resolve a "seed" from listings or catalog based on input key.
 * We use listings first because you said listings is now the source of truth for searching by TCIN/BBY/WAL/ASIN.
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
        asin: value,
        upc: row.upc || null,
        pci: row.pci || null,
        seed_listing: row
      };
    }
    return { asin: value, upc: null, pci: null, seed_listing: null };
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
      return { asin: null, upc: row.upc || value, pci: row.pci || null, seed_listing: row };
    }
    return { asin: null, upc: value, pci: null, seed_listing: null };
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
      return { asin: null, upc: row.upc || null, pci: row.pci || value, seed_listing: row };
    }
    return { asin: null, upc: null, pci: value, seed_listing: null };
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
      return { asin: null, upc: row.upc || null, pci: row.pci || null, seed_listing: row };
    }
    return { asin: null, upc: null, pci: null, seed_listing: null };
  }

  // raw fallback: try like upc/asin/pci guesses
  if (isLikelyASIN(value)) return findSeedFromListings(client, { kind: 'asin', value: value.toUpperCase() });
  if (isLikelyUPC(value)) return findSeedFromListings(client, { kind: 'upc', value });
  if (isLikelyPCI(value)) return findSeedFromListings(client, { kind: 'pci', value });
  return { asin: null, upc: null, pci: null, seed_listing: null };
}

/**
 * Step 2: use PCI -> UPC -> ASIN to get model_number + meta from catalog.
 * This is the exact priority you asked for.
 */
async function resolveCatalogIdentity(client, seedKeys) {
  const pci = seedKeys.pci ? String(seedKeys.pci).trim() : '';
  const upc = seedKeys.upc ? String(seedKeys.upc).trim() : '';
  const asin = seedKeys.asin ? String(seedKeys.asin).trim() : '';

  const pick = (rows) => (rows && rows.length ? rows[0] : null);

  // 1) PCI
  if (pci) {
    const r = await client.query(
      `
      select id, asin, upc, pci, model_name, model_number, brand, category, image_url, variant_label, created_at
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
      select id, asin, upc, pci, model_name, model_number, brand, category, image_url, variant_label, created_at
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

  // 3) ASIN
  if (asin) {
    const r = await client.query(
      `
      select id, asin, upc, pci, model_name, model_number, brand, category, image_url, variant_label, created_at
      from public.catalog
      where upper(btrim(asin)) = upper(btrim($1))
      order by created_at desc
      limit 1
      `,
      [asin]
    );
    const row = pick(r.rows);
    if (row) return row;
  }

  return null;
}

/**
 * Step 3: variants come from catalog by model_number
 * You asked: "for now just do model_name as variants" and output brand/category.
 */
async function getVariantsFromCatalog(client, catalogIdentity) {
  const modelNumber = catalogIdentity?.model_number ? String(catalogIdentity.model_number).trim() : '';
  if (!modelNumber) return [];

  const r = await client.query(
    `
    select id, asin, upc, pci, model_name, model_number, brand, category, image_url, variant_label, created_at
    from public.catalog
    where model_number is not null and btrim(model_number) <> ''
      and upper(btrim(model_number)) = upper(btrim($1))
    order by
      (case when variant_label is null or btrim(variant_label) = '' then 1 else 0 end),
      variant_label nulls last,
      (case when model_name is null or btrim(model_name) = '' then 1 else 0 end),
      model_name nulls last,
      asin
    limit 500
    `,
    [modelNumber]
  );

  return r.rows.map((row) => {
    // AFTER (correct for your dropdown)
    const label =
      (row.variant_label && String(row.variant_label).trim()) ||
      (row.model_name && String(row.model_name).trim()) ||
    'Default';

    // A stable "variant key" for the frontend to re-query compare.
    // Priority: pci -> upc -> asin (matches your anchor priority theme)
    const key =
      (row.pci && String(row.pci).trim() ? `pci:${String(row.pci).trim()}` : null) ||
      (row.upc && String(row.upc).trim() ? `upc:${String(row.upc).trim()}` : null) ||
      (row.asin && String(row.asin).trim() ? `asin:${String(row.asin).trim().toUpperCase()}` : null);

    return {
      id: row.id,
      key,
      // keep these explicit so dashboard.js can use them if it already does
      asin: row.asin || null,
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

async function getOffersForSelectedVariant(client, selectedKeys) {
  const pci = selectedKeys?.pci ? String(selectedKeys.pci).trim() : '';
  const upc = selectedKeys?.upc ? String(selectedKeys.upc).trim() : '';
  const asin = selectedKeys?.asin ? String(selectedKeys.asin).trim().toUpperCase() : '';

  const r = await client.query(
    `
    select store, store_sku, upc, pci, url, title, offer_tag, current_price_cents, current_price_observed_at, created_at
    from public.listings
    where
      (
        ($1::text <> '' and pci is not null and btrim(pci) <> '' and upper(btrim(pci)) = upper(btrim($1)))
        or
        ($2::text <> '' and norm_upc(upc) = norm_upc($2))
        or
        ($3::text <> '' and lower(btrim(store)) = 'amazon' and norm_sku(store_sku) = norm_sku($3))
      )
    `,
    [pci, upc, asin]
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

  // Sort Amazon offers newest-first, and optionally cap how many you show.
  amazon.sort((a, b) => {
    const ta = a.observed_at ? new Date(a.observed_at).getTime() : 0;
    const tb = b.observed_at ? new Date(b.observed_at).getTime() : 0;
    return tb - ta;
  });

  // Optional cap so Amazon doesn’t spam the matrix if you have tons of duplicates:
  const AMAZON_MAX = 10;
  const amazonCapped = amazon.slice(0, AMAZON_MAX);

  const nonAmazon = Array.from(nonAmazonBestByStore.values());
  nonAmazon.sort((a, b) => a.store.localeCompare(b.store));

  // Put Amazon at the top, then the rest.
  return [...amazonCapped, ...nonAmazon];
}

/**
 * Step 5: pick a "selected variant" based on the incoming key.
 * This returns keys that we will use to fetch offers + observations.
 */
async function resolveSelectedVariant(client, rawKey) {
  const parsed = parseKey(rawKey);

  // If user explicitly asked for a catalog anchor (pci/upc/asin), use that directly.
  if (parsed.kind === 'pci') return { pci: parsed.value, upc: null, asin: null };
  if (parsed.kind === 'upc') return { pci: null, upc: parsed.value, asin: null };
  if (parsed.kind === 'asin') return { pci: null, upc: null, asin: parsed.value.toUpperCase() };

  // For store keys, resolve to a listing row, then use its pci/upc (and asin only if it is Amazon).
  if (parsed.kind === 'bby' || parsed.kind === 'wal' || parsed.kind === 'tcin') {
    const store = storeForKind(parsed.kind);
    const r = await client.query(
      `
      select store, store_sku, upc, pci
      from public.listings
      where replace(lower(btrim(store)), ' ', '') = $1
        and norm_sku(store_sku) = norm_sku($2)
      order by current_price_observed_at desc nulls last, created_at desc
      limit 1
      `,
      [store, parsed.value]
    );
    if (!r.rowCount) return { pci: null, upc: null, asin: null };
    const row = r.rows[0];
    return { pci: row.pci || null, upc: row.upc || null, asin: null };
  }

  // raw guess
  if (isLikelyASIN(parsed.value)) return { pci: null, upc: null, asin: parsed.value.toUpperCase() };
  if (isLikelyUPC(parsed.value)) return { pci: null, upc: parsed.value, asin: null };
  if (isLikelyPCI(parsed.value)) return { pci: parsed.value, upc: null, asin: null };
  return { pci: null, upc: null, asin: null };
}

  async function getObservationLog(client, selectedKeys) {
    const pci  = selectedKeys?.pci  ? String(selectedKeys.pci).trim() : '';
    const upc  = selectedKeys?.upc  ? String(selectedKeys.upc).trim() : '';
    const asin = selectedKeys?.asin ? String(selectedKeys.asin).trim().toUpperCase() : '';

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
          or
          ($3::text <> '' and lower(btrim(store)) = 'amazon' and norm_sku(store_sku) = norm_sku($3))
        )
        and (current_price_observed_at is not null or created_at is not null)
      order by coalesce(current_price_observed_at, created_at) desc
      limit 250
      `,
      [pci, upc, asin]
    );

    return rL.rows
      .filter(r => r.t) // make sure we don’t send invalid timestamps
      .map((r) => {
        const t = r.t ? new Date(r.t).toISOString() : null;
        return {
          t,                      // frontend expects this
          observed_at: t,         // extra, fine
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
    if (!seed?.asin && !seed?.upc && !seed?.pci && !seed?.seed_listing) {
      return res.status(404).json({
        error: 'not_found',
        hint: 'Try prefixes like asin:..., upc:..., pci:..., bby:..., wal:..., tcin:...'
      });
    }

    // 2) catalog identity via PCI -> UPC -> ASIN (your required priority)
    const catalogIdentity = await resolveCatalogIdentity(client, seed);

    // 3) variants by model_number (from catalog)
    const variants = catalogIdentity ? await getVariantsFromCatalog(client, catalogIdentity) : [];

    // 4) resolve selected variant (based on the incoming key)
    // then enrich it through catalog (so we get the model_number group even if key was store_sku)
    const selectedBase = await resolveSelectedVariant(client, rawKey);
    const selectedCatalog = await resolveCatalogIdentity(client, selectedBase);
    const selectedKeys = {
      pci: selectedCatalog?.pci || selectedBase.pci || seed.pci || null,
      upc: selectedCatalog?.upc || selectedBase.upc || seed.upc || null,
      asin: selectedCatalog?.asin || selectedBase.asin || seed.asin || null
    };

    // 5) offers for selected variant
    const offers = await getOffersForSelectedVariant(client, selectedKeys);

    // 6) observation log
    const observed = await getObservationLog(client, selectedKeys);

    // identity payload: use catalog meta when available, and also include the seed keys.
    res.json({
      identity: {
        // seed keys (what we found in listings)
        pci: seed.pci || null,
        upc: seed.upc || null,
        asin: seed.asin || null,

        // catalog meta (what we found through PCI -> UPC -> ASIN)
        model_number: catalogIdentity?.model_number || null,
        model_name: catalogIdentity?.model_name || null,
        brand: catalogIdentity?.brand || null,
        category: catalogIdentity?.category || null,
        image_url: catalogIdentity?.image_url || null,

        // selected
        selected_pci: selectedKeys.pci || null,
        selected_upc: selectedKeys.upc || null,
        selected_asin: selectedKeys.asin || null
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