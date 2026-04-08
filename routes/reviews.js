'use strict';

const express = require('express');
const router = express.Router();
const db = require('../db');

const SOURCE_META = {
  amz: { name: 'Amazon' },
  amazon: { name: 'Amazon' },
  bby: { name: 'Best Buy' },
  bestbuy: { name: 'Best Buy' },
  wal: { name: 'Walmart' },
  walmart: { name: 'Walmart' },
  tgt: { name: 'Target' },
  target: { name: 'Target' },
  tcin: { name: 'Target' },
  ngg: { name: 'Newegg' },
  newegg: { name: 'Newegg' },
  cst: { name: 'Costco' },
  costco: { name: 'Costco' },
  google: { name: 'Google' },
  rtings: { name: 'RTINGS' },
  pcmag: { name: 'PCMag' },
  wired: { name: 'Wired' },
  verge: { name: 'The Verge' },
  wirecutter: { name: 'Wirecutter' },
  tomsguide: { name: "Tom's Guide" },
  techradar: { name: 'TechRadar' },
  cnet: { name: 'CNET' },
  engadget: { name: 'Engadget' }
};

function clean(v) {
  return String(v || '').trim();
}

function round1(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 10) / 10;
}

function sourceName(slug) {
  const key = clean(slug).toLowerCase();
  if (SOURCE_META[key]?.name) return SOURCE_META[key].name;
  return clean(slug) || 'Source';
}

function normalizeScoreToFive(score, scoreScale) {
  const s = Number(score);
  const scale = Number(scoreScale || 5);

  if (!Number.isFinite(s) || !Number.isFinite(scale) || scale <= 0) {
    return null;
  }

  return round1((s / scale) * 5);
}

function estimateDistribution(overall, total) {
  const rating = Math.max(1, Math.min(5, Number(overall || 0)));
  const count = Math.max(0, Number(total || 0));

  if (!count) {
    return { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
  }

  const fraction = (rating - 1) / 4;
  const poor = [0.05, 0.10, 0.15, 0.25, 0.45];
  const excellent = [0.60, 0.25, 0.08, 0.04, 0.03];

  const weights = poor.map((p, i) => p + fraction * (excellent[i] - p));
  const sum = weights.reduce((a, b) => a + b, 0);

  const counts = weights.map((w) => Math.round((w / sum) * count));
  const assigned = counts.reduce((a, b) => a + b, 0);
  counts[0] += count - assigned;

  return {
    5: Math.max(0, counts[0]),
    4: Math.max(0, counts[1]),
    3: Math.max(0, counts[2]),
    2: Math.max(0, counts[3]),
    1: Math.max(0, counts[4])
  };
}

async function lookupPciByUpc(upc) {
  const value = clean(upc);
  if (!value) return null;

  const result = await db.query(
    `
      SELECT pci
      FROM (
        SELECT NULLIF(btrim(c.pci), '') AS pci
        FROM public.catalog c
        WHERE norm_upc(c.upc) = norm_upc($1)

        UNION ALL

        SELECT NULLIF(btrim(l.pci), '') AS pci
        FROM public.listings l
        WHERE norm_upc(l.upc) = norm_upc($1)
      ) x
      WHERE pci IS NOT NULL
      LIMIT 1
    `,
    [value]
  );

  return result.rows[0]?.pci || null;
}

async function lookupPciByStoreSku(store, sku) {
  const storeValue = clean(store).toLowerCase();
  const skuValue = clean(sku);
  if (!storeValue || !skuValue) return null;

  const direct = await db.query(
    `
      SELECT NULLIF(btrim(l.pci), '') AS pci
      FROM public.listings l
      WHERE lower(btrim(l.store)) = $1
        AND norm_sku(l.store_sku) = norm_sku($2)
        AND NULLIF(btrim(l.pci), '') IS NOT NULL
      LIMIT 1
    `,
    [storeValue, skuValue]
  );

  if (direct.rows[0]?.pci) {
    return direct.rows[0].pci;
  }

  const viaCatalog = await db.query(
    `
      SELECT NULLIF(btrim(c.pci), '') AS pci
      FROM public.listings l
      JOIN public.catalog c
        ON norm_upc(c.upc) = norm_upc(l.upc)
      WHERE lower(btrim(l.store)) = $1
        AND norm_sku(l.store_sku) = norm_sku($2)
        AND NULLIF(btrim(c.pci), '') IS NOT NULL
      LIMIT 1
    `,
    [storeValue, skuValue]
  );

  return viaCatalog.rows[0]?.pci || null;
}

async function normalizeToPci(raw) {
  const input = clean(raw);
  if (!input) throw new Error('Invalid key');

  let kind = 'pci';
  let value = input;

  const m = input.match(/^([a-z]+)\s*:\s*(.+)$/i);
  if (m) {
    kind = clean(m[1]).toLowerCase();
    value = clean(m[2]);
  } else if (/^\d{12,14}$/.test(input)) {
    kind = 'upc';
  } else if (/^[A-Z0-9]{10}$/i.test(input)) {
    kind = 'asin';
  } else if (/^[A-Z][A-Z0-9]{7}$/i.test(input)) {
    kind = 'pci';
  }

  if (kind === 'bestbuy' || kind === 'sku') kind = 'bby';
  if (kind === 'walmart') kind = 'wal';
  if (kind === 'target') kind = 'tcin';

  if (!value) throw new Error('Empty key value');

  if (kind === 'pci') {
    return value.toUpperCase();
  }

  if (kind === 'upc') {
    return await lookupPciByUpc(value);
  }

  if (kind === 'asin') {
    return await lookupPciByStoreSku('amazon', value.toUpperCase());
  }

  if (kind === 'bby') {
    return await lookupPciByStoreSku('best buy', value);
  }

  if (kind === 'wal') {
    return await lookupPciByStoreSku('walmart', value);
  }

  if (kind === 'tcin') {
    return await lookupPciByStoreSku('target', value);
  }

  throw new Error(`Unsupported key prefix: ${kind}`);
}

async function getCatalogIdentityByPci(pci) {
  const value = clean(pci);
  if (!value) return null;

  const result = await db.query(
    `
      SELECT
        brand,
        model_number,
        version,
        variant
      FROM public.catalog
      WHERE NULLIF(btrim(pci), '') IS NOT NULL
        AND upper(btrim(pci)) = upper(btrim($1))
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [value]
  );

  return result.rows[0] || null;
}

async function getColorGroupPcis(pci) {
  const value = clean(pci);
  if (!value) return [];

  const identity = await getCatalogIdentityByPci(value);

  if (!identity?.brand || !identity?.model_number) {
    return [value.toUpperCase()];
  }

  const result = await db.query(
    `
      SELECT DISTINCT upper(btrim(pci)) AS pci
      FROM public.catalog
      WHERE NULLIF(btrim(pci), '') IS NOT NULL
        AND brand IS NOT NULL
        AND btrim(brand) <> ''
        AND lower(btrim(brand)) = lower(btrim($1))
        AND model_number IS NOT NULL
        AND btrim(model_number) <> ''
        AND upper(btrim(model_number)) = upper(btrim($2))
        AND COALESCE(NULLIF(btrim(version), ''), '') = COALESCE(NULLIF(btrim($3), ''), '')
        AND COALESCE(NULLIF(btrim(variant), ''), '') = COALESCE(NULLIF(btrim($4), ''), '')
      ORDER BY upper(btrim(pci))
    `,
    [
      clean(identity.brand),
      clean(identity.model_number),
      clean(identity.version),
      clean(identity.variant)
    ]
  );

  const pcis = result.rows.map(r => clean(r.pci).toUpperCase()).filter(Boolean);
  return pcis.length ? pcis : [value.toUpperCase()];
}

router.get('/:key', async (req, res) => {
  let pci;

  try {
    pci = await normalizeToPci(req.params.key);
  } catch (_err) {
    return res.status(400).json({ error: 'Invalid or unrecognized product key.' });
  }

  if (!pci) {
    return res.status(404).json({ error: 'Product not found.' });
  }

  const groupPcis = await getColorGroupPcis(pci);

  try {
    const [
      sourceStatsResult,
      distResult,
      expertReviewsResult
    ] = await Promise.all([
      db.query(
        `
          SELECT
            lower(btrim(source_slug)) AS source_slug,
            rating,
            review_count,
            source_url
          FROM public.review_source_stats
          WHERE coalesce(array_length($1::text[], 1), 0) > 0
  AND upper(btrim(product_pci)) = ANY($1::text[])
            AND review_count > 0
          ORDER BY review_count DESC, rating DESC
        `,
        [groupPcis]
      ),

      db.query(
        `
          SELECT star, count
          FROM public.review_distribution
          WHERE coalesce(array_length($1::text[], 1), 0) > 0
  AND upper(btrim(product_pci)) = ANY($1::text[])
          ORDER BY star DESC
        `,
        [groupPcis]
      ),

      db.query(
        `
          SELECT
            lower(btrim(source_slug)) AS source_slug,
            article_title,
            score,
            score_scale,
            verdict,
            pros,
            cons,
            article_url,
            reviewed_at
          FROM public.expert_reviews
          WHERE coalesce(array_length($1::text[], 1), 0) > 0
  AND upper(btrim(product_pci)) = ANY($1::text[])
          ORDER BY reviewed_at DESC NULLS LAST, updated_at DESC, id DESC
        `,
        [groupPcis]
      )
    ]);

    const customerSources = sourceStatsResult.rows.map((row) => {
      const slug = clean(row.source_slug).toLowerCase();
      const rating = round1(row.rating);
      const count = Number(row.review_count || 0);

      return {
        slug,
        name: sourceName(slug),
        rating,
        count,
        url: clean(row.source_url) || null
      };
    });

    const weightedTotal = customerSources.reduce((sum, s) => sum + Number(s.count || 0), 0);
    const weightedSum = customerSources.reduce((sum, s) => {
      return sum + (Number(s.rating || 0) * Number(s.count || 0));
    }, 0);

    const totalCount = weightedTotal;
    const overall = weightedTotal > 0
      ? round1(weightedSum / weightedTotal)
      : 0;

    const distribution = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };

    for (const row of distResult.rows) {
      const star = Number(row.star);
      if (star >= 1 && star <= 5) {
        distribution[star] = Number(row.count || 0);
      }
    }

    const distTotal = Object.values(distribution).reduce((a, b) => a + b, 0);
    if (distTotal === 0 && totalCount > 0 && overall > 0) {
      Object.assign(distribution, estimateDistribution(overall, totalCount));
    }

    const expertReviews = expertReviewsResult.rows.map((row) => {
      const slug = clean(row.source_slug).toLowerCase();
      const score = row.score == null ? null : Number(row.score);
      const scoreScale = row.score_scale == null ? 5 : Number(row.score_scale);
      const scoreOutOf5 = normalizeScoreToFive(score, scoreScale);

      return {
        slug,
        name: sourceName(slug),
        article_title: clean(row.article_title),
        score,
        score_scale: scoreScale,
        score_out_of_5: scoreOutOf5,
        verdict: clean(row.verdict) || null,
        pros: Array.isArray(row.pros) ? row.pros.map(clean).filter(Boolean) : [],
        cons: Array.isArray(row.cons) ? row.cons.map(clean).filter(Boolean) : [],
        url: clean(row.article_url) || null,
        reviewed_at: row.reviewed_at || null
      };
    });

    return res.json({
      pci,
      aggregate: {
        overall,
        count: totalCount,
        verified_pct: null
      },
      distribution,
      customer_sources: customerSources,
      expert_reviews: expertReviews,
      sources: customerSources
    });
  } catch (err) {
    console.error('[reviews] query error:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

module.exports = router;