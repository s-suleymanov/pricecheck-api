// routes/dashboard.js
const path = require('path');
const express = require('express');
const router = express.Router();
const pool = require('../db');

// helpers
function isLikelyUPC(s){ return /^[0-9\s-]+$/.test(s || ''); }
function normalizePrefix(raw){
  const s = String(raw || '').trim();
  const i = s.indexOf(':');
  if (i === -1) return { prefix: null, val: s };
  return { prefix: s.slice(0, i).toLowerCase(), val: s.slice(i + 1).trim() };
}
function normStoreName(s){ const k = String(s||'').trim().toLowerCase(); return k === 'best buy' ? 'bestbuy' : k; }

// key resolution
async function resolveKey(client, rawKey){
  const { prefix, val } = normalizePrefix(rawKey);
  const key = val;

  const findIdentity = async (asin, upc) => {
    const r = await client.query(
      `select asin, upc, model_name, model_number, brand, category
         from asins
        where (($1::text is not null and upper(btrim(asin)) = upper(btrim($1)))
            or ($2::text is not null and norm_upc(upc) = norm_upc($2)))
        order by current_price_observed_at desc nulls last, created_at desc
        limit 1`,
      [asin, upc]
    );
    return r.rowCount ? r.rows[0] : (asin || upc ? { asin, upc } : null);
  };

  const findByAsin = async (asin) => {
    const r = await client.query(
      `select asin, upc from asins where upper(btrim(asin)) = upper(btrim($1)) limit 1`, [asin]
    );
    return r.rowCount ? r.rows[0] : null;
  };

  const findByUpc = async (upcInput) => {
    let r = await client.query(
      `select asin, upc from asins where norm_upc(upc) = norm_upc($1) limit 1`, [upcInput]
    );
    if (r.rowCount) return r.rows[0];

    r = await client.query(
      `select upc from listings
       where norm_upc(upc) = norm_upc($1)
       order by current_price_observed_at desc nulls last
       limit 1`, [upcInput]
    );
    if (r.rowCount) return { asin: null, upc: r.rows[0].upc };

    return null;
  };

  const findUpcByStoreSku = async (store, sku) => {
    let r = await client.query(
      `select upc from listings
       where lower(btrim(store)) = lower(btrim($1))
         and norm_sku(store_sku) = norm_sku($2)
       order by current_price_observed_at desc nulls last
       limit 1`, [store, sku]
    );
    return r.rowCount ? r.rows[0].upc : null;
  };

  // explicit prefixes
  if (prefix === 'asin') {
    const row = await findByAsin(key);
    return row ? await findIdentity(row.asin, row.upc) : null;
  }
  if (prefix === 'upc')  {
    const row = await findByUpc(key);
    return row ? await findIdentity(row.asin, row.upc) : null;
  }
  if (prefix === 'bby' || prefix === 'bestbuy' || prefix === 'sku') {
    const upc = await findUpcByStoreSku('bestbuy', key);
    return upc ? await findIdentity(null, upc) : null;
  }
  if (prefix === 'walmart' || prefix === 'wal') {
    const upc = await findUpcByStoreSku('walmart', key);
    return upc ? await findIdentity(null, upc) : null;
  }
  if (prefix === 'target' || prefix === 'tcin') {
    const upc = await findUpcByStoreSku('target', key);
    return upc ? await findIdentity(null, upc) : null;
  }

  // no prefix
  let row = await findByAsin(key);
  if (row) return await findIdentity(row.asin, row.upc);

  if (isLikelyUPC(key)) {
    row = await findByUpc(key);
    if (row) return await findIdentity(row.asin, row.upc);
  }

  for (const st of ['bestbuy','walmart','target']){
    const upc = await findUpcByStoreSku(st, key);
    if (upc) return await findIdentity(null, upc);
  }
  return null;
}

// latest offers
async function getLatestOffers(client, keyInfo){
  const { asin, upc } = keyInfo;
  const offers = [];

  // Amazon via asins
  if (asin || upc){
    const rA = await client.query(
      `select a.asin, a.current_price_cents, a.current_price_observed_at
       from asins a
       where ($1::text is not null and upper(btrim(a.asin)) = upper(btrim($1)))
          or ($2::text is not null and norm_upc(a.upc) = norm_upc($2))
       order by a.current_price_observed_at desc nulls last
       limit 1`, [asin, upc]
    );
    if (rA.rowCount){
      const row = rA.rows[0];
      offers.push({
        store: 'amazon',
        store_sku: row.asin,
        url: null, title: null,
        price_cents: row.current_price_cents ?? null,
        observed_at: row.current_price_observed_at ?? null
      });
    }
  }

  // other stores via listings
  if (upc){
    const rL = await client.query(
      `select store, store_sku, url, current_price_cents, current_price_observed_at
       from listings
       where norm_upc(upc) = norm_upc($1)`, [upc]
    );
    for (const row of rL.rows){
      offers.push({
        store: normStoreName(row.store),
        store_sku: row.store_sku,
        url: row.url,
        title: null,
        price_cents: row.current_price_cents,
        observed_at: row.current_price_observed_at
      });
    }
  }

  // view fallback to fill gaps
  const rV = await client.query(
    `select store, asin, store_sku, url, title, price_cents, observed_at
     from v_latest_price
     where
       ($1::text is not null and store = 'amazon' and asin = $1)
        or
       ($2::text is not null and store <> 'amazon' and norm_upc(store_sku) = norm_upc($2))`,
    [asin, upc]
  );
  for (const row of rV.rows){
    const st = normStoreName(row.store);
    const existing = offers.find(o => o.store === st);
    if (!existing || existing.price_cents == null){
      const merged = existing || { store: st };
      merged.store_sku = st === 'amazon' ? row.asin : row.store_sku;
      merged.url = row.url ?? merged.url ?? null;
      merged.title = row.title ?? merged.title ?? null;
      merged.price_cents = merged.price_cents ?? row.price_cents ?? null;
      merged.observed_at = merged.observed_at ?? row.observed_at ?? null;
      if (!existing) offers.push(merged);
    }
  }

  offers.sort((a,b)=> a.store.localeCompare(b.store));
  return offers;
}

// variants: all ASIN rows that share the anchor model_number (fallback to UPC family)
async function getVariants(client, keyInfo){
  const { asin, upc } = keyInfo;

  // 1) find an anchor row to learn model_number
  let anchor = null;
  if (asin){
    const r = await client.query(
      `select asin, upc, model_name, model_number, brand, category
         from asins
        where upper(btrim(asin)) = upper(btrim($1))
        order by current_price_observed_at desc nulls last, created_at desc
        limit 1`, [asin]
    );
    if (r.rowCount) anchor = r.rows[0];
  }
  if (!anchor && upc){
    const r = await client.query(
      `select asin, upc, model_name, model_number, brand, category
         from asins
        where norm_upc(upc) = norm_upc($1)
        order by current_price_observed_at desc nulls last, created_at desc
        limit 1`, [upc]
    );
    if (r.rowCount) anchor = r.rows[0];
  }

  if (!anchor){
    return []; // nothing to show
  }

  // 2) prefer grouping by model_number, else by UPC
  let rows;
  if (anchor.model_number && anchor.model_number.trim() !== ''){
    rows = await client.query(
      `select asin, variant_label, model_name, model_number, brand, category
         from asins
        where model_number is not null
          and btrim(model_number) <> ''
          and upper(btrim(model_number)) = upper(btrim($1))
        order by
          (case when variant_label is null or btrim(variant_label) = '' then 1 else 0 end),
          variant_label nulls last,
          asin
        limit 200`, [anchor.model_number]
    );
  } else if (anchor.upc) {
    rows = await client.query(
      `select asin, variant_label, model_name, model_number, brand, category
         from asins
        where norm_upc(upc) = norm_upc($1)
        order by
          (case when variant_label is null or btrim(variant_label) = '' then 1 else 0 end),
          variant_label nulls last,
          asin
        limit 200`, [anchor.upc]
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
    category: r.category
  }));
}

// observation log - from asins and listings created_at and current_price_observed_at
async function getObservations(client, keyInfo){
  const { asin, upc } = keyInfo;

  const rows = [];

  // from asins by asin or upc
  if (asin){
    const r = await client.query(
      `select created_at as t, 'amazon' as store, asin as store_sku,
              current_price_cents as price_cents, null as note
       from asins
       where upper(btrim(asin)) = upper(btrim($1))
       order by created_at desc
       limit 200`, [asin]
    );
    rows.push(...r.rows);
  } else if (upc){
    const r = await client.query(
      `select created_at as t, 'amazon' as store, asin as store_sku,
              current_price_cents as price_cents, null as note
       from asins
       where norm_upc(upc) = norm_upc($1)
       order by created_at desc
       limit 200`, [upc]
    );
    rows.push(...r.rows);
  }

  // from listings by upc
  if (upc){
    const r = await client.query(
      `select created_at as t, lower(btrim(store)) as store, store_sku,
              current_price_cents as price_cents, null as note
       from listings
       where norm_upc(upc) = norm_upc($1)
       order by created_at desc
       limit 400`, [upc]
    );
    rows.push(...r.rows);
  }

  // normalize output
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
