// routes/dashboard.js
const path = require('path');
const express = require('express');
const router = express.Router();
const pool = require('../db');

// helpers
function isLikelyUPC(s){ return /^[0-9\s-]+$/.test(s || ''); }
function isLikelyPcCode(s){
  // allow pc_code like PC-000123, AIRPODS-PRO-2-USBC, etc
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

// key resolution
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

    // fallback: maybe only exists in listings (ex: Apple-only initially)
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

  // explicit prefixes
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

  // no prefix: try ASIN
  let row = await findByAsin(key);
  if (row) return await findIdentity(row.asin, row.upc, row.pc_code);

  // no prefix: try UPC
  if (isLikelyUPC(key)){
    row = await findByUpc(key);
    if (row) return await findIdentity(row.asin, row.upc, row.pc_code);
  }

  // no prefix: try pc_code
  if (isLikelyPcCode(key)){
    row = await findByPcCode(key);
    if (row) return await findIdentity(row.asin, row.upc, row.pc_code);
  }

  // no prefix: try store_sku for known stores -> resolve to UPC -> identity
  for (const st of ['bestbuy','walmart','target']){
    const upc = await findUpcByStoreSku(st, key);
    if (upc) return await findIdentity(null, upc, null);
  }

  return null;
}

// latest offers
async function getLatestOffers(client, keyInfo){
  const { asin, upc, pc_code } = keyInfo;
  const offers = [];

  // Amazon via asins
  if (asin || upc || pc_code){
    const rA = await client.query(
      `select a.asin,
              a.variant_label,
              a.current_price_cents,
              a.current_price_observed_at
         from asins a
        where ($1::text is not null and upper(btrim(a.asin)) = upper(btrim($1)))
           or ($2::text is not null and norm_upc(a.upc) = norm_upc($2))
           or ($3::text is not null and upper(btrim(a.pc_code)) = upper(btrim($3)))
        order by a.current_price_observed_at desc nulls last, a.created_at desc
        limit 1`,
      [asin, upc, pc_code]
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

  // Other stores (including Apple) via listings by UPC or pc_code
  if (upc || pc_code){
    const rL = await client.query(
      `select store,
              store_sku,
              url,
              variant_label,
              current_price_cents,
              current_price_observed_at
         from listings
        where ($1::text is not null and norm_upc(upc) = norm_upc($1))
           or ($2::text is not null and upper(btrim(pc_code)) = upper(btrim($2)))`,
      [upc, pc_code]
    );

    for (const row of rL.rows){
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
  }

  // Deduplicate by store: keep freshest observed_at, else any non-null price
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

    if (tNew > tOld){
      byStore.set(st, o);
      continue;
    }

    if (tNew === tOld){
      if ((existing.price_cents == null) && (o.price_cents != null)){
        byStore.set(st, o);
      }
    }
  }

  const out = Array.from(byStore.values());
  out.sort((a,b)=> a.store.localeCompare(b.store));
  return out;
}

// variants: all ASIN rows that share the anchor model_number (fallback to pc_code, then UPC family)
async function getVariants(client, keyInfo){
  const { asin, upc, pc_code } = keyInfo;

  // 1) find an anchor row to learn grouping keys
  let anchor = null;

  if (asin){
    const r = await client.query(
      `select asin, upc, pc_code, model_name, model_number, brand, category, image_url
         from asins
        where upper(btrim(asin)) = upper(btrim($1))
        order by current_price_observed_at desc nulls last, created_at desc
        limit 1`,
      [asin]
    );
    if (r.rowCount) anchor = r.rows[0];
  }

  if (!anchor && upc){
    const r = await client.query(
      `select asin, upc, pc_code, model_name, model_number, brand, category, image_url
         from asins
        where norm_upc(upc) = norm_upc($1)
        order by current_price_observed_at desc nulls last, created_at desc
        limit 1`,
      [upc]
    );
    if (r.rowCount) anchor = r.rows[0];
  }

  if (!anchor && pc_code){
    const r = await client.query(
      `select asin, upc, pc_code, model_name, model_number, brand, category, image_url
         from asins
        where upper(btrim(pc_code)) = upper(btrim($1))
        order by current_price_observed_at desc nulls last, created_at desc
        limit 1`,
      [pc_code]
    );
    if (r.rowCount) anchor = r.rows[0];
  }

  if (!anchor){
    return [];
  }

  // 2) prefer grouping by model_number, else pc_code, else UPC
  let rows;
  if (anchor.model_number && anchor.model_number.trim() !== ''){
    rows = await client.query(
      `select asin, variant_label, model_name, model_number, brand, category, image_url
         from asins
        where model_number is not null
          and btrim(model_number) <> ''
          and upper(btrim(model_number)) = upper(btrim($1))
        order by
          (case when variant_label is null or btrim(variant_label) = '' then 1 else 0 end),
          variant_label nulls last,
          asin
        limit 200`,
      [anchor.model_number]
    );
  } else if (anchor.pc_code && anchor.pc_code.trim() !== ''){
    rows = await client.query(
      `select asin, variant_label, model_name, model_number, brand, category, image_url
         from asins
        where pc_code is not null
          and btrim(pc_code) <> ''
          and upper(btrim(pc_code)) = upper(btrim($1))
        order by
          (case when variant_label is null or btrim(variant_label) = '' then 1 else 0 end),
          variant_label nulls last,
          asin
        limit 200`,
      [anchor.pc_code]
    );
  } else if (anchor.upc){
    rows = await client.query(
      `select asin, variant_label, model_name, model_number, brand, category, image_url
         from asins
        where norm_upc(upc) = norm_upc($1)
        order by
          (case when variant_label is null or btrim(variant_label) = '' then 1 else 0 end),
          variant_label nulls last,
          asin
        limit 200`,
      [anchor.upc]
    );
  } else {
    rows = { rows: [] };
  }

  return rows.rows.map(r => ({
    asin: r.asin,
    variant_label: r.variant_label,
    model_name: r.model_name,
    model_number: r.model_number,
    brand: r.brand,
    category: r.category,
    image_url: r.image_url
  }));
}

// observation log - from asins and listings created_at
async function getObservations(client, keyInfo){
  const { asin, upc, pc_code } = keyInfo;
  const rows = [];

  // from asins by asin or upc or pc_code
  if (asin || upc || pc_code){
    const r = await client.query(
      `select created_at as t, 'amazon' as store, asin as store_sku,
              current_price_cents as price_cents, null as note
         from asins
        where ($1::text is not null and upper(btrim(asin)) = upper(btrim($1)))
           or ($2::text is not null and norm_upc(upc) = norm_upc($2))
           or ($3::text is not null and upper(btrim(pc_code)) = upper(btrim($3)))
        order by created_at desc
        limit 200`,
      [asin, upc, pc_code]
    );
    rows.push(...r.rows);
  }

  // from listings by upc OR pc_code (covers Apple)
  if (upc || pc_code){
    const r = await client.query(
      `select created_at as t, lower(btrim(store)) as store, store_sku,
              current_price_cents as price_cents, null as note
         from listings
        where ($1::text is not null and norm_upc(upc) = norm_upc($1))
           or ($2::text is not null and upper(btrim(pc_code)) = upper(btrim($2)))
        order by created_at desc
        limit 400`,
      [upc, pc_code]
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
    const info = await resolveKey(client, req.params.key);
    if (!info) return res.status(404).json({ error: 'not_found' });

    const [offers, variants, observed] = await Promise.all([
      getLatestOffers(client, info),
      getVariants(client, info),
      getObservations(client, info)
    ]);

    res.json({ identity: info, variants, offers, observed });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'server_error' });
  } finally {
    client.release();
  }
});

module.exports = router;
