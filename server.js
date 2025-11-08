// server.js
const path = require('path');
const express = require('express');
const { Pool } = require('pg');

const app = express();
app.use(express.static('public'));

app.get('/warm', async (req, res) => {
  try {
    const t0 = Date.now();
    await pool.query('select 1');
    res.set('Cache-Control', 'no-store');
    res.json({ ok: true, ms: Date.now() - t0 });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false });
  }
});

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// -------------- helpers --------------
function isLikelyUPC(s) {
  return /^[0-9\s-]+$/.test(s || '');
}
function normalizePrefix(raw) {
  const s = String(raw || '').trim();
  const i = s.indexOf(':');
  if (i === -1) return { prefix: null, val: s };
  return { prefix: s.slice(0, i).toLowerCase(), val: s.slice(i + 1).trim() };
}
function normStoreName(s) {
  const k = String(s || '').trim().toLowerCase();
  if (k === 'best buy') return 'bestbuy';
  return k;
}

// -------------- key resolution --------------
async function resolveKey(client, rawKey) {
  const { prefix, val } = normalizePrefix(rawKey);
  const key = val;

  const findByAsin = async (asin) => {
    const r = await client.query(
      `select asin, upc
         from asins
        where upper(btrim(asin)) = upper(btrim($1))
        limit 1`,
      [asin]
    );
    return r.rowCount ? r.rows[0] : null;
  };

  const findByUpc = async (upcInput) => {
    // Prefer asins first
    let r = await client.query(
      `select asin, upc
         from asins
        where norm_upc(upc) = norm_upc($1)
        limit 1`,
      [upcInput]
    );
    if (r.rowCount) return r.rows[0];

    // Fall back to listings
    r = await client.query(
      `select upc
         from listings
        where norm_upc(upc) = norm_upc($1)
        order by current_price_observed_at desc nulls last, created_at desc nulls last
        limit 1`,
      [upcInput]
    );
    return r.rowCount ? { asin: null, upc: r.rows[0].upc } : null;
  };

  const findUpcByStoreSku = async (store, sku) => {
    const r = await client.query(
      `select upc
         from listings
        where lower(btrim(store)) = lower(btrim($1))
          and norm_sku(store_sku) = norm_sku($2)
        order by current_price_observed_at desc nulls last, created_at desc nulls last
        limit 1`,
      [store, sku]
    );
    return r.rowCount ? r.rows[0].upc : null;
  };

  // explicit prefixes
  if (prefix === 'asin') {
    const row = await findByAsin(key);
    if (row) return row;
  }
  if (prefix === 'upc') {
    const row = await findByUpc(key);
    if (row) return row;
  }
  if (prefix === 'bby' || prefix === 'bestbuy' || prefix === 'sku') {
    const upc = await findUpcByStoreSku('bestbuy', key);
    if (upc) return (await findByUpc(upc)) || { asin: null, upc };
  }
  if (prefix === 'walmart' || prefix === 'wal') {
    const upc = await findUpcByStoreSku('walmart', key);
    if (upc) return (await findByUpc(upc)) || { asin: null, upc };
  }
  if (prefix === 'target' || prefix === 'tcin') {
    const upc = await findUpcByStoreSku('target', key);
    if (upc) return (await findByUpc(upc)) || { asin: null, upc };
  }

  // no prefix
  let row = await findByAsin(key);
  if (row) return row;

  if (isLikelyUPC(key)) {
    row = await findByUpc(key);
    if (row) return row;
  }

  for (const st of ['bestbuy', 'walmart', 'target']) {
    const upc = await findUpcByStoreSku(st, key);
    if (upc) return (await findByUpc(upc)) || { asin: null, upc };
  }

  return null;
}

// -------------- latest offers (asins + listings) --------------
async function getLatestOffers(client, keyInfo) {
  const { asin, upc } = keyInfo;
  const offers = [];

  // Amazon from asins
  if (asin || upc) {
    const rA = await client.query(
      `select asin,
              current_price_cents,
              current_price_observed_at,
              created_at,
              upc,
              variant_label
         from asins
        where ($1::text is not null and upper(btrim(asin)) = upper(btrim($1)))
           or ($2::text is not null and norm_upc(upc) = norm_upc($2))
        order by current_price_observed_at desc nulls last, created_at desc nulls last
        limit 1`,
      [asin, upc]
    );
    if (rA.rowCount) {
      const a = rA.rows[0];
      offers.push({
        store: 'amazon',
        store_sku: a.asin,
        url: null,
        title: null,
        price_cents: a.current_price_cents ?? null,
        observed_at: a.current_price_observed_at ?? a.created_at ?? null,
        variant_label: a.variant_label || null
      });
    }
  }

  // Other stores from listings by UPC
  if (upc) {
    const rL = await client.query(
      `select store, store_sku, url,
              current_price_cents,
              current_price_observed_at,
              created_at,
              variant_label
         from listings
        where norm_upc(upc) = norm_upc($1)`,
      [upc]
    );
    for (const row of rL.rows) {
      offers.push({
        store: normStoreName(row.store),
        store_sku: row.store_sku,
        url: row.url,
        title: null,
        price_cents: row.current_price_cents,
        observed_at: row.current_price_observed_at ?? row.created_at ?? null,
        variant_label: row.variant_label || null
      });
    }
  }

  // Stable order
  offers.sort((a, b) => a.store.localeCompare(b.store));
  return offers;
}

// -------------- variants: all ASINs sharing the same model_number, with specs --------------
async function getVariantsForKey(client, keyInfo) {
  const { asin, upc } = keyInfo;

  // 1) find model_number for the resolved key
  let model = null;

  if (asin) {
    const r = await client.query(
      `select model_number
         from asins
        where upper(btrim(asin)) = upper(btrim($1))
        limit 1`,
      [asin]
    );
    if (r.rowCount) model = (r.rows[0].model_number || '').trim() || null;
  }

  if (!model && upc) {
    const r = await client.query(
      `select model_number
         from asins
        where norm_upc(upc) = norm_upc($1)
          and model_number is not null
          and btrim(model_number) <> ''
        order by created_at desc nulls last
        limit 1`,
      [upc]
    );
    if (r.rowCount) model = (r.rows[0].model_number || '').trim() || null;
  }

  // 2) pull all ASINs under that model_number
  if (model) {
    const r2 = await client.query(
      `select
          asin,
          coalesce(nullif(btrim(variant_label), ''), asin) as variant_label,
          category,
          brand,
          model_number,
          model_name
        from asins
       where btrim(model_number) = btrim($1)
       order by variant_label nulls last, asin`,
      [model]
    );
    return r2.rows;
  }

  // 3) fallbacks (still include specs)
  if (upc) {
    const r3 = await client.query(
      `select
          asin,
          coalesce(nullif(btrim(variant_label), ''), asin) as variant_label,
          category,
          brand,
          model_number,
          model_name
        from asins
       where norm_upc(upc) = norm_upc($1)
       order by variant_label nulls last, asin`,
      [upc]
    );
    return r3.rows;
  }

  if (asin) {
    const r4 = await client.query(
      `select
          asin,
          coalesce(nullif(btrim(variant_label), ''), asin) as variant_label,
          category,
          brand,
          model_number,
          model_name
        from asins
       where upper(btrim(asin)) = upper(btrim($1))
       limit 1`,
      [asin]
    );
    return r4.rows;
  }

  return [];
}

// -------------- observation log = price_history + current snapshots --------------
async function getObservations(client, keyInfo) {
  const { asin, upc } = keyInfo;

  const rows = [];
  const seen = new Set();
  const add = (r) => {
    if (!r.t) return;
    const key = [
      r.store || '',
      r.asin || r.store_sku || r.upc || '',
      r.price_cents == null ? '' : String(r.price_cents),
      new Date(r.t).toISOString()
    ].join('|');
    if (seen.has(key)) return;
    seen.add(key);
    rows.push(r);
  };

  // 1) price_history rows
  const params = [];
  const where = [];
  if (asin) {
    params.push(asin);
    where.push(`(lower(btrim(store)) = 'amazon' and upper(btrim(asin)) = upper(btrim($${params.length})))`);
  }
  if (upc) {
    params.push(upc);
    where.push(`(norm_upc(upc) = norm_upc($${params.length}))`);
  }

  if (where.length) {
    const q = `
      select
        lower(btrim(store)) as store,
        asin,
        upc,
        store_sku,
        price_cents,
        observed_at,
        url,
        title
      from price_history
      where ${where.join(' or ')}
      order by observed_at desc
      limit 1000
    `;
    const r = await client.query(q, params);
    for (const ph of r.rows) {
      add({
        t: ph.observed_at,
        created_at: ph.observed_at,
        store: normStoreName(ph.store),
        store_sku: ph.store === 'amazon' ? ph.asin : ph.store_sku,
        price_cents: ph.price_cents,
        url: ph.url,
        title: ph.title,
        asin: ph.asin,
        upc: ph.upc,
        note: ''
      });
    }
  }

  // 2) current snapshot from asins
  if (asin || upc) {
    const rA = await client.query(
      `select asin, upc,
              current_price_cents,
              coalesce(current_price_observed_at, created_at) as observed_at
         from asins
        where ($1::text is not null and upper(btrim(asin)) = upper(btrim($1)))
           or ($2::text is not null and norm_upc(upc) = norm_upc($2))`,
      [asin, upc]
    );
    for (const a of rA.rows) {
      add({
        t: a.observed_at,
        created_at: a.observed_at,
        store: 'amazon',
        store_sku: a.asin,
        price_cents: a.current_price_cents,
        url: null,
        title: null,
        asin: a.asin,
        upc: a.upc,
        note: ''
      });
    }
  }

  // 3) current snapshot from listings by UPC
  if (upc) {
    const rL = await client.query(
      `select store, store_sku, upc, url,
              current_price_cents,
              coalesce(current_price_observed_at, created_at) as observed_at
         from listings
        where norm_upc(upc) = norm_upc($1)`,
      [upc]
    );
    for (const l of rL.rows) {
      add({
        t: l.observed_at,
        created_at: l.observed_at,
        store: normStoreName(l.store),
        store_sku: l.store_sku,
        price_cents: l.current_price_cents,
        url: l.url,
        title: null,
        asin: null,
        upc: l.upc,
        note: ''
      });
    }
  }

  // Sort newest first and cap
  rows.sort((a, b) => new Date(b.t).getTime() - new Date(a.t).getTime());
  return rows.slice(0, 300);
}

// -------------- routes --------------
app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard', 'index.html'));
});

app.get('/v1/compare/:key', async (req, res) => {
  const client = await pool.connect();
  try {
    const info = await resolveKey(client, req.params.key);
    if (!info) return res.status(404).json({ error: 'not_found' });

    const [offers, variants, observed] = await Promise.all([
      getLatestOffers(client, info),
      getVariantsForKey(client, info),
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

// -------------- boot --------------
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Listening on http://localhost:${port}`);
});
