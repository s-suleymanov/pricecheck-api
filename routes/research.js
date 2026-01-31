// routes/research.js
const path = require('path');
const fs = require('fs');
const express = require('express');
const { Pool } = require('pg');

const router = express.Router();

// Postgres connection for live metrics
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Snapshot file
const DATA_DIR = path.join(__dirname, '..', 'data');
const SNAPSHOT_PATH = path.join(DATA_DIR, 'research.json');

// Default snapshot if research.json is missing or broken
const DEFAULT_SNAPSHOT = {
  tape: [
    { symbol: 'HEADPHONES',  change_pct: -9.0 },
    { symbol: 'KEYBOARDS',   change_pct: -12.0 },
    { symbol: 'CONSOLES',    change_pct: 3.0 },
    { symbol: 'SMART HOME',  change_pct: -2.0 },
    { symbol: 'WEARABLES',   change_pct: 1.0 },
    { symbol: 'MONITORS',    change_pct: -5.0 }
  ],
  indices: {
    pc100_change_pct: 1.2,
    electronics_change_pct: 2.0,
    deal_honesty_pct: 88,
    lowest_not_amazon_pct: 39
  },
  gainers: [
    { title: 'Razer BlackWidow V4',      category: 'Keyboards',   store: 'target',  change_pct: -18.0 },
    { title: 'Sony WH-1000XM5',          category: 'Headphones',  store: 'bestbuy', change_pct: -15.0 },
    { title: 'Ring Doorbell 4',          category: 'Smart Home',  store: 'walmart', change_pct: -12.0 },
    { title: 'Logitech MX Master 3S',    category: 'Peripherals', store: 'target',  change_pct: -10.0 },
    { title: 'Apple iPad 10th Gen',      category: 'Tablets',     store: 'amazon',  change_pct: -8.0 }
  ],
  losers: [
    { title: 'PS5 Slim',                 category: 'Consoles',    store: 'walmart', change_pct: 9.0 },
    { title: 'Apple Watch Series 10',    category: 'Wearables',   store: 'bestbuy', change_pct: 6.0 },
    { title: 'GoPro Hero 12',            category: 'Cameras',     store: 'amazon',  change_pct: 5.0 },
    { title: 'Kindle Paperwhite',        category: 'Tablets',     store: 'amazon',  change_pct: 4.0 },
    { title: 'Oculus Quest 3',           category: 'VR',          store: 'target',  change_pct: 3.0 }
  ],
  heatmap: [
    { category: 'Headphones',  change_pct: -9.0 },
    { category: 'Keyboards',   change_pct: -12.0 },
    { category: 'Monitors',    change_pct: -5.0 },
    { category: 'Consoles',    change_pct: 3.0 },
    { category: 'Smart Home',  change_pct: -2.0 },
    { category: 'Cameras',     change_pct: 1.0 },
    { category: 'Laptops',     change_pct: -3.0 },
    { category: 'Storage',     change_pct: -4.0 },
    { category: 'Wearables',   change_pct: 1.0 },
    { category: 'Accessories', change_pct: -2.0 },
    { category: 'Printers',    change_pct: -1.0 },
    { category: 'Routers',     change_pct: -2.0 }
  ],
  share: [
    {
      category: 'Headphones',
      lowest:    { store: 'Best Buy', share_pct: 36 },
      runner_up: { store: 'Amazon',   share_pct: 31 }
    },
    {
      category: 'Keyboards',
      lowest:    { store: 'Amazon',   share_pct: 40 },
      runner_up: { store: 'Target',   share_pct: 27 }
    },
    {
      category: 'Monitors',
      lowest:    { store: 'Walmart',  share_pct: 33 },
      runner_up: { store: 'Best Buy', share_pct: 30 }
    },
    {
      category: 'Smart Home',
      lowest:    { store: 'Walmart',  share_pct: 35 },
      runner_up: { store: 'Amazon',   share_pct: 28 }
    },
    {
      category: 'Wearables',
      lowest:    { store: 'Best Buy', share_pct: 32 },
      runner_up: { store: 'Target',   share_pct: 30 }
    },
    {
      category: 'Storage',
      lowest:    { store: 'Amazon',   share_pct: 42 },
      runner_up: { store: 'Best Buy', share_pct: 29 }
    }
  ]
};

// Load research.json and merge with defaults
function loadSnapshot() {
  try {
    if (fs.existsSync(SNAPSHOT_PATH)) {
      const raw = fs.readFileSync(SNAPSHOT_PATH, 'utf8');
      const parsed = JSON.parse(raw) || {};

      return {
        ...DEFAULT_SNAPSHOT,
        ...parsed,
        tape: parsed.tape || DEFAULT_SNAPSHOT.tape,
        indices: { ...DEFAULT_SNAPSHOT.indices, ...(parsed.indices || {}) },
        gainers: parsed.gainers || DEFAULT_SNAPSHOT.gainers,
        losers: parsed.losers || DEFAULT_SNAPSHOT.losers,
        heatmap: parsed.heatmap || DEFAULT_SNAPSHOT.heatmap,
        share: parsed.share || DEFAULT_SNAPSHOT.share
      };
    }
  } catch (err) {
    console.error('Error loading research snapshot', err);
  }
  return DEFAULT_SNAPSHOT;
}

function safePct(n) {
  if (n == null) return null;
  const num = Number(n);
  if (!isFinite(num)) return null;
  return Math.round(num * 10) / 10;
}

// Serve the Research page HTML
router.get('/research', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'research', 'index.html'));
});

// Tape (categories)
router.get('/api/research/tape', (req, res) => {
  const snap = loadSnapshot();
  res.json({ items: snap.tape || [] });
});

// Indices card
router.get('/api/research/indices', (req, res) => {
  const snap = loadSnapshot();
  res.json(snap.indices || DEFAULT_SNAPSHOT.indices);
});

// Top gainers - try DB, fall back to snapshot
router.get('/api/research/gainers', async (req, res) => {
    const sql = `
    with last7 as (
      select
        coalesce(nullif(upper(btrim(pci)),''), norm_upc(upc)) as prod_key,
        percentile_cont(0.5) within group (order by coalesce(effective_price_cents, price_cents)) as p50_7d
      from public.price_history
      where observed_at >= now() - interval '7 days'
        and coalesce(effective_price_cents, price_cents) is not null
        and coalesce(nullif(upper(btrim(pci)),''), norm_upc(upc)) is not null
      group by 1
    ),
    latest as (
      select distinct on (coalesce(nullif(upper(btrim(ph.pci)),''), norm_upc(ph.upc)))
        coalesce(nullif(upper(btrim(ph.pci)),''), norm_upc(ph.upc)) as prod_key,
        lower(btrim(ph.store)) as store,
        ph.store_sku,
        ph.pci,
        ph.upc,
        coalesce(ph.effective_price_cents, ph.price_cents) as price_cents,
        ph.observed_at
      from public.price_history ph
      where coalesce(ph.effective_price_cents, ph.price_cents) is not null
        and coalesce(nullif(upper(btrim(ph.pci)),''), norm_upc(ph.upc)) is not null
      order by coalesce(nullif(upper(btrim(ph.pci)),''), norm_upc(ph.upc)), ph.observed_at desc
    ),
    meta as (
      select
        l.prod_key,
        coalesce(
          nullif(btrim(cp.model_name),''),
          nullif(btrim(cu.model_name),''),
          nullif(btrim(li.title),''),
          'Unknown'
        ) as title,
        coalesce(
          nullif(btrim(cp.category),''),
          nullif(btrim(cu.category),''),
          'Uncategorized'
        ) as category
      from latest l
      left join public.listings li
        on lower(btrim(li.store)) = l.store
      and norm_sku(li.store_sku) = norm_sku(l.store_sku)
      left join public.catalog cp
        on l.pci is not null
      and btrim(l.pci) <> ''
      and upper(btrim(cp.pci)) = upper(btrim(l.pci))
      left join public.catalog cu
        on l.upc is not null
      and btrim(l.upc) <> ''
      and norm_upc(cu.upc) = norm_upc(l.upc)
    ),
    chg as (
      select
        l.prod_key,
        l.store,
        m.title,
        m.category,
        l.price_cents,
        ((l.price_cents - s.p50_7d)::numeric / nullif(s.p50_7d,0)) as change_ratio
      from latest l
      join last7 s on s.prod_key = l.prod_key
      left join meta m on m.prod_key = l.prod_key
      where s.p50_7d > 0
    ),
    cheapest as (
      select distinct on (prod_key)
        prod_key,
        store as cheapest_store
      from (
        select
          coalesce(nullif(upper(btrim(pci)),''), norm_upc(upc)) as prod_key,
          lower(btrim(store)) as store,
          coalesce(effective_price_cents, price_cents) as p,
          observed_at
        from public.price_history
        where coalesce(effective_price_cents, price_cents) is not null
          and coalesce(nullif(upper(btrim(pci)),''), norm_upc(upc)) is not null
      ) x
      order by prod_key, p asc, observed_at desc
    )
    select
      chg.title as title,
      chg.category as category,
      cheapest.cheapest_store as store,
      chg.change_ratio
    from chg
    join cheapest on cheapest.prod_key = chg.prod_key
    where chg.change_ratio is not null
    order by chg.change_ratio asc
    limit 10;
  `;
  let client;
  try {
    client = await pool.connect();
    const r = await client.query(sql);
    const items = (r.rows || [])
      .map(row => ({
        title: row.title,
        category: row.category,
        store: row.store,
        change_pct: safePct(Number(row.change_ratio) * 100)
      }))
      .filter(x => x.change_pct != null);

    if (!items.length) {
      const snap = loadSnapshot();
      return res.json({ items: snap.gainers || [] });
    }

    res.json({ items });
  } catch (e) {
    console.error('gainers query error', e);
    const snap = loadSnapshot();
    res.json({ items: snap.gainers || [] });
  } finally {
    if (client) client.release();
  }
});

// Top losers - try DB, fall back to snapshot
router.get('/api/research/losers', async (req, res) => {
    const sql = `
    with last7 as (
      select
        coalesce(nullif(upper(btrim(pci)),''), norm_upc(upc)) as prod_key,
        percentile_cont(0.5) within group (order by coalesce(effective_price_cents, price_cents)) as p50_7d
      from public.price_history
      where observed_at >= now() - interval '7 days'
        and coalesce(effective_price_cents, price_cents) is not null
        and coalesce(nullif(upper(btrim(pci)),''), norm_upc(upc)) is not null
      group by 1
    ),
    latest as (
      select distinct on (coalesce(nullif(upper(btrim(ph.pci)),''), norm_upc(ph.upc)))
        coalesce(nullif(upper(btrim(ph.pci)),''), norm_upc(ph.upc)) as prod_key,
        lower(btrim(ph.store)) as store,
        ph.store_sku,
        ph.pci,
        ph.upc,
        coalesce(ph.effective_price_cents, ph.price_cents) as price_cents,
        ph.observed_at
      from public.price_history ph
      where coalesce(ph.effective_price_cents, ph.price_cents) is not null
        and coalesce(nullif(upper(btrim(ph.pci)),''), norm_upc(ph.upc)) is not null
      order by coalesce(nullif(upper(btrim(ph.pci)),''), norm_upc(ph.upc)), ph.observed_at desc
    ),
    meta as (
      select
        l.prod_key,
        coalesce(
          nullif(btrim(cp.model_name),''),
          nullif(btrim(cu.model_name),''),
          nullif(btrim(li.title),''),
          'Unknown'
        ) as title,
        coalesce(
          nullif(btrim(cp.category),''),
          nullif(btrim(cu.category),''),
          'Uncategorized'
        ) as category
      from latest l
      left join public.listings li
        on lower(btrim(li.store)) = l.store
      and norm_sku(li.store_sku) = norm_sku(l.store_sku)
      left join public.catalog cp
        on l.pci is not null
      and btrim(l.pci) <> ''
      and upper(btrim(cp.pci)) = upper(btrim(l.pci))
      left join public.catalog cu
        on l.upc is not null
      and btrim(l.upc) <> ''
      and norm_upc(cu.upc) = norm_upc(l.upc)
    ),
    chg as (
      select
        l.prod_key,
        l.store,
        m.title,
        m.category,
        l.price_cents,
        ((l.price_cents - s.p50_7d)::numeric / nullif(s.p50_7d,0)) as change_ratio
      from latest l
      join last7 s on s.prod_key = l.prod_key
      left join meta m on m.prod_key = l.prod_key
      where s.p50_7d > 0
    ),
    cheapest as (
      select distinct on (prod_key)
        prod_key,
        store as cheapest_store
      from (
        select
          coalesce(nullif(upper(btrim(pci)),''), norm_upc(upc)) as prod_key,
          lower(btrim(store)) as store,
          coalesce(effective_price_cents, price_cents) as p,
          observed_at
        from public.price_history
        where coalesce(effective_price_cents, price_cents) is not null
          and coalesce(nullif(upper(btrim(pci)),''), norm_upc(upc)) is not null
      ) x
      order by prod_key, p asc, observed_at desc
    )
    select
      chg.title as title,
      chg.category as category,
      cheapest.cheapest_store as store,
      chg.change_ratio
    from chg
    join cheapest on cheapest.prod_key = chg.prod_key
    where chg.change_ratio is not null
    order by chg.change_ratio desc
    limit 10;
  `;
  let client;
  try {
    client = await pool.connect();
    const r = await client.query(sql);
    const items = (r.rows || [])
      .map(row => ({
        title: row.title,
        category: row.category,
        store: row.store,
        change_pct: safePct(Number(row.change_ratio) * 100)
      }))
      .filter(x => x.change_pct != null);

    if (!items.length) {
      const snap = loadSnapshot();
      return res.json({ items: snap.losers || [] });
    }

    res.json({ items });
  } catch (e) {
    console.error('losers query error', e);
    const snap = loadSnapshot();
    res.json({ items: snap.losers || [] });
  } finally {
    if (client) client.release();
  }
});

// Category heatmap - try DB, fall back to snapshot
router.get('/api/research/heatmap', async (req, res) => {
  const sql = `
    with a as (
      select norm_upc(upc) as upc_norm,
            coalesce(nullif(category,''),'Uncategorized') as category
      from catalog
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

  let client;
  try {
    client = await pool.connect();
    const r = await client.query(sql);
    const items = (r.rows || [])
      .map(row => ({
        category: row.category,
        change_pct: safePct(Number(row.med_ratio) * 100)
      }))
      .filter(x => x.change_pct != null);

    if (!items.length) {
      const snap = loadSnapshot();
      return res.json({ items: snap.heatmap || [] });
    }

    res.json({ items });
  } catch (e) {
    console.error('heatmap query error', e);
    const snap = loadSnapshot();
    res.json({ items: snap.heatmap || [] });
  } finally {
    if (client) client.release();
  }
});

// Cheapest share leaderboard - snapshot only for now
router.get('/api/research/share', (req, res) => {
  const snap = loadSnapshot();
  res.json({ items: snap.share || [] });
});

module.exports = router;
