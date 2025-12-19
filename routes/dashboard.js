// routes/dashboard.js
const path = require('path');
const express = require('express');
const router = express.Router();
const pool = require('../db');

// helpers
function isLikelyUPC(s){ return /^[0-9\s-]+$/.test(s || ''); }
function isLikelyPcCode(s){
  return /^[a-z0-9][a-z0-9_-]{2,}$/i.test(String(s || '').trim());
}
function normalizePrefix(raw){
  const s = String(raw || '').trim();
  const i = s.indexOf(':');
  if (i === -1) return { prefix: null, val: s };
  return { prefix: s.slice(0, i).toLowerCase(), val: s.slice(i + 1).trim() };
}
function normStoreName(s){
  const k = String(s || '').trim().toLowerCase();
  return k === 'best buy' ? 'bestbuy' : k;
}
function parseKey(rawKey){
  const { prefix, val } = normalizePrefix(rawKey);
  const v = String(val || '').trim();

  const p = (prefix || '').toLowerCase();
  if (p === 'asin') return { kind: 'asin', value: v.toUpperCase() };
  if (p === 'upc')  return { kind: 'upc',  value: v };
  if (p === 'pc' || p === 'pc_code' || p === 'pccode') return { kind: 'pc', value: v };
  if (p === 'bby' || p === 'bestbuy' || p === 'sku') return { kind: 'bby', value: v };
  if (p === 'walmart' || p === 'wal') return { kind: 'wal', value: v };
  if (p === 'target' || p === 'tcin') return { kind: 'tcin', value: v };

  // no prefix: guess
  if (/^[A-Z0-9]{10}$/i.test(v)) return { kind: 'asin', value: v.toUpperCase() };
  if (isLikelyUPC(v)) return { kind: 'upc', value: v };
  if (isLikelyPcCode(v)) return { kind: 'pc', value: v };

  // fallback: treat as raw
  return { kind: 'raw', value: v };
}

// key resolution (returns an identity row for the product group)
async function resolveKey(client, rawKey){
  const { prefix, val } = normalizePrefix(rawKey);
  const key = val;

  const findIdentity = async (asin, upc, pc_code) => {
    const r = await client.query(
      `select asin, upc, pc_code, model_name, model_number, brand, category, image_url
         from asins
        where (($1::text is not null and upper(btrim(asin)) = upper(btrim($1)))
            or ($2::text is not null and norm_upc(upc) = norm_upc($2))
            or ($3::text is not null and upper(btrim(pc_code)) = upper(btrim($3))))
        order by current_price_observed_at desc nulls last, created_at desc
        limit 1`,
      [asin, upc, pc_code]
    );
    return r.rowCount ? r.rows[0] : ((asin || upc || pc_code) ? { asin, upc, pc_code } : null);
  };

  const findByAsin = async (asin) => {
    const r = await client.query(
      `select asin, upc, pc_code
         from asins
        where upper(btrim(asin)) = upper(btrim($1))
        order by current_price_observed_at desc nulls last, created_at desc
        limit 1`,
      [asin]
    );
    return r.rowCount ? r.rows[0] : null;
  };

  const findByUpc = async (upcInput) => {
    let r = await client.query(
      `select asin, upc, pc_code
         from asins
        where norm_upc(upc) = norm_upc($1)
        order by current_price_observed_at desc nulls last, created_at desc
        limit 1`,
      [upcInput]
    );
    if (r.rowCount) return r.rows[0];

    r = await client.query(
      `select upc
         from listings
        where norm_upc(upc) = norm_upc($1)
        order by current_price_observed_at desc nulls last, created_at desc
        limit 1`,
      [upcInput]
    );
    if (r.rowCount) return { asin: null, upc: r.rows[0].upc, pc_code: null };

    return null;
  };

  const findByPcCode = async (pc) => {
    const r = await client.query(
      `select asin, upc, pc_code
         from asins
        where upper(btrim(pc_code)) = upper(btrim($1))
        order by current_price_observed_at desc nulls last, created_at desc
        limit 1`,
      [pc]
    );
    if (r.rowCount) return r.rows[0];

    const r2 = await client.query(
      `select pc_code
         from listings
        where upper(btrim(pc_code)) = upper(btrim($1))
        order by current_price_observed_at desc nulls last, created_at desc
        limit 1`,
      [pc]
    );
    return r2.rowCount ? { asin: null, upc: null, pc_code: r2.rows[0].pc_code } : null;
  };

  const findUpcByStoreSku = async (store, sku) => {
    const r = await client.query(
      `select upc
         from listings
        where lower(btrim(store)) = lower(btrim($1))
          and norm_sku(store_sku) = norm_sku($2)
        order by current_price_observed_at desc nulls last, created_at desc
        limit 1`,
      [store, sku]
    );
    return r.rowCount ? r.rows[0].upc : null;
  };

  if (prefix === 'asin'){
    const row = await findByAsin(key);
    return row ? await findIdentity(row.asin, row.upc, row.pc_code) : null;
  }
  if (prefix === 'upc'){
    const row = await findByUpc(key);
    return row ? await findIdentity(row.asin, row.upc, row.pc_code) : null;
  }
  if (prefix === 'pc' || prefix === 'pc_code' || prefix === 'pccode'){
    const row = await findByPcCode(key);
    return row ? await findIdentity(row.asin, row.upc, row.pc_code) : null;
  }

  if (prefix === 'bby' || prefix === 'bestbuy' || prefix === 'sku'){
    const upc = await findUpcByStoreSku('bestbuy', key);
    return upc ? await findIdentity(null, upc, null) : null;
  }
  if (prefix === 'walmart' || prefix === 'wal'){
    const upc = await findUpcByStoreSku('walmart', key);
    return upc ? await findIdentity(null, upc, null) : null;
  }
  if (prefix === 'target' || prefix === 'tcin'){
    const upc = await findUpcByStoreSku('target', key);
    return upc ? await findIdentity(null, upc, null) : null;
  }

  let row = await findByAsin(key);
  if (row) return await findIdentity(row.asin, row.upc, row.pc_code);

  if (isLikelyUPC(key)){
    row = await findByUpc(key);
    if (row) return await findIdentity(row.asin, row.upc, row.pc_code);
  }

  if (isLikelyPcCode(key)){
    row = await findByPcCode(key);
    if (row) return await findIdentity(row.asin, row.upc, row.pc_code);
  }

  for (const st of ['bestbuy','walmart','target']){
    const upc = await findUpcByStoreSku(st, key);
    if (upc) return await findIdentity(null, upc, null);
  }

  return null;
}

// selected variant resolver (this is the missing piece)
async function resolveSelectedVariant(client, rawKey){
  const { kind, value } = parseKey(rawKey);

  // 1) direct asin
  if (kind === 'asin'){
    const r = await client.query(
      `select asin, upc, pc_code, variant_label
         from asins
        where upper(btrim(asin)) = upper(btrim($1))
        order by current_price_observed_at desc nulls last, created_at desc
        limit 1`,
      [value]
    );
    return r.rowCount ? r.rows[0] : null;
  }

  // 2) upc
  if (kind === 'upc'){
    const r = await client.query(
      `select asin, upc, pc_code, variant_label
         from asins
        where norm_upc(upc) = norm_upc($1)
        order by current_price_observed_at desc nulls last, created_at desc
        limit 1`,
      [value]
    );
    return r.rowCount ? r.rows[0] : null;
  }

  // 3) store sku to upc
  if (kind === 'bby' || kind === 'wal' || kind === 'tcin'){
    const store =
      kind === 'bby' ? 'bestbuy' :
      kind === 'wal' ? 'walmart' :
      'target';

    const rU = await client.query(
      `select upc
         from listings
        where lower(btrim(store)) = $1
          and norm_sku(store_sku) = norm_sku($2)
        order by current_price_observed_at desc nulls last, created_at desc
        limit 1`,
      [store, value]
    );
    if (!rU.rowCount) return null;

    const upc = rU.rows[0].upc;
    const rA = await client.query(
      `select asin, upc, pc_code, variant_label
         from asins
        where norm_upc(upc) = norm_upc($1)
        order by current_price_observed_at desc nulls last, created_at desc
        limit 1`,
      [upc]
    );
    return rA.rowCount ? rA.rows[0] : { asin: null, upc, pc_code: null, variant_label: null };
  }

  // 4) pc_code: pick latest asin within that group as "selected" default
  if (kind === 'pc'){
    const r = await client.query(
      `select asin, upc, pc_code, variant_label
         from asins
        where upper(btrim(pc_code)) = upper(btrim($1))
        order by current_price_observed_at desc nulls last, created_at desc
        limit 1`,
      [value]
    );
    return r.rowCount ? r.rows[0] : { asin: null, upc: null, pc_code: value, variant_label: null };
  }

  return null;
}

// latest offers, but scoped correctly
async function getLatestOffers(client, identity, selected){
  const pc_code = identity?.pc_code || null;
  const selected_asin = selected?.asin || identity?.asin || null;
  const selected_upc  = selected?.upc  || identity?.upc  || null;

  const offers = [];

  // Amazon: ONLY by selected_asin if we have it
  if (selected_asin){
    const rA = await client.query(
      `select asin,
              variant_label,
              current_price_cents,
              current_price_observed_at
         from asins
        where upper(btrim(asin)) = upper(btrim($1))
        order by current_price_observed_at desc nulls last, created_at desc
        limit 1`,
      [selected_asin]
    );

    if (rA.rowCount){
      const row = rA.rows[0];
      offers.push({
        store: 'amazon',
        store_sku: row.asin,
        url: null,
        title: null,
        variant_label: row.variant_label || null,
        price_cents: row.current_price_cents ?? null,
        observed_at: row.current_price_observed_at ?? null
      });
    }
  }

  // Non-Amazon listings:
  // - UPC scoped for BestBuy/Target/Walmart (and any other UPC keyed stores)
  // - Apple via pc_code
  const rows = [];

  if (selected_upc){
    const rUpc = await client.query(
      `select store, store_sku, url, variant_label, current_price_cents, current_price_observed_at
         from listings
        where norm_upc(upc) = norm_upc($1)`,
      [selected_upc]
    );
    rows.push(...rUpc.rows);
  }

  if (pc_code){
    const rApple = await client.query(
      `select store, store_sku, url, variant_label, current_price_cents, current_price_observed_at
         from listings
        where lower(btrim(store)) = 'apple'
          and upper(btrim(pc_code)) = upper(btrim($1))`,
      [pc_code]
    );
    rows.push(...rApple.rows);
  }

  for (const row of rows){
    offers.push({
      store: normStoreName(row.store),
      store_sku: row.store_sku,
      url: row.url,
      title: row.title ?? null,
      variant_label: row.variant_label || null,
      price_cents: row.current_price_cents,
      observed_at: row.current_price_observed_at
    });
  }

  // Deduplicate by store: keep freshest observed_at
  const byStore = new Map();
  for (const o of offers){
    const st = o.store;
    const existing = byStore.get(st);
    if (!existing){
      byStore.set(st, o);
      continue;
    }
    const tNew = o.observed_at ? new Date(o.observed_at).getTime() : 0;
    const tOld = existing.observed_at ? new Date(existing.observed_at).getTime() : 0;
    if (tNew > tOld) byStore.set(st, o);
    else if (tNew === tOld && existing.price_cents == null && o.price_cents != null) byStore.set(st, o);
  }

  const out = Array.from(byStore.values());
  out.sort((a,b)=> a.store.localeCompare(b.store));
  return out;
}

// variants: prefer grouping by pc_code, then model_number, then upc
async function getVariants(client, identity){
  const pc_code = identity?.pc_code || null;
  const model_number = identity?.model_number || null;
  const upc = identity?.upc || null;

  let rows = { rows: [] };

  if (pc_code && String(pc_code).trim() !== ''){
    rows = await client.query(
      `select asin, upc, variant_label, model_name, model_number, brand, category, image_url,
              current_price_cents as price_cents,
              current_price_observed_at as observed_at
         from asins
        where pc_code is not null
          and btrim(pc_code) <> ''
          and upper(btrim(pc_code)) = upper(btrim($1))
        order by
          (case when variant_label is null or btrim(variant_label) = '' then 1 else 0 end),
          variant_label nulls last,
          asin
        limit 200`,
      [pc_code]
    );
  } else if (model_number && String(model_number).trim() !== ''){
    rows = await client.query(
      `select asin, upc, variant_label, model_name, model_number, brand, category, image_url,
              current_price_cents as price_cents,
              current_price_observed_at as observed_at
         from asins
        where model_number is not null
          and btrim(model_number) <> ''
          and upper(btrim(model_number)) = upper(btrim($1))
        order by
          (case when variant_label is null or btrim(variant_label) = '' then 1 else 0 end),
          variant_label nulls last,
          asin
        limit 200`,
      [model_number]
    );
  } else if (upc){
    rows = await client.query(
      `select asin, upc, variant_label, model_name, model_number, brand, category, image_url,
              current_price_cents as price_cents,
              current_price_observed_at as observed_at
         from asins
        where norm_upc(upc) = norm_upc($1)
        order by
          (case when variant_label is null or btrim(variant_label) = '' then 1 else 0 end),
          variant_label nulls last,
          asin
        limit 200`,
      [upc]
    );
  }

  return rows.rows.map(r => ({
    asin: r.asin,
    upc: r.upc,
    variant_label: r.variant_label,
    model_name: r.model_name,
    model_number: r.model_number,
    brand: r.brand,
    category: r.category,
    image_url: r.image_url,
    price_cents: r.price_cents ?? null,
    observed_at: r.observed_at ?? null
  }));
}

// observation log - also scope correctly
async function getObservations(client, identity, selected){
  const pc_code = identity?.pc_code || null;
  const selected_asin = selected?.asin || identity?.asin || null;
  const selected_upc  = selected?.upc  || identity?.upc  || null;

  const rows = [];

  if (selected_asin){
    const r = await client.query(
      `select created_at as t, 'amazon' as store, asin as store_sku,
              current_price_cents as price_cents, null as note
         from asins
        where upper(btrim(asin)) = upper(btrim($1))
        order by created_at desc
        limit 200`,
      [selected_asin]
    );
    rows.push(...r.rows);
  }

  if (selected_upc){
    const r = await client.query(
      `select created_at as t, lower(btrim(store)) as store, store_sku,
              current_price_cents as price_cents, null as note
         from listings
        where norm_upc(upc) = norm_upc($1)
        order by created_at desc
        limit 400`,
      [selected_upc]
    );
    rows.push(...r.rows);
  }

  if (pc_code){
    const r = await client.query(
      `select created_at as t, lower(btrim(store)) as store, store_sku,
              current_price_cents as price_cents, null as note
         from listings
        where lower(btrim(store)) = 'apple'
          and upper(btrim(pc_code)) = upper(btrim($1))
        order by created_at desc
        limit 400`,
      [pc_code]
    );
    rows.push(...r.rows);
  }

  return rows.map(r => ({
    t: r.t,
    store: normStoreName(r.store),
    store_sku: r.store_sku,
    price_cents: r.price_cents,
    note: r.note || ''
  }));
}

// page
router.get('/dashboard', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'dashboard', 'index.html'));
});

// api
router.get('/api/compare/:key', async (req, res) => {
  const client = await pool.connect();
  try {
    const rawKey = req.params.key;

    const identity = await resolveKey(client, rawKey);
    if (!identity) return res.status(404).json({ error: 'not_found' });

    const selected = await resolveSelectedVariant(client, rawKey);

    const [offers, variants, observed] = await Promise.all([
      getLatestOffers(client, identity, selected),
      getVariants(client, identity),
      getObservations(client, identity, selected)
    ]);

    res.json({
      identity: {
        ...identity,
        selected_asin: selected?.asin || null,
        selected_upc: selected?.upc || null
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
