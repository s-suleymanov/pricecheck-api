const express = require('express');
const { Pool } = require('pg');

const app = express();
app.use(express.static('public'));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL, // your Neon uri
  ssl: { rejectUnauthorized: false }
});

function money(cents) {
  if (cents == null) return '';
  return `$${(cents / 100).toFixed(2)}`;
}

function isLikelyUPC(s) {
  return /^[0-9\s-]+$/.test(s || '');
}

function normalizePrefix(raw) {
  const s = String(raw || '').trim();
  const i = s.indexOf(':');
  if (i === -1) return { prefix: null, val: s };
  return { prefix: s.slice(0, i).toLowerCase(), val: s.slice(i + 1).trim() };
}

// Resolve incoming key to { asin, upc }
// Uses your asins, listings, and price_history tables.
async function resolveKey(client, rawKey) {
  const { prefix, val } = normalizePrefix(rawKey);
  const key = val;

  // Helper lookups
  const findByAsin = async (asin) => {
    const r = await client.query(
      `select asin, upc from asins where upper(btrim(asin)) = upper(btrim($1)) limit 1`,
      [asin]
    );
    if (r.rowCount) return r.rows[0];
    return null;
  };

  const findByUpc = async (upcInput) => {
    // prefer asins first, else listings
    let r = await client.query(
      `select asin, upc
       from asins
       where norm_upc(upc) = norm_upc($1)
       limit 1`,
      [upcInput]
    );
    if (r.rowCount) return r.rows[0];

    r = await client.query(
      `select upc
       from listings
       where norm_upc(upc) = norm_upc($1)
       order by current_price_observed_at desc nulls last
       limit 1`,
      [upcInput]
    );
    if (r.rowCount) return { asin: null, upc: r.rows[0].upc };

    // last resort: price_history
    r = await client.query(
      `select upc
       from price_history
       where norm_upc(upc) = norm_upc($1)
       order by observed_at desc
       limit 1`,
      [upcInput]
    );
    if (r.rowCount) return { asin: null, upc: r.rows[0].upc };

    return null;
  };

  const findUpcByStoreSku = async (store, sku) => {
    let r = await client.query(
      `select upc
       from listings
       where lower(btrim(store)) = lower(btrim($1))
         and norm_sku(store_sku) = norm_sku($2)
       order by current_price_observed_at desc nulls last
       limit 1`,
      [store, sku]
    );
    if (r.rowCount) return r.rows[0].upc;

    r = await client.query(
      `select upc
       from price_history
       where lower(btrim(store)) = lower(btrim($1))
         and norm_sku(store_sku) = norm_sku($2)
       order by observed_at desc
       limit 1`,
      [store, sku]
    );
    if (r.rowCount) return r.rows[0].upc;

    return null;
  };

  // 1) Explicit prefixes
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
    if (upc) return await findByUpc(upc) || { asin: null, upc };
  }
  if (prefix === 'walmart' || prefix === 'wal') {
    const upc = await findUpcByStoreSku('walmart', key);
    if (upc) return await findByUpc(upc) || { asin: null, upc };
  }
  if (prefix === 'target' || prefix === 'tcin') {
    const upc = await findUpcByStoreSku('target', key);
    if (upc) return await findByUpc(upc) || { asin: null, upc };
  }

  // 2) No prefix - try ASIN
  let row = await findByAsin(key);
  if (row) return row;

  // 3) No prefix - if it looks like UPC, try UPC
  if (isLikelyUPC(key)) {
    row = await findByUpc(key);
    if (row) return row;
  }

  // 4) No prefix - try as store_sku across stores
  for (const st of ['bestbuy', 'walmart', 'target']) {
    const upc = await findUpcByStoreSku(st, key);
    if (upc) return await findByUpc(upc) || { asin: null, upc };
  }

  return null;
}

// Pull latest prices:
// - Amazon from asins.current_price_* (fallback to price_history if null)
// - Other stores from listings.current_price_* for the UPC
// - Fill any missing store with v_latest_price
async function getLatestOffers(client, keyInfo) {
  const { asin, upc } = keyInfo;
  const offers = [];
  const seenStores = new Set();

  // Amazon
  if (asin || upc) {
    const rA = await client.query(
      `select a.asin, a.current_price_cents, a.current_price_observed_at
       from asins a
       where ($1::text is not null and upper(btrim(a.asin)) = upper(btrim($1)))
          or ($2::text is not null and norm_upc(a.upc) = norm_upc($2))
       order by a.current_price_observed_at desc nulls last
       limit 1`,
      [asin, upc]
    );
    if (rA.rowCount) {
      const row = rA.rows[0];
      // try to get URL and title from latest price_history for that ASIN
      const rPH = await client.query(
        `select url, title, price_cents, observed_at
         from price_history
         where lower(btrim(store)) = 'amazon'
           and asin = $1
         order by observed_at desc
         limit 1`,
        [row.asin]
      );

      offers.push({
        store: 'amazon',
        store_sku: row.asin,
        url: rPH.rowCount ? rPH.rows[0].url : null,
        title: rPH.rowCount ? rPH.rows[0].title : null,
        price_cents: row.current_price_cents ?? (rPH.rowCount ? rPH.rows[0].price_cents : null),
        observed_at: row.current_price_observed_at ?? (rPH.rowCount ? rPH.rows[0].observed_at : null)
      });
      seenStores.add('amazon');
    }
  }

  // Other stores from listings by UPC
  if (upc) {
    const rL = await client.query(
      `select store, store_sku, url, current_price_cents, current_price_observed_at
       from listings
       where norm_upc(upc) = norm_upc($1)`,
      [upc]
    );
    for (const row of rL.rows) {
      offers.push({
        store: row.store.toLowerCase(),
        store_sku: row.store_sku,
        url: row.url,
        title: null,
        price_cents: row.current_price_cents,
        observed_at: row.current_price_observed_at
      });
      seenStores.add(row.store.toLowerCase());
    }
  }

  // Fallback: v_latest_price for any missing or empty price
  // For non Amazon in v_latest_price, the "store_sku" column actually holds UPC in your definition
  const rV = await client.query(
    `select store, asin, store_sku, url, title, price_cents, observed_at
     from v_latest_price
     where
       ($1::text is not null and store = 'amazon' and asin = $1)
       or ($2::text is not null and store <> 'amazon' and norm_upc(store_sku) = norm_upc($2))`,
    [asin, upc]
  );

  // Merge fallback where we do not already have a store or price
  for (const row of rV.rows) {
    const st = row.store.toLowerCase();
    const existing = offers.find(o => o.store === st);
    if (!existing || existing.price_cents == null) {
      const merged = existing || { store: st };
      merged.store_sku = st === 'amazon' ? row.asin : row.store_sku; // note: for non Amazon this is UPC
      merged.url = row.url ?? merged.url ?? null;
      merged.title = row.title ?? merged.title ?? null;
      merged.price_cents = merged.price_cents ?? row.price_cents ?? null;
      merged.observed_at = merged.observed_at ?? row.observed_at ?? null;
      if (!existing) offers.push(merged);
    }
  }

  // Sort by store name for display
  offers.sort((a, b) => a.store.localeCompare(b.store));
  return offers;
}

function pageHtml(identity, offers) {
  const hdr = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>PriceCheck Dashboard</title>
<style>
  body { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Inter, Roboto, Helvetica, Arial; margin: 24px; color: #111; }
  .wrap { max-width: 860px; margin: 0 auto; }
  h1 { margin: 0 0 8px; font-size: 24px; }
  .muted { color: #6b7280; font-size: 14px; margin-bottom: 16px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 10px 8px; border-bottom: 1px solid #eaecef; }
  th { font-weight: 600; font-size: 14px; }
  td a { text-decoration: none; color: #1f6feb; }
  .price { font-variant-numeric: tabular-nums; font-weight: 600; white-space: nowrap; }
</style>
</head>
<body>
<div class="wrap">
<h1>PriceCheck Dashboard</h1>
<div class="muted">
  ${identity.asin ? `ASIN ${identity.asin}` : ''}
  ${identity.asin && identity.upc ? ' • ' : ''}${identity.upc ? `UPC ${identity.upc}` : ''}
</div>
<table>
  <thead><tr><th>Store</th><th>SKU</th><th>Price</th><th>Seen</th><th>Link</th></tr></thead>
  <tbody>
`;
  const rows = offers.map(o => `
<tr>
  <td>${o.store}</td>
  <td>${o.store_sku ?? ''}</td>
  <td class="price">${o.price_cents != null ? money(o.price_cents) : ''}</td>
  <td>${o.observed_at ? new Date(o.observed_at).toLocaleString() : ''}</td>
  <td>${o.url ? `<a href="${o.url}" target="_blank" rel="noopener">Open</a>` : ''}</td>
</tr>`).join('');
  const ftr = `
  </tbody>
</table>
</div>
</body>
</html>`;
  return hdr + rows + ftr;
}

// GET /dashboard/:key
app.get('/dashboard/:key', async (req, res) => {
  const client = await pool.connect();
  try {
    const rawKey = req.params.key;
    const info = await resolveKey(client, rawKey);
    if (!info) {
      res.status(404).send(`<p>No match for "${rawKey}". Try prefixes like asin:..., upc:..., bby:..., walmart:..., tcin:...</p>`);
      return;
    }
    const offers = await getLatestOffers(client, info);
    const html = pageHtml({ asin: info.asin, upc: info.upc }, offers);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (e) {
    console.error(e);
    res.status(500).send('Server error');
  } finally {
    client.release();
  }
});

// Optional JSON API
app.get('/v1/compare/:key', async (req, res) => {
  const client = await pool.connect();
  try {
    const info = await resolveKey(client, req.params.key);
    if (!info) return res.status(404).json({ error: 'not_found' });
    const offers = await getLatestOffers(client, info);
    res.json({ identity: info, offers });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'server_error' });
  } finally {
    client.release();
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Listening on http://localhost:${port}`);
});
