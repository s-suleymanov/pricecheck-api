const path = require("path");
const express = require("express");
const pool = require("../db");
const rankingRules = require("../public/data/ranking_rules.json");

const router = express.Router();

function safeNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function round1(value) {
  const n = safeNumber(value);
  return n == null ? null : Math.round(n * 10) / 10;
}

function boolVal(v) {
  if (typeof v === "boolean") return v;
  const s = String(v ?? "").trim().toLowerCase();
  return ["true", "yes", "1"].includes(s);
}

function numVal(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function clampScore(n) {
  return Math.max(0, Math.min(100, Math.round(Number(n) || 0)));
}

function waterScore(v) {
  const s = String(v || "").toUpperCase();
  if (s.includes("IPX7") || s.includes("IP57") || s.includes("IP67")) return 100;
  if (s.includes("IPX5") || s.includes("IP55")) return 75;
  if (s.includes("IPX4") || s.includes("IP54")) return 55;
  return 20;
}

function codecScore(v) {
  const s = Array.isArray(v)
    ? v.join(" ").toLowerCase()
    : String(v || "").toLowerCase();

  let score = 0;

  if (s.includes("sbc")) score += 5;
  if (s.includes("aac")) score += 12;
  if (s.includes("lc3")) score += 12;
  if (s.includes("aptx adaptive")) score += 25;
  else if (s.includes("aptx hd")) score += 22;
  else if (s.includes("aptx")) score += 18;
  if (s.includes("ldac")) score += 25;

  return Math.min(30, score);
}

function earbudDriverScore(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return 0;
  if (n < 6) return 45;
  if (n < 8) return 65;
  if (n < 10) return 80;
  if (n <= 12) return 90;
  return 85;
}

function scoreField(rule, value) {
  const type = String(rule.type || "").trim();
  const weight = Number(rule.weight || 0);

  if (type === "boolean") return boolVal(value) ? weight : 0;

  if (type === "number") {
    const raw = Math.min(Number(rule.cap || 100), numVal(value) * Number(rule.multiplier || 1));
    return raw * weight;
  }

  if (type === "water_rating") return waterScore(value) * weight;
  if (type === "codec") return codecScore(value) * weight;
  if (type === "earbud_driver") return earbudDriverScore(value) * weight;

  return 0;
}

function genericScore(specs) {
  let score = 0;
  let count = 0;

  for (const value of Object.values(specs || {})) {
    if (typeof value === "boolean") {
      score += value ? 12 : 0;
      count += 1;
    } else if (Number.isFinite(Number(value))) {
      score += Math.min(100, Number(value)) * 0.12;
      count += 1;
    }
  }

  if (!count) return 0;
  return clampScore(score);
}

function scoreProduct(specsNorm) {
  const specs = specsNorm && typeof specsNorm === "object" ? specsNorm : {};
  const rules = rankingRules.earbuds;

  if (!rules || !Array.isArray(rules.fields)) {
    return genericScore(specs);
  }

  let score = 0;

  for (const rule of rules.fields) {
    score += scoreField(rule, specs[rule.key]);
  }

  return clampScore(score);
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90) || "earbuds";
}

function productHref(row) {
  const titleSlug = slugify(`${row.brand || ""} ${row.title || ""}`);
  return `/dashboard/${titleSlug}/pci/${encodeURIComponent(row.pci_norm)}/`;
}

function familyKey(item) {
  const brand = String(item.brand || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");

  const title = String(item.title || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");

  return `${brand}|${title}`;
}

function chooseFamilyWinner(current, next) {
  if (!current) return next;
  if (!next) return current;

  const currentPrice = Number.isFinite(current.current_price_cents) ? current.current_price_cents : Infinity;
  const nextPrice = Number.isFinite(next.current_price_cents) ? next.current_price_cents : Infinity;

  if (nextPrice < currentPrice) return next;
  if (nextPrice > currentPrice) return current;

  const currentHistory = Number(current.obs30 || 0);
  const nextHistory = Number(next.obs30 || 0);

  if (nextHistory > currentHistory) return next;
  if (nextHistory < currentHistory) return current;

  const currentScore = Number(current.value_score || 0);
  const nextScore = Number(next.value_score || 0);

  if (nextScore > currentScore) return next;
  if (nextScore < currentScore) return current;

  return current;
}

const MARKET_SQL = `
  with catalog_pci as (
    select distinct on (upper(btrim(c.pci)))
      upper(btrim(c.pci)) as pci_norm,
      coalesce(nullif(btrim(c.model_name), ''), 'Unknown Earbuds') as title,
      coalesce(nullif(btrim(c.brand), ''), 'Unknown') as brand,
      nullif(btrim(c.image_url), '') as image_url,
      c.specs_norm
    from public.catalog c
    where c.category is not null
      and lower(btrim(c.category)) = 'earbuds'
      and lower(btrim(coalesce(c.brand, ''))) not in ('skran', 'skrqan')
      and coalesce(c.is_refurbished, false) = false
      and coalesce(c.is_bundle, false) = false
      and nullif(upper(btrim(c.pci)), '') is not null
    order by upper(btrim(c.pci)), c.id asc
  ),
  listing_current as (
    select
      upper(btrim(l.pci)) as pci_norm,
      lower(btrim(l.store)) as store,
      l.store_sku,
      nullif(btrim(l.url), '') as url,
      coalesce(l.effective_price_cents, l.current_price_cents) as price_cents,
      coalesce(l.current_price_observed_at, l.created_at) as observed_at
    from public.listings l
    join catalog_pci c
      on c.pci_norm = upper(btrim(l.pci))
    where nullif(upper(btrim(l.pci)), '') is not null
      and coalesce(l.effective_price_cents, l.current_price_cents) is not null
      and coalesce(nullif(lower(btrim(l.status)), ''), 'active') not in ('inactive', 'out_of_stock', 'discontinued', 'hidden')
      and nullif(lower(btrim(l.store)), '') is not null
      and lower(btrim(l.store)) <> 'unknown'
  ),
  current_best as (
    select distinct on (pci_norm)
      pci_norm,
      store as best_store,
      store_sku as best_store_sku,
      url as best_url,
      price_cents as current_price_cents,
      observed_at as current_observed_at
    from listing_current
    order by pci_norm, price_cents asc, observed_at desc nulls last
  ),
  current_rollup as (
    select
      pci_norm,
      count(*)::int as offer_count,
      count(distinct store)::int as store_count
    from listing_current
    group by pci_norm
  ),
  hist as (
    select
      upper(btrim(ph.pci)) as pci_norm,
      date_trunc('day', ph.observed_at)::date as day,
      ph.observed_at,
      coalesce(ph.effective_price_cents, ph.price_cents) as price_cents
    from public.price_history ph
    join catalog_pci c
      on c.pci_norm = upper(btrim(ph.pci))
    where nullif(upper(btrim(ph.pci)), '') is not null
      and ph.observed_at >= now() - interval '30 days'
      and coalesce(ph.effective_price_cents, ph.price_cents) is not null
  ),
  hist_rollup as (
    select
      pci_norm,
      percentile_cont(0.5) within group (order by price_cents) as median_30d_price_cents,
      count(*)::int as obs30,
      max(observed_at) as last_history_at
    from hist
    group by pci_norm
  )
  select
    c.pci_norm,
    c.title,
    c.brand,
    c.image_url,
    c.specs_norm,
    cb.best_store,
    cb.best_store_sku,
    cb.best_url,
    cb.current_price_cents,
    cb.current_observed_at,
    coalesce(cr.offer_count, 0)::int as offer_count,
    coalesce(cr.store_count, 0)::int as store_count,
    coalesce(hr.obs30, 0)::int as obs30,
    hr.last_history_at,
    hr.median_30d_price_cents,
    round((((cb.current_price_cents::numeric - hr.median_30d_price_cents::numeric) / nullif(hr.median_30d_price_cents::numeric, 0)) * 100)::numeric, 1) as change30_pct
  from catalog_pci c
  join current_best cb on cb.pci_norm = c.pci_norm
  left join current_rollup cr on cr.pci_norm = c.pci_norm
  left join hist_rollup hr on hr.pci_norm = c.pci_norm
`;

const INDEX_SERIES_SQL = `
  with scopes(scope, label, sort_order) as (
    values
      ('all', 'All', 1),
      ('technology', 'Technology', 2),
      ('earbuds', 'Earbuds', 3),
      ('headphones', 'Headphones', 4)
  ),
  catalog_base as (
    select distinct
      upper(btrim(c.pci)) as pci_norm,
      lower(btrim(c.category)) as category_norm
    from public.catalog c
    where c.category is not null
      and btrim(c.category) <> ''
      and lower(btrim(coalesce(c.brand, ''))) not in ('skran', 'skrqan')
      and coalesce(c.is_refurbished, false) = false
      and coalesce(c.is_bundle, false) = false
      and nullif(upper(btrim(c.pci)), '') is not null
  ),
  scope_catalog as (
    select 'all' as scope, pci_norm
    from catalog_base

    union all

    select 'technology' as scope, pci_norm
    from catalog_base
    where category_norm in ('earbuds', 'headphones', 'speakers', 'tv', 'tvs', 'smart tv', 'smart tvs')

    union all

    select 'earbuds' as scope, pci_norm
    from catalog_base
    where category_norm = 'earbuds'

    union all

    select 'headphones' as scope, pci_norm
    from catalog_base
    where category_norm = 'headphones'
  ),
  listing_current as (
    select distinct
      upper(btrim(l.pci)) as pci_norm
    from public.listings l
    where nullif(upper(btrim(l.pci)), '') is not null
      and coalesce(l.effective_price_cents, l.current_price_cents) is not null
      and coalesce(nullif(lower(btrim(l.status)), ''), 'active') not in ('inactive', 'out_of_stock', 'discontinued', 'hidden')
      and nullif(lower(btrim(l.store)), '') is not null
      and lower(btrim(l.store)) <> 'unknown'
  ),
  current_scope as (
    select
      sc.scope,
      count(distinct sc.pci_norm)::int as product_count
    from scope_catalog sc
    join listing_current lc
      on lc.pci_norm = sc.pci_norm
    group by sc.scope
  ),
  daily_product as (
    select
      sc.scope,
      date_trunc('day', ph.observed_at)::date as day,
      sc.pci_norm,
      percentile_cont(0.5) within group (
        order by coalesce(ph.effective_price_cents, ph.price_cents)
      ) as daily_price_cents
    from scope_catalog sc
    join public.price_history ph
      on upper(btrim(ph.pci)) = sc.pci_norm
    where ph.observed_at >= now() - interval '30 days'
      and coalesce(ph.effective_price_cents, ph.price_cents) is not null
      and nullif(upper(btrim(ph.pci)), '') is not null
    group by sc.scope, day, sc.pci_norm
  ),
  daily_scope as (
    select
      scope,
      day,
      round(percentile_cont(0.5) within group (order by daily_price_cents)::numeric, 0)::int as value_cents
    from daily_product
    group by scope, day
  )
  select
    s.scope,
    s.label,
    s.sort_order,
    coalesce(cs.product_count, 0)::int as product_count,
    ds.day,
    ds.value_cents
  from scopes s
  left join current_scope cs
    on cs.scope = s.scope
  left join daily_scope ds
    on ds.scope = s.scope
  order by s.sort_order asc, ds.day asc nulls last;
`;

router.get("/trending", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "trending", "index.html"));
});

router.get("/api/trending/earbuds", async (req, res) => {
  let client;

  try {
    client = await pool.connect();

    const [marketResult, seriesResult] = await Promise.all([
      client.query(MARKET_SQL),
      client.query(INDEX_SERIES_SQL)
    ]);

    const rows = marketResult.rows || [];

    const rawItems = rows
    .map(row => {
        const featureScore = scoreProduct(row.specs_norm || {});
        const price = Number(row.current_price_cents) / 100;
        const valueScore = price > 0 ? featureScore / Math.sqrt(price) : 0;

        return {
        pci_norm: row.pci_norm,
        title: row.title,
        brand: row.brand,
        image_url: row.image_url,
        best_store: row.best_store,
        best_store_sku: row.best_store_sku,
        best_url: row.best_url,
        current_price_cents: safeNumber(row.current_price_cents),
        current_observed_at: row.current_observed_at,
        offer_count: Number(row.offer_count || 0),
        store_count: Number(row.store_count || 0),
        obs30: Number(row.obs30 || 0),
        median_30d_price_cents: safeNumber(row.median_30d_price_cents),
        change30_pct: round1(row.change30_pct),
        feature_score: featureScore,
        value_score: round1(valueScore),
        href: productHref(row)
        };
    })
    .filter(item => item.current_price_cents != null);

    const familyMap = new Map();

    for (const item of rawItems) {
    const key = familyKey(item);
    const winner = chooseFamilyWinner(familyMap.get(key), item);
    familyMap.set(key, winner);
    }

    const ranked = Array.from(familyMap.values())
    .sort((a, b) => b.value_score - a.value_score)
    .slice(0, 100)
    .map((item, index) => ({
        ...item,
        rank: index + 1
    }));

    const withHistory = ranked.filter(item => item.obs30 >= 2 && item.change30_pct != null);

    const drops = withHistory
      .filter(item => item.change30_pct < 0)
      .sort((a, b) => a.change30_pct - b.change30_pct)
      .slice(0, 12);

    const companies = Array.from(
      ranked.reduce((map, item) => {
        const brand = item.brand || "Unknown";

        if (!map.has(brand)) {
          map.set(brand, {
            brand,
            count: 0,
            prices: [],
            changes: []
          });
        }

        const bucket = map.get(brand);
        bucket.count += 1;

        if (item.current_price_cents != null) bucket.prices.push(item.current_price_cents);
        if (item.change30_pct != null) bucket.changes.push(item.change30_pct);

        return map;
      }, new Map()).values()
    )
      .map(company => {
        const avgPrice = company.prices.length
          ? Math.round(company.prices.reduce((sum, n) => sum + n, 0) / company.prices.length)
          : null;

        const avgChange = company.changes.length
          ? round1(company.changes.reduce((sum, n) => sum + n, 0) / company.changes.length)
          : null;

        return {
          brand: company.brand,
          count: company.count,
          avg_price_cents: avgPrice,
          avg_change30_pct: avgChange
        };
      })
      .sort((a, b) => b.count - a.count)
      .slice(0, 12);

      const indexMap = new Map();

for (const row of seriesResult.rows || []) {
  const key = row.scope;

  if (!indexMap.has(key)) {
    indexMap.set(key, {
      scope: row.scope,
      label: row.label,
      sort_order: Number(row.sort_order || 0),
      count: Number(row.product_count || 0),
      active: row.scope === "earbuds",
      series: []
    });
  }

  if (row.day && row.value_cents != null) {
    indexMap.get(key).series.push({
      date: row.day,
      value_cents: safeNumber(row.value_cents)
    });
  }
}

const indices = Array.from(indexMap.values())
  .sort((a, b) => a.sort_order - b.sort_order)
  .map(item => {
    const start = item.series[0]?.value_cents;
    const end = item.series[item.series.length - 1]?.value_cents;

    return {
      label: item.label,
      count: item.count,
      change30_pct: start && end ? round1(((end - start) / start) * 100) : null,
      active: item.active,
      series: item.series
    };
  });

res.json({
  indices,
  ranked,
  companies
});
  } catch (error) {
    console.error("Trending earbuds query error", error);
    res.status(500).json({
      error: "trending_unavailable"
    });
  } finally {
    if (client) client.release();
  }
});

module.exports = router;