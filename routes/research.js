// routes/research.js
const fs = require('fs');
const path = require('path');
const express = require('express');
const { Pool } = require('pg');

const router = express.Router();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const DATA_DIR = path.join(__dirname, '..', 'data');
const TAPE_JSON = path.join(DATA_DIR, 'tape.json');

// ---------- helpers ----------
function readTape() {
  try {
    if (fs.existsSync(TAPE_JSON)) {
      const j = JSON.parse(fs.readFileSync(TAPE_JSON, 'utf8'));
      if (Array.isArray(j.items)) return j.items;
    }
  } catch (_) {}
  return [
    { symbol: 'HEADPHONES', change_pct: -1.9 },
    { symbol: 'KEYBOARDS',  change_pct: -3.2 },
    { symbol: 'CONSOLES',   change_pct:  0.6 },
    { symbol: 'SMART HOME', change_pct: -0.4 },
    { symbol: 'WEARABLES',  change_pct:  1.1 },
    { symbol: 'MONITORS',   change_pct: -2.5 }
  ];
}

function safePct(n) {
  if (n == null || !isFinite(n)) return null;
  return Math.round(n * 10) / 10; // one decimal
}

// ---------- routes ----------

// Tape (categories only)
router.get('/api/research/tape', (_req, res) => {
  res.json({ items: readTape() });
});

// Top gainers (price down) and losers (price up) using last 7d vs 7d median
// NOTE: This uses price_history only. Good for Research.
router.get('/api/research/gainers', async (_req, res) => {
  const sql = `
  with last7 as (
    select item_key,
           percentile_cont(0.5) within group (order by price_cents) as p50_7d
    from price_history
    where observed_at >= now() - interval '7 days'
      and item_key is not null
    group by item_key
  ),
  latest as (
    select distinct on (item_key)
           item_key, store, title, upc, asin, price_cents, observed_at
    from price_history
    where item_key is not null
    order by item_key, observed_at desc
  ),
  joined as (
    select l.item_key, l.store, l.title, l.upc, l.asin,
           l.price_cents, l.observed_at, s.p50_7d
    from latest l
    join last7 s on s.item_key = l.item_key
    where s.p50_7d > 0
  ),
  chg as (
    select item_key, store, title, upc, asin, price_cents,
           ((price_cents - p50_7d)::numeric / p50_7d) as change_ratio
    from joined
  )
  select
    coalesce(nullif(title,''),'Unknown') as title,
    coalesce(
      (select category from asins a where a.upc is not null and norm_upc(a.upc)=norm_upc(chg.upc) limit 1),
      'Uncategorized'
    ) as category,
    lower(btrim(store)) as store,
    change_ratio
  from chg
  where change_ratio is not null
  order by change_ratio asc  -- most negative first
  limit 10;
  `;
  const client = await pool.connect();
  try {
    const r = await client.query(sql);
    res.json({
      items: r.rows.map(x => ({
        title: x.title,
        category: x.category,
        store: x.store,
        change_pct: safePct(Number(x.change_ratio) * 100)
      }))
    });
  } catch (e) {
    console.error(e);
    res.json({ items: [] });
  } finally { client.release(); }
});

router.get('/api/research/losers', async (_req, res) => {
  const sql = `
  with last7 as (
    select item_key,
           percentile_cont(0.5) within group (order by price_cents) as p50_7d
    from price_history
    where observed_at >= now() - interval '7 days'
      and item_key is not null
    group by item_key
  ),
  latest as (
    select distinct on (item_key)
           item_key, store, title, upc, asin, price_cents, observed_at
    from price_history
    where item_key is not null
    order by item_key, observed_at desc
  ),
  joined as (
    select l.item_key, l.store, l.title, l.upc, l.asin,
           l.price_cents, l.observed_at, s.p50_7d
    from latest l
    join last7 s on s.item_key = l.item_key
    where s.p50_7d > 0
  ),
  chg as (
    select item_key, store, title, upc, asin, price_cents,
           ((price_cents - p50_7d)::numeric / p50_7d) as change_ratio
    from joined
  )
  select
    coalesce(nullif(title,''),'Unknown') as title,
    coalesce(
      (select category from asins a where a.upc is not null and norm_upc(a.upc)=norm_upc(chg.upc) limit 1),
      'Uncategorized'
    ) as category,
    lower(btrim(store)) as store,
    change_ratio
  from chg
  where change_ratio is not null
  order by change_ratio desc  -- most positive first
  limit 10;
  `;
  const client = await pool.connect();
  try {
    const r = await client.query(sql);
    res.json({
      items: r.rows.map(x => ({
        title: x.title,
        category: x.category,
        store: x.store,
        change_pct: safePct(Number(x.change_ratio) * 100)
      }))
    });
  } catch (e) {
    console.error(e);
    res.json({ items: [] });
  } finally { client.release(); }
});

// Category heatmap: weekly change per category (last 7d median vs prev 7d median)
router.get('/api/research/heatmap', async (_req, res) => {
  const sql = `
  with a as (
    select asin, norm_upc(upc) as upc_norm, coalesce(nullif(category,''),'Uncategorized') as category
    from asins
  ),
  last7 as (
    select ph.item_key,
           percentile_cont(0.5) within group (order by ph.price_cents) as p50_7d,
           max(ph.upc) as upc
    from price_history ph
    where ph.observed_at >= now() - interval '7 days'
      and ph.item_key is not null
    group by ph.item_key
  ),
  prev7 as (
    select ph.item_key,
           percentile_cont(0.5) within group (order by ph.price_cents) as p50_prev7
    from price_history ph
    where ph.observed_at >= now() - interval '14 days'
      and ph.observed_at <  now() - interval '7 days'
      and ph.item_key is not null
    group by ph.item_key
  ),
  joined as (
    select l.item_key, l.p50_7d, p.p50_prev7, l.upc
    from last7 l
    join prev7 p on p.item_key = l.item_key
    where l.p50_7d > 0 and p.p50_prev7 > 0
  ),
  with_cat as (
    select
      coalesce(a.category, 'Uncategorized') as category,
      ((l.p50_7d - p50_prev7)::numeric / p50_prev7) as ratio
    from joined l
    left join a on a.upc_norm = norm_upc(l.upc)
  )
  select category,
         percentile_cont(0.5) within group (order by ratio) as med_ratio
  from with_cat
  group by category
  order by category;
  `;
  const client = await pool.connect();
  try {
    const r = await client.query(sql);
    res.json({
      items: r.rows.map(x => ({
        category: x.category,
        change_pct: safePct(Number(x.med_ratio) * 100)
      }))
    });
  } catch (e) {
    console.error(e);
    res.json({ items: [] });
  } finally { client.release(); }
});

// Cheapest share leaderboard by category (who is strictly lowest now)
// Uses v_latest_price + asins to map UPCs to categories.
router.get('/api/research/share', async (_req, res) => {
  const sql = `
  with amazon_upc as (
    select upper(btrim(asin)) as asin_key, norm_upc(upc) as upc_norm
    from asins
    where upc is not null
  ),
  latest as (
    select
      case
        when lower(store) = 'amazon' then au.upc_norm
        else norm_upc(store_sku)
      end as upc_norm,
      lower(store) as store,
      price_cents
    from v_latest_price v
    left join amazon_upc au on lower(v.store) = 'amazon' and upper(btrim(v.asin)) = au.asin_key
    where
      (
        lower(store) = 'amazon' and au.upc_norm is not null
      ) or (
        lower(store) <> 'amazon' and store_sku is not null and btrim(store_sku) <> ''
      )
  ),
  per_item_min as (
    select upc_norm, min(price_cents) as minp
    from latest
    group by upc_norm
  ),
  winners as (
    select l.upc_norm, l.store
    from latest l
    join per_item_min m on m.upc_norm = l.upc_norm and m.minp = l.price_cents
  ),
  cat_map as (
    select norm_upc(upc) as upc_norm,
           coalesce(nullif(category,''),'Uncategorized') as category
    from asins where upc is not null
  ),
  tallies as (
    select c.category, w.store, count(*) as wins
    from winners w
    join cat_map c on c.upc_norm = w.upc_norm
    group by c.category, w.store
  ),
  totals as (
    select category, sum(wins) as total from tallies group by category
  )
  select t.category, t.store, t.wins, tot.total
  from tallies t
  join totals tot on tot.category = t.category
  order by t.category, t.wins desc, t.store;
  `;
  const client = await pool.connect();
  try {
    const r = await client.query(sql);

    // shape into {category, lowest: {store, share}, runner_up: {store, share}}
    const byCat = new Map();
    for (const row of r.rows) {
      const cat = row.category;
      const arr = byCat.get(cat) || [];
      arr.push({
        store: row.store,
        wins: Number(row.wins),
        total: Number(row.total),
        share_pct: Math.round((Number(row.wins) / Number(row.total)) * 100)
      });
      byCat.set(cat, arr);
    }
    const items = [];
    for (const [category, arr] of byCat.entries()) {
      arr.sort((a,b)=> b.wins - a.wins);
      const lowest = arr[0] || null;
      const runner = arr[1] || null;
      items.push({
        category,
        lowest: lowest ? { store: prettyStore(lowest.store), share_pct: lowest.share_pct } : null,
        runner_up: runner ? { store: prettyStore(runner.store), share_pct: runner.share_pct } : null
      });
    }
    items.sort((a,b)=> a.category.localeCompare(b.category));
    res.json({ items });
  } catch (e) {
    console.error(e);
    res.json({ items: [] });
  } finally { client.release(); }

  function prettyStore(s) {
    s = String(s||'').toLowerCase();
    if (s === 'bestbuy') return 'Best Buy';
    if (s === 'walmart') return 'Walmart';
    if (s === 'target')  return 'Target';
    if (s === 'amazon')  return 'Amazon';
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
});

module.exports = router;
