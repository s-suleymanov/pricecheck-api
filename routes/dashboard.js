// routes/dashboard.js
const path = require('path');
const express = require('express');
const router = express.Router();
const pool = require('../db');

// helpers
function isLikelyUPC(s){ return /^[0-9\s-]+$/.test(s || ''); }
function isLikelyPCI(s){
  return /^[a-z][a-z0-9_-]{7}$/i.test(String(s || '').trim());
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
  if (p === 'pci') return { kind: 'pci', value: v };
  if (p === 'bby' || p === 'bestbuy' || p === 'sku') return { kind: 'bby', value: v };
  if (p === 'walmart' || p === 'wal') return { kind: 'wal', value: v };
  if (p === 'target' || p === 'tcin') return { kind: 'tcin', value: v };

  // no prefix: guess
  if (/^[A-Z0-9]{10}$/i.test(v)) return { kind: 'asin', value: v.toUpperCase() };
  if (isLikelyUPC(v)) return { kind: 'upc', value: v };
  if (isLikelyPCI(v)) return { kind: 'pci', value: v };

  // fallback: treat as raw
  return { kind: 'raw', value: v };
}

// key resolution (returns an identity row for the product group)
async function resolveKey(client, rawKey){
  const { prefix, val } = normalizePrefix(rawKey);
  const p = (prefix || '').toLowerCase();
  const key = val;

  const findIdentity = async (asin, upc, pci) => {
    const r = await client.query(
      `select asin, upc, pci, model_name, model_number, brand, category, image_url
         from asins
        where (($1::text is not null and upper(btrim(asin)) = upper(btrim($1)))
            or ($2::text is not null and norm_upc(upc) = norm_upc($2))
            or ($3::text is not null and upper(btrim(pci)) = upper(btrim($3))))
        order by current_price_observed_at desc nulls last, created_at desc
        limit 1`,
      [asin, upc, pci]
    );
    return r.rowCount ? r.rows[0] : ((asin || upc || pci) ? { asin, upc, pci } : null);
  };

  const findByAsin = async (asin) => {
    const r = await client.query(
      `select asin, upc, pci, model_number
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
      `select asin, upc, pci
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
    if (r.rowCount) return { asin: null, upc: r.rows[0].upc, pci: null };

    return null;
  };

  const findByPci = async (pci) => {
    const r = await client.query(
      `select asin, upc, pci
         from asins
        where upper(btrim(pci)) = upper(btrim($1))
        order by current_price_observed_at desc nulls last, created_at desc
        limit 1`,
      [pci]
    );
    if (r.rowCount) return r.rows[0];

    const r2 = await client.query(
      `select pci
         from listings
        where upper(btrim(pci)) = upper(btrim($1))
        order by current_price_observed_at desc nulls last, created_at desc
        limit 1`,
      [pci]
    );
    return r2.rowCount ? { asin: null, upc: null, pci: r2.rows[0].pci } : null;
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

  if (p === 'asin'){
  const row = await findByAsin(key);
  if (!row) return null;

  // If we have model_number, identity should come from the model_number group
  if (row.model_number && String(row.model_number).trim() !== '') {
    const r2 = await client.query(
      `select asin, upc, pci, model_name, model_number, brand, category, image_url
         from asins
        where model_number is not null
          and btrim(model_number) <> ''
          and upper(btrim(model_number)) = upper(btrim($1))
        order by current_price_observed_at desc nulls last, created_at desc
        limit 1`,
      [row.model_number]
    );
    if (r2.rowCount) return r2.rows[0];

    // If no group row found, at least return model_number so variants can group
    return { asin: row.asin, upc: row.upc || null, pci: row.pci || null, model_number: row.model_number };
  }

  // If model_number missing, fall back to old identity strategy
  return await findIdentity(row.asin, row.upc, row.pci);
}

  if (p === 'upc'){
    const row = await findByUpc(key);
    return row ? await findIdentity(row.asin, row.upc, row.pci) : null;
  }
  if (p === 'pci'){
    const row = await findByPci(key);
    return row ? await findIdentity(row.asin, row.upc, row.pci) : null;
  }

  if (p === 'bby' || p === 'bestbuy' || p === 'sku'){
    const upc = await findUpcByStoreSku('bestbuy', key);
    return upc ? await findIdentity(null, upc, null) : null;
  }
  if (p === 'walmart' || p === 'wal'){
    const upc = await findUpcByStoreSku('walmart', key);
    return upc ? await findIdentity(null, upc, null) : null;
  }
  if (p === 'target' || p === 'tcin'){
    const upc = await findUpcByStoreSku('target', key);
    return upc ? await findIdentity(null, upc, null) : null;
  }

  let row = await findByAsin(key);
  if (row) return await findIdentity(row.asin, row.upc, row.pci);

  if (isLikelyUPC(key)){
    row = await findByUpc(key);
    if (row) return await findIdentity(row.asin, row.upc, row.pci);
  }

  if (isLikelyPCI(key)){
    row = await findByPci(key);
    if (row) return await findIdentity(row.asin, row.upc, row.pci);
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
      `select asin, upc, pci, variant_label
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
      `select asin, upc, pci, variant_label
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
      `select asin, upc, pci, variant_label
         from asins
        where norm_upc(upc) = norm_upc($1)
        order by current_price_observed_at desc nulls last, created_at desc
        limit 1`,
      [upc]
    );
    return rA.rowCount ? rA.rows[0] : { asin: null, upc, pci: null, variant_label: null };
  }

  // 4) pci: pick latest asin within that group as "selected" default
  if (kind === 'pci'){
    const r = await client.query(
      `select asin, upc, pci, variant_label
         from asins
        where upper(btrim(pci)) = upper(btrim($1))
        order by current_price_observed_at desc nulls last, created_at desc
        limit 1`,
      [value]
    );
    return r.rowCount ? r.rows[0] : { asin: null, upc: null, pci: value, variant_label: null };
  }

  return null;
}

// latest offers, but scoped correctly
async function getLatestOffers(client, identity, selected){
  const pci = identity?.pci || null;
  const selected_upc = selected?.upc || identity?.upc || null;

  // IMPORTANT: make this mutable because we may backfill it.
  let selected_asin = selected?.asin || identity?.asin || null;

  const offers = [];
  const rows = [];

  // 1) Ensure Amazon shows up for a pci-driven compare:
  // If selected_asin is missing but we have pci, pick the best ASIN in that pci group.
  if (!selected_asin && pci){
    const r = await client.query(
      `select asin
         from asins
        where pci is not null
          and btrim(pci) <> ''
          and upper(btrim(pci)) = upper(btrim($1))
          and asin is not null
          and btrim(asin) <> ''
        order by current_price_observed_at desc nulls last, created_at desc
        limit 1`,
      [pci]
    );
    if (r.rowCount) selected_asin = r.rows[0].asin;
  }

  // If still no ASIN, but we do have a UPC, try to find an ASIN for that UPC.
  if (!selected_asin && selected_upc){
    const r = await client.query(
      `select asin
         from asins
        where norm_upc(upc) = norm_upc($1)
          and asin is not null
          and btrim(asin) <> ''
        order by current_price_observed_at desc nulls last, created_at desc
        limit 1`,
      [selected_upc]
    );
    if (r.rowCount) selected_asin = r.rows[0].asin;
  }

  // 2) Amazon offer (from asins)
  if (selected_asin){
    const rA = await client.query(
      `select asin, variant_label, current_price_cents, current_price_observed_at
         from asins
        where upper(btrim(asin)) = upper(btrim($1))
        order by current_price_observed_at desc nulls last, created_at desc
        limit 1`,
      [selected_asin]
    );

    if (rA.rowCount){
      const a = rA.rows[0];
      offers.push({
        store: 'amazon',
        store_sku: a.asin,
        url: null,
        title: null,
        variant_label: a.variant_label || null,
        price_cents: a.current_price_cents ?? null,
        observed_at: a.current_price_observed_at ?? null
      });
    }
  }

  // 3) Non-Amazon listings:
  // Pass A: UPC scoped (exact variant)
  if (selected_upc){
    const rUpc = await client.query(
      `select store, store_sku, url, variant_label, title, current_price_cents, current_price_observed_at
         from listings
        where norm_upc(upc) = norm_upc($1)`,
      [selected_upc]
    );
    rows.push(...rUpc.rows.map(x => ({ ...x, _scope: 'upc' })));
  }

  // Pass B: pci scoped (fallback group match for ANY store)
  if (pci){
    const rPc = await client.query(
      `select store, store_sku, url, variant_label, title, current_price_cents, current_price_observed_at
         from listings
        where pci is not null
          and btrim(pci) <> ''
          and upper(btrim(pci)) = upper(btrim($1))`,
      [pci]
    );
    rows.push(...rPc.rows.map(x => ({ ...x, _scope: 'pci' })));
  }

  for (const row of rows){
    const st = normStoreName(row.store);
    if (st === 'amazon') continue;

    offers.push({
      store: st,
      store_sku: row.store_sku,
      url: row.url,
      title: row.title ?? null,
      variant_label: row.variant_label || null,
      price_cents: row.current_price_cents ?? null,
      observed_at: row.current_price_observed_at ?? null,
      _scope: row._scope
    });
  }

  // 4) Deduplicate by store:
  // Prefer UPC-scoped over PC-scoped, then freshest observed_at.
  const byStore = new Map();
  for (const o of offers){
    const existing = byStore.get(o.store);
    if (!existing){
      byStore.set(o.store, o);
      continue;
    }

    const sNew = o._scope === 'upc' ? 2 : 1;
    const sOld = existing._scope === 'upc' ? 2 : 1;

    if (sNew > sOld){
      byStore.set(o.store, o);
      continue;
    }
    if (sNew < sOld) continue;

    const tNew = o.observed_at ? new Date(o.observed_at).getTime() : 0;
    const tOld = existing.observed_at ? new Date(existing.observed_at).getTime() : 0;
    if (tNew > tOld) byStore.set(o.store, o);
    else if (tNew === tOld && existing.price_cents == null && o.price_cents != null) byStore.set(o.store, o);
  }

  const out = Array.from(byStore.values()).map(({ _scope, ...rest }) => rest);
  out.sort((a,b)=> a.store.localeCompare(b.store));
  return out;
}

// variants: prefer grouping by pci, then model_number, then upc
async function getVariants(client, identity){
  const pci = identity?.pci || null;
  const model_number = identity?.model_number || null;
  const upc = identity?.upc || null;

  let rows = { rows: [] };

  if (pci && String(pci).trim() !== ''){
    rows = await client.query(
      `select asin, upc, variant_label, model_name, model_number, brand, category, image_url,
              current_price_cents as price_cents,
              current_price_observed_at as observed_at
         from asins
        where pci is not null
          and btrim(pci) <> ''
          and upper(btrim(pci)) = upper(btrim($1))
        order by
          (case when variant_label is null or btrim(variant_label) = '' then 1 else 0 end),
          variant_label nulls last,
          asin
        limit 200`,
      [pci]
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
  const pci = identity?.pci || null;
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

  if (pci){
    const r = await client.query(
      `select created_at as t, lower(btrim(store)) as store, store_sku,
              current_price_cents as price_cents, null as note
         from listings
        where pci is not null
          and btrim(pci) <> ''
          and upper(btrim(pci)) = upper(btrim($1))
        order by created_at desc
        limit 400`,
      [pci]
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
