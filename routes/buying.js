const express = require("express");
const fs = require("fs");
const path = require("path");
const pool = require("../db");
const rankingRules = require("../public/data/ranking_rules.json");

const router = express.Router();

const SITE_ORIGIN = process.env.SITE_ORIGIN || "https://www.pricechecktool.com";
const DEFAULT_IMAGE = `${SITE_ORIGIN}/logo/default.webp`;

const BUYING_PAGES_PATH = path.join(__dirname, "..", "public", "data", "buying-pages.json");
const BUYING_TEMPLATE_PATH = path.join(__dirname, "..", "public", "buying", "buying.html");

const CATEGORY_ALIASES = {
  earbuds: ["earbuds", "true wireless earbuds"],
  headphones: ["headphones", "over-ear headphones", "on-ear headphones"],
  speakers: ["speakers", "bluetooth speakers", "portable speakers"],
  tv: ["tv", "tvs", "smart tv", "smart tvs", "television", "televisions"],
  "robot-vacuum": ["robot vacuum", "robot vacuums"]
};

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function safeJsonForHtml(value) {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function slugify(s) {
  return String(s || "product")
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90) || "product";
}

function slugToTitle(slug) {
  const s = String(slug || "").trim().toLowerCase();

  if (s === "tv" || s === "tvs") return "TV";

  return s
    .replace(/-/g, " ")
    .replace(/\b\w/g, c => c.toUpperCase());
}

function categoryTerms(slug) {
  const key = String(slug || "").trim().toLowerCase();
  return CATEGORY_ALIASES[key] || [key.replace(/-/g, " ")];
}

function money(cents) {
  const n = Number(cents);

  if (!Number.isFinite(n) || n <= 0) return "N/A";

  return `$${(n / 100).toFixed(2)}`;
}

function absImageUrl(url) {
  const u = String(url || "").trim();

  if (!u) return DEFAULT_IMAGE;
  if (/^https?:\/\//i.test(u)) return u;

  return `${SITE_ORIGIN}${u.startsWith("/") ? "" : "/"}${u}`;
}

function boolVal(v) {
  if (typeof v === "boolean") return v;

  const s = String(v ?? "").trim().toLowerCase();

  return ["true", "yes", "1", "included"].includes(s);
}

function numVal(v) {
  const n = Number(v);

  return Number.isFinite(n) ? n : 0;
}

function arrayVal(v) {
  if (Array.isArray(v)) return v.filter(Boolean).map(x => String(x).trim()).filter(Boolean);

  if (typeof v === "string") {
    return v
      .split(/[,\n|/]+/)
      .map(x => x.trim())
      .filter(Boolean);
  }

  return [];
}

function getSpec(row, key) {
  const specs = row && row.specs_norm && typeof row.specs_norm === "object" ? row.specs_norm : {};

  return specs[key];
}

function scoreProduct(categorySlug, specsNorm) {
  const s = specsNorm && typeof specsNorm === "object" ? specsNorm : {};
  const category = String(categorySlug || "").toLowerCase();
  const rules = rankingRules[category];

  if (!rules || !Array.isArray(rules.fields)) {
    return genericScore(s);
  }

  let score = 0;

  for (const rule of rules.fields) {
    score += scoreField(rule, s[rule.key]);
  }

  return clampScore(score);
}

function scoreField(rule, value) {
  const type = String(rule.type || "").trim();
  const weight = Number(rule.weight || 0);

  if (type === "boolean") {
    return boolVal(value) ? weight : 0;
  }

  if (type === "number") {
    const raw = Math.min(Number(rule.cap || 100), numVal(value) * Number(rule.multiplier || 1));
    return raw * weight;
  }

  if (type === "water_rating") {
    return waterScore(value) * weight;
  }

  if (type === "codec") {
    return codecScore(value) * weight;
  }

  if (type === "earbud_driver") {
    return earbudDriverScore(value) * weight;
  }

  return 0;
}

function genericScore(s) {
  let score = 0;
  let count = 0;

  for (const value of Object.values(s || {})) {
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

function clampScore(n) {
  return Math.max(0, Math.min(100, Math.round(Number(n) || 0)));
}

function waterScore(v) {
  const s = String(v || "").toUpperCase();

  if (s.includes("IPX8") || s.includes("IP68")) return 100;
  if (s.includes("IPX7") || s.includes("IP57") || s.includes("IP67")) return 95;
  if (s.includes("IPX6") || s.includes("IP66")) return 85;
  if (s.includes("IPX5") || s.includes("IP55")) return 75;
  if (s.includes("IPX4") || s.includes("IP54")) return 55;
  if (s.includes("IPX3") || s.includes("IP53")) return 35;

  return 0;
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

function dashboardKey(row) {
  if (row.pci) return `pci:${String(row.pci).trim()}`;
  if (row.upc) return `upc:${String(row.upc).trim()}`;

  return "";
}

function dashboardUrl(row) {
  const title = productTitle(row);
  const key = dashboardKey(row);

  if (!key) return "#";

  const [kind, ...rest] = key.split(":");
  const value = rest.join(":");

  return `/dashboard/${slugify(title)}/${kind}/${encodeURIComponent(value)}/`;
}

function productTitle(row) {
  return `${row.brand || ""} ${row.model_name || row.model_number || "Product"}`.trim();
}

function prettyKey(key) {
  return String(key || "")
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\btv\b/g, "TV")
    .replace(/\bhdr\b/g, "HDR")
    .replace(/\bhdmi\b/g, "HDMI")
    .replace(/\banc\b/g, "ANC")
    .replace(/\bip\b/g, "IP")
    .replace(/\baac\b/g, "AAC")
    .replace(/\bsbc\b/g, "SBC")
    .replace(/\bldac\b/g, "LDAC")
    .replace(/\baptx\b/g, "aptX")
    .replace(/\b\w/g, c => c.toUpperCase());
}

function formatSpecValue(key, value) {
  if (key === "price") return money(value);

  if (value === true) return "Included";
  if (value === false || value == null || value === "") return "Not Included";

  if (Array.isArray(value)) {
    return value.length ? value.join(", ") : "N/A";
  }

  if (typeof value === "number") {
    if (key === "battery_life_hours") return `${value} Hours`;
    if (key === "battery_life_with_case_hours") return `${value} Hours`;
    if (key === "driver_size_mm") return `${value} mm`;

    return String(value);
  }

  return String(value);
}

function firstText(value) {
  if (Array.isArray(value)) return String(value[0] || "").trim();
  if (typeof value === "string") return value.trim();

  return "";
}

function normalizeTextArray(value) {
  if (Array.isArray(value)) {
    return value.map(x => String(x || "").trim()).filter(Boolean);
  }

  if (typeof value === "string" && value.trim()) {
    return [value.trim()];
  }

  return [];
}

function readVerdictJson(row) {
  if (!row || !row.catalog_verdict || typeof row.catalog_verdict !== "object") return {};

  return row.catalog_verdict;
}

function extractVerdict(row) {
  const v = readVerdictJson(row);

  return (
    row.rec_verdict ||
    row.rec_summary ||
    v.verdict ||
    v.summary ||
    v.short_verdict ||
    buildFallbackVerdict(row)
  );
}

function extractBuyIf(row) {
  const v = readVerdictJson(row);

  const fromCatalog =
    v.buy_if ||
    v.buyIf ||
    v.buy ||
    v.best_for ||
    v.bestFor;

  const arr = normalizeTextArray(fromCatalog);

  if (arr.length) return arr.slice(0, 2);

  const strengths = normalizeTextArray(row.rec_strengths);

  if (strengths.length) return strengths.slice(0, 2);

  return [buildFallbackBuyIf(row)];
}

function extractSkipIf(row) {
  const v = readVerdictJson(row);

  const fromCatalog =
    v.skip_if ||
    v.skipIf ||
    v.skip ||
    v.not_for ||
    v.notFor;

  const arr = normalizeTextArray(fromCatalog);

  if (arr.length) return arr.slice(0, 2);

  const weaknesses = normalizeTextArray(row.rec_weaknesses);

  if (weaknesses.length) return weaknesses.slice(0, 2);

  return [buildFallbackSkipIf(row)];
}

function buildFallbackVerdict(row) {
  const price = money(row.best_price_cents);
  const specs = row.specs_norm || {};
  const parts = [];

  if (boolVal(specs.active_noise_cancelling)) parts.push("ANC");
  if (numVal(specs.battery_life_with_case_hours) > 0) parts.push(`${numVal(specs.battery_life_with_case_hours)} Hours With Case`);
  if (String(specs.water_resistance_rating || "").trim()) parts.push(String(specs.water_resistance_rating).trim());

  if (parts.length) {
    return `A strong under-$100 option at ${price}, with ${parts.slice(0, 3).join(", ")}.`;
  }

  return `A practical under-$100 option at ${price} based on current PriceCheck product data.`;
}

function buildFallbackBuyIf(row) {
  const specs = row.specs_norm || {};

  if (boolVal(specs.active_noise_cancelling)) return "You want ANC without crossing $100.";
  if (numVal(specs.battery_life_with_case_hours) >= 35) return "You want long battery life under $100.";

  return "You want a safe earbud pick under $100.";
}

function buildFallbackSkipIf(row) {
  const specs = row.specs_norm || {};

  if (!boolVal(specs.active_noise_cancelling)) return "You want strong noise cancelling.";
  if (!boolVal(specs.multipoint_pairing)) return "You need multipoint pairing.";

  return "You want a premium flagship earbud.";
}

function hasCodec(row, codec) {
  const v = getSpec(row, "codec_support");
  const text = Array.isArray(v) ? v.join(" ") : String(v || "");

  return text.toLowerCase().includes(String(codec || "").toLowerCase());
}

function titleContains(row, words) {
  const title = `${row.brand || ""} ${row.model_name || ""} ${row.model_number || ""}`.toLowerCase();

  return words.some(word => title.includes(String(word).toLowerCase()));
}

function workoutScore(row) {
  const specs = row.specs_norm || {};
  let score = 0;

  score += waterScore(specs.water_resistance_rating) * 1.8;

  if (titleContains(row, ["sport", "fit", "fitness", "workout", "endurance", "race", "peak"])) score += 70;
  if (titleContains(row, ["hook", "clip", "open"])) score += 35;
  if (boolVal(specs.active_noise_cancelling)) score += 10;
  if (numVal(specs.battery_life_hours) >= 8) score += 15;

  score += Number(row.valueScore || 0) * 8;

  return score;
}

function batteryScore(row) {
  const specs = row.specs_norm || {};
  const buds = numVal(specs.battery_life_hours);
  const total = numVal(specs.battery_life_with_case_hours);

  return total * 4 + buds * 6 + Number(row.valueScore || 0) * 8;
}

function iphoneScore(row) {
  let score = 0;
  const brand = String(row.brand || "").toLowerCase();

  if (hasCodec(row, "aac")) score += 100;
  if (brand.includes("apple") || brand.includes("beats")) score += 45;
  if (boolVal(getSpec(row, "active_noise_cancelling"))) score += 10;

  score += Number(row.valueScore || 0) * 8;

  return score;
}

function pickBestForSlot(rows, slot, usedKeys) {
  const strategy = String(slot.strategy || slot.slot || "").trim();

  const available = rows.filter(row => {
    const key = dashboardKey(row) || `${row.model_number_norm}:${row.version_norm}`;

    return !usedKeys.has(key);
  });

  if (!available.length) return null;

  if (strategy === "lowest_price_with_acceptable_score" || slot.slot === "best_cheap") {
    const acceptable = available.filter(row => Number(row.featureScore || 0) >= 35);
    const pool = acceptable.length ? acceptable : available;

    return pool
      .slice()
      .sort((a, b) => {
        const priceA = Number(a.best_price_cents || 0);
        const priceB = Number(b.best_price_cents || 0);

        if (priceA !== priceB) return priceA - priceB;

        return Number(b.valueScore || 0) - Number(a.valueScore || 0);
      })[0];
  }

  if (strategy === "best_workout_score" || slot.slot === "best_workout") {
    return available
      .slice()
      .sort((a, b) => workoutScore(b) - workoutScore(a))[0];
  }

  if (strategy === "best_battery_score" || slot.slot === "best_battery") {
    return available
      .slice()
      .sort((a, b) => batteryScore(b) - batteryScore(a))[0];
  }

  if (strategy === "best_iphone_score" || slot.slot === "best_iphone") {
    const iphonePool = available.filter(row => hasCodec(row, "aac"));

    return (iphonePool.length ? iphonePool : available)
      .slice()
      .sort((a, b) => iphoneScore(b) - iphoneScore(a))[0];
  }

  return available
    .slice()
    .sort((a, b) => Number(b.valueScore || 0) - Number(a.valueScore || 0))[0];
}

function buildPickedProducts(ranked, pageConfig) {
  const slots = Array.isArray(pageConfig.pick_slots) && pageConfig.pick_slots.length
    ? pageConfig.pick_slots
    : [
        { slot: "best_overall", label: "Best Overall", strategy: "highest_value_score" },
        { slot: "best_workout", label: "Best Workout Pick", strategy: "best_workout_score" },
        { slot: "best_battery", label: "Best Battery Pick", strategy: "best_battery_score" },
        { slot: "best_iphone", label: "Best iPhone-Friendly Pick", strategy: "best_iphone_score" },
        { slot: "best_cheap", label: "Best Cheap Pick", strategy: "lowest_price_with_acceptable_score" }
      ];

  const usedKeys = new Set();
  const picks = [];

  for (const slot of slots) {
    const row = pickBestForSlot(ranked, slot, usedKeys);

    if (!row) continue;

    const key = dashboardKey(row) || `${row.model_number_norm}:${row.version_norm}`;
    usedKeys.add(key);

    picks.push(toProductPayload(row, slot));
  }

  return picks;
}

function toProductPayload(row, slot) {
  const sellers = Array.isArray(row.sellers) ? row.sellers : [];
  const bestSeller = sellers[0] || null;

  return {
    slot: slot.slot,
    label: slot.label || "Pick",
    title: productTitle(row),
    brand: row.brand || "",
    model_name: row.model_name || "",
    model_number: row.model_number || "",
    image_url: absImageUrl(row.image_url),
    dashboard_url: dashboardUrl(row),
    pci: row.pci || "",
    upc: row.upc || "",
    price_cents: Number(row.best_price_cents || 0),
    price: money(row.best_price_cents),
    feature_score: Number(row.featureScore || 0),
    value_score: Number(row.valueScore || 0),
    store_count: Number(row.store_count || 0),
    verdict: extractVerdict(row),
    buy_if: extractBuyIf(row),
    skip_if: extractSkipIf(row),
    best_seller: bestSeller,
    sellers,
    specs_norm: row.specs_norm || {}
  };
}

function buildComparisonRows(pageConfig, picks) {
  const rows = Array.isArray(pageConfig.comparison_rows) && pageConfig.comparison_rows.length
    ? pageConfig.comparison_rows
    : [
        { label: "Price", key: "price" },
        { label: "ANC", key: "active_noise_cancelling" },
        { label: "Battery", key: "battery_life_hours" },
        { label: "Case Battery", key: "battery_life_with_case_hours" },
        { label: "Water Resistance", key: "water_resistance_rating" },
        { label: "Multipoint", key: "multipoint_pairing" },
        { label: "Codec Support", key: "codec_support" },
        { label: "Wireless Charging", key: "wireless_charging_case" }
      ];

  return rows.map(row => {
    return {
      label: row.label || prettyKey(row.key),
      key: row.key,
      values: picks.map(product => {
        if (row.values && product.slot && row.values[product.slot] != null) {
          return row.values[product.slot];
        }

        if (row.key === "price") return product.price;

        if (row.key === "best_seller") {
          return product.best_seller && product.best_seller.store
            ? product.best_seller.store
            : "N/A";
        }

        return formatSpecValue(row.key, product.specs_norm ? product.specs_norm[row.key] : null);
      })
    };
  });
}

function buildItemListJsonLd(page, picks, canonicalUrl) {
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: page.title,
    description: page.description || "",
    url: canonicalUrl,
    numberOfItems: picks.length,
    itemListElement: picks.map((p, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: p.title,
      url: `${SITE_ORIGIN}${p.dashboard_url}`
    }))
  };
}

function findPageConfig(category, slug) {
  const raw = fs.readFileSync(BUYING_PAGES_PATH, "utf8");
  const pages = JSON.parse(raw);

  return pages.find(page => {
    return String(page.category || "").toLowerCase() === String(category || "").toLowerCase()
      && String(page.slug || "").toLowerCase() === String(slug || "").toLowerCase();
  });
}

function findComparisonPageConfig(slug) {
  if (!fs.existsSync(BUYING_PAGES_PATH)) {
    const err = new Error(`Missing buying pages JSON file at ${BUYING_PAGES_PATH}`);
    err.status = 500;
    throw err;
  }

  const raw = fs.readFileSync(BUYING_PAGES_PATH, "utf8");
  const pages = JSON.parse(raw);

  return pages.find(page => {
    return String(page.type || "").toLowerCase() === "comparison"
      && String(page.slug || "").toLowerCase() === String(slug || "").toLowerCase();
  });
}

function explorePagePath(page) {
  const type = String(page.type || "").trim().toLowerCase();
  const category = slugify(page.category || "");
  const slug = slugify(page.slug || "");

  if (page.path) return page.path;

  if (type === "comparison") {
    return `/compare/${slug}/`;
  }

  return `/guides/${category}/${slug}/`;
}

function exploreCardType(page) {
  const type = String(page.type || "").trim().toLowerCase();

  if (type === "comparison") return "comparison";
  if (type === "worth_it" || type === "worth-it") return "worth_it";

  return "guide";
}

function exploreCardFromPage(page) {
  const category = slugify(page.category || "");
  const title = page.title || page.seo_title || slugToTitle(page.slug || "Guide");

  return {
    title,
    description: page.description || "",
    category,
    category_label: slugToTitle(category),
    type: exploreCardType(page),
    href: explorePagePath(page)
  };
}

router.get("/api/explore", async (_req, res, next) => {
  try {
    const raw = fs.readFileSync(BUYING_PAGES_PATH, "utf8");
    const pages = JSON.parse(raw);

    const cards = Array.isArray(pages)
      ? pages.map(exploreCardFromPage).filter(card => card.title && card.href)
      : [];

    const guides = cards
      .filter(card => card.type === "guide")
      .sort((a, b) => a.title.localeCompare(b.title));

    const worthIt = cards
      .filter(card => card.type === "worth_it")
      .sort((a, b) => a.title.localeCompare(b.title));

    const comparisons = cards
      .filter(card => card.type === "comparison")
      .sort((a, b) => a.title.localeCompare(b.title));

    const rankings = Object.entries(rankingRules)
      .filter(([, rule]) => rule && Array.isArray(rule.fields) && rule.fields.length)
      .map(([category, rule]) => {
        const categorySlug = slugify(category);
        const categoryLabel = rule.label || slugToTitle(categorySlug);

        return {
          title: `${categoryLabel} Rankings`,
          description: `Compare ${categoryLabel.toLowerCase()} by price, specs, sellers, and review signals.`,
          category: categorySlug,
          category_label: categoryLabel,
          type: "ranking",
          href: `/rankings/${categorySlug}/`
        };
      })
      .sort((a, b) => a.title.localeCompare(b.title));

    return res.json({
      rankings,
      guides,
      worth_it: worthIt,
      comparisons,
      counts: {
        rankings: rankings.length,
        guides: guides.length,
        worth_it: worthIt.length,
        comparisons: comparisons.length,
        total: rankings.length + guides.length + worthIt.length + comparisons.length
      }
    });
  } catch (err) {
    next(err);
  }
});

async function getRankedCandidates(pageConfig) {
  const categorySlug = slugify(pageConfig.category || "");
  const terms = categoryTerms(categorySlug).map(t => t.toLowerCase());
  const priceCapCents = Number(pageConfig.price_cap_cents || 10000);

  const q = await pool.query(
    `
    WITH catalog_rows AS (
      SELECT
        c.id,
        c.pci,
        c.upc,
        c.brand,
        c.model_name,
        c.model_number,
        c.category,
        c.image_url,
        c.specs_norm,
        c.specs,
        c.verdict AS catalog_verdict,
        c.created_at,
        upper(btrim(c.model_number)) AS model_number_norm,
        COALESCE(NULLIF(lower(btrim(c.version)), ''), '__default__') AS version_norm
      FROM public.catalog c
      WHERE c.category IS NOT NULL
        AND btrim(c.category) <> ''
        AND lower(btrim(c.category)) = ANY($1::text[])
        AND c.model_number IS NOT NULL
        AND btrim(c.model_number) <> ''
        AND c.specs_norm IS NOT NULL
        AND jsonb_typeof(c.specs_norm) = 'object'
        AND COALESCE(c.is_refurbished, false) = false
        AND COALESCE(c.is_bundle, false) = false
    ),
    listing_matches AS (
      SELECT
        cr.model_number_norm,
        cr.version_norm,
        l.store,
        l.store_sku,
        l.url,
        l.offer_tag,
        l.rating,
        l.review_count,
        COALESCE(l.current_price_observed_at, l.created_at) AS observed_at,
        CASE
          WHEN l.effective_price_cents IS NOT NULL
           AND l.effective_price_cents > 0
           AND (
             l.current_price_cents IS NULL
             OR l.current_price_cents <= 0
             OR l.effective_price_cents <= l.current_price_cents
           )
          THEN l.effective_price_cents
          WHEN l.current_price_cents IS NOT NULL AND l.current_price_cents > 0
          THEN l.current_price_cents
          ELSE NULL
        END AS price_cents
      FROM catalog_rows cr
      JOIN public.listings l
        ON (
          (
            cr.pci IS NOT NULL
            AND btrim(cr.pci) <> ''
            AND l.pci IS NOT NULL
            AND btrim(l.pci) <> ''
            AND upper(btrim(l.pci)) = upper(btrim(cr.pci))
          )
          OR
          (
            cr.upc IS NOT NULL
            AND btrim(cr.upc) <> ''
            AND l.upc IS NOT NULL
            AND btrim(l.upc) <> ''
            AND public.norm_upc(l.upc) = public.norm_upc(cr.upc)
          )
        )
       AND coalesce(nullif(lower(btrim(l.status)), ''), 'active') <> 'hidden'
    ),
    valid_listing_matches AS (
      SELECT *
      FROM listing_matches
      WHERE price_cents IS NOT NULL
        AND price_cents > 0
    ),
    group_prices AS (
      SELECT
        model_number_norm,
        version_norm,
        MIN(price_cents) AS best_price_cents,
        COUNT(DISTINCT lower(btrim(store))) AS store_count
      FROM valid_listing_matches
      GROUP BY model_number_norm, version_norm
    ),
    seller_rows AS (
      SELECT DISTINCT ON (
        model_number_norm,
        version_norm,
        lower(btrim(store)),
        lower(btrim(COALESCE(store_sku, '')))
      )
        model_number_norm,
        version_norm,
        store,
        store_sku,
        url,
        offer_tag,
        rating,
        review_count,
        observed_at,
        price_cents
      FROM valid_listing_matches
      ORDER BY
        model_number_norm,
        version_norm,
        lower(btrim(store)),
        lower(btrim(COALESCE(store_sku, ''))),
        price_cents ASC,
        observed_at DESC NULLS LAST
    ),
    sellers AS (
      SELECT
        model_number_norm,
        version_norm,
        jsonb_agg(
          jsonb_build_object(
            'store', store,
            'store_sku', store_sku,
            'url', url,
            'offer_tag', offer_tag,
            'rating', rating,
            'review_count', review_count,
            'price_cents', price_cents,
            'price', ('$' || to_char(price_cents / 100.0, 'FM999999990.00'))
          )
          ORDER BY price_cents ASC, lower(btrim(store)) ASC
        ) AS sellers
      FROM seller_rows
      GROUP BY model_number_norm, version_norm
    ),
    picked AS (
      SELECT DISTINCT ON (cr.model_number_norm, cr.version_norm)
        cr.*,
        gp.best_price_cents,
        gp.store_count,
        s.sellers
      FROM catalog_rows cr
      JOIN group_prices gp
        ON gp.model_number_norm = cr.model_number_norm
       AND gp.version_norm = cr.version_norm
      LEFT JOIN sellers s
        ON s.model_number_norm = cr.model_number_norm
       AND s.version_norm = cr.version_norm
      WHERE gp.best_price_cents IS NOT NULL
        AND gp.best_price_cents <= $2::int
      ORDER BY
        cr.model_number_norm,
        cr.version_norm,
        CASE WHEN cr.image_url IS NULL OR btrim(cr.image_url) = '' THEN 1 ELSE 0 END,
        CASE WHEN cr.pci IS NULL OR btrim(cr.pci) = '' THEN 1 ELSE 0 END,
        cr.created_at DESC NULLS LAST,
        cr.id DESC
    )
    SELECT
      p.*,
      pr.verdict AS rec_verdict,
      pr.summary AS rec_summary,
      pr.strengths AS rec_strengths,
      pr.weaknesses AS rec_weaknesses,
      pr.overall_score AS rec_overall_score
    FROM picked p
    LEFT JOIN LATERAL (
      SELECT pr.*
      FROM public.product_recommendations pr
      WHERE
        (
          p.pci IS NOT NULL
          AND btrim(p.pci) <> ''
          AND pr.pci IS NOT NULL
          AND btrim(pr.pci) <> ''
          AND upper(btrim(pr.pci)) = upper(btrim(p.pci))
        )
        OR
        (
          p.upc IS NOT NULL
          AND btrim(p.upc) <> ''
          AND pr.upc IS NOT NULL
          AND btrim(pr.upc) <> ''
          AND public.norm_upc(pr.upc) = public.norm_upc(p.upc)
        )
      ORDER BY
        CASE
          WHEN p.pci IS NOT NULL
           AND pr.pci IS NOT NULL
           AND upper(btrim(pr.pci)) = upper(btrim(p.pci))
          THEN 0
          ELSE 1
        END,
        pr.updated_at DESC NULLS LAST
      LIMIT 1
    ) pr ON TRUE
    LIMIT 300
    `,
    [terms, priceCapCents]
  );

  return q.rows
    .map(row => {
      const featureScore = scoreProduct(categorySlug, row.specs_norm || {});
      const price = Number(row.best_price_cents) / 100;
      const valueScore = price > 0 ? featureScore / Math.sqrt(price) : 0;

      return {
        ...row,
        featureScore,
        valueScore
      };
    })
    .sort((a, b) => Number(b.valueScore || 0) - Number(a.valueScore || 0))
    .slice(0, 100);
}

async function getComparisonProduct(pageConfig, productConfig) {
  const categorySlug = slugify(pageConfig.category || "");
  const terms = categoryTerms(categorySlug).map(t => t.toLowerCase());

  const matchText = String(productConfig.match || productConfig.label || "").trim().toLowerCase();
  const brandText = String(productConfig.brand || "").trim().toLowerCase();
  const pci = String(productConfig.pci || "").trim();
  const upc = String(productConfig.upc || "").trim();

  if (!matchText && !pci && !upc) return null;

  const q = await pool.query(
    `
    WITH catalog_rows AS (
      SELECT
        c.id,
        c.pci,
        c.upc,
        c.brand,
        c.model_name,
        c.model_number,
        c.category,
        c.image_url,
        c.specs_norm,
        c.specs,
        c.verdict AS catalog_verdict,
        c.created_at,
        upper(btrim(c.model_number)) AS model_number_norm,
        COALESCE(NULLIF(lower(btrim(c.version)), ''), '__default__') AS version_norm,
        lower(concat_ws(' ', c.brand, c.model_name, c.model_number, c.pci, c.upc)) AS searchable_text
      FROM public.catalog c
      WHERE c.category IS NOT NULL
        AND btrim(c.category) <> ''
        AND lower(btrim(c.category)) = ANY($1::text[])
        AND c.model_number IS NOT NULL
        AND btrim(c.model_number) <> ''
        AND c.specs_norm IS NOT NULL
        AND jsonb_typeof(c.specs_norm) = 'object'
        AND COALESCE(c.is_refurbished, false) = false
        AND COALESCE(c.is_bundle, false) = false
        AND (
          (
            $2::text <> ''
            AND c.pci IS NOT NULL
            AND btrim(c.pci) <> ''
            AND upper(btrim(c.pci)) = upper(btrim($2::text))
          )
          OR
          (
            $3::text <> ''
            AND c.upc IS NOT NULL
            AND btrim(c.upc) <> ''
            AND public.norm_upc(c.upc) = public.norm_upc($3::text)
          )
          OR
          (
            $4::text <> ''
            AND lower(concat_ws(' ', c.brand, c.model_name, c.model_number, c.pci, c.upc)) LIKE ('%' || $4::text || '%')
            AND (
              $5::text = ''
              OR lower(btrim(c.brand)) LIKE ('%' || $5::text || '%')
              OR lower(concat_ws(' ', c.brand, c.model_name, c.model_number)) LIKE ('%' || $5::text || '%')
            )
          )
        )
    ),
    listing_matches AS (
      SELECT
        cr.model_number_norm,
        cr.version_norm,
        l.store,
        l.store_sku,
        l.url,
        l.offer_tag,
        l.rating,
        l.review_count,
        COALESCE(l.current_price_observed_at, l.created_at) AS observed_at,
        CASE
          WHEN l.effective_price_cents IS NOT NULL
           AND l.effective_price_cents > 0
           AND (
             l.current_price_cents IS NULL
             OR l.current_price_cents <= 0
             OR l.effective_price_cents <= l.current_price_cents
           )
          THEN l.effective_price_cents
          WHEN l.current_price_cents IS NOT NULL AND l.current_price_cents > 0
          THEN l.current_price_cents
          ELSE NULL
        END AS price_cents
      FROM catalog_rows cr
      JOIN public.listings l
        ON (
          (
            cr.pci IS NOT NULL
            AND btrim(cr.pci) <> ''
            AND l.pci IS NOT NULL
            AND btrim(l.pci) <> ''
            AND upper(btrim(l.pci)) = upper(btrim(cr.pci))
          )
          OR
          (
            cr.upc IS NOT NULL
            AND btrim(cr.upc) <> ''
            AND l.upc IS NOT NULL
            AND btrim(l.upc) <> ''
            AND public.norm_upc(l.upc) = public.norm_upc(cr.upc)
          )
        )
       AND coalesce(nullif(lower(btrim(l.status)), ''), 'active') <> 'hidden'
    ),
    valid_listing_matches AS (
      SELECT *
      FROM listing_matches
      WHERE price_cents IS NOT NULL
        AND price_cents > 0
    ),
    group_prices AS (
      SELECT
        model_number_norm,
        version_norm,
        MIN(price_cents) AS best_price_cents,
        COUNT(DISTINCT lower(btrim(store))) AS store_count
      FROM valid_listing_matches
      GROUP BY model_number_norm, version_norm
    ),
    seller_rows AS (
      SELECT DISTINCT ON (
        model_number_norm,
        version_norm,
        lower(btrim(store)),
        lower(btrim(COALESCE(store_sku, '')))
      )
        model_number_norm,
        version_norm,
        store,
        store_sku,
        url,
        offer_tag,
        rating,
        review_count,
        observed_at,
        price_cents
      FROM valid_listing_matches
      ORDER BY
        model_number_norm,
        version_norm,
        lower(btrim(store)),
        lower(btrim(COALESCE(store_sku, ''))),
        price_cents ASC,
        observed_at DESC NULLS LAST
    ),
    sellers AS (
      SELECT
        model_number_norm,
        version_norm,
        jsonb_agg(
          jsonb_build_object(
            'store', store,
            'store_sku', store_sku,
            'url', url,
            'offer_tag', offer_tag,
            'rating', rating,
            'review_count', review_count,
            'price_cents', price_cents,
            'price', ('$' || to_char(price_cents / 100.0, 'FM999999990.00'))
          )
          ORDER BY price_cents ASC, lower(btrim(store)) ASC
        ) AS sellers
      FROM seller_rows
      GROUP BY model_number_norm, version_norm
    ),
    picked AS (
      SELECT DISTINCT ON (cr.model_number_norm, cr.version_norm)
        cr.*,
        gp.best_price_cents,
        gp.store_count,
        s.sellers
      FROM catalog_rows cr
      JOIN group_prices gp
        ON gp.model_number_norm = cr.model_number_norm
       AND gp.version_norm = cr.version_norm
      LEFT JOIN sellers s
        ON s.model_number_norm = cr.model_number_norm
       AND s.version_norm = cr.version_norm
      WHERE gp.best_price_cents IS NOT NULL
      ORDER BY
        cr.model_number_norm,
        cr.version_norm,
        CASE
          WHEN $4::text <> '' AND lower(cr.model_name) = $4::text THEN 0
          WHEN $4::text <> '' AND lower(cr.model_name) LIKE ('%' || $4::text || '%') THEN 1
          WHEN $4::text <> '' AND cr.searchable_text LIKE ('%' || $4::text || '%') THEN 2
          ELSE 3
        END,
        CASE WHEN cr.image_url IS NULL OR btrim(cr.image_url) = '' THEN 1 ELSE 0 END,
        CASE WHEN cr.pci IS NULL OR btrim(cr.pci) = '' THEN 1 ELSE 0 END,
        gp.best_price_cents ASC,
        cr.created_at DESC NULLS LAST,
        cr.id DESC
    )
    SELECT
      p.*,
      pr.verdict AS rec_verdict,
      pr.summary AS rec_summary,
      pr.strengths AS rec_strengths,
      pr.weaknesses AS rec_weaknesses,
      pr.overall_score AS rec_overall_score
    FROM picked p
    LEFT JOIN LATERAL (
      SELECT pr.*
      FROM public.product_recommendations pr
      WHERE
        (
          p.pci IS NOT NULL
          AND btrim(p.pci) <> ''
          AND pr.pci IS NOT NULL
          AND btrim(pr.pci) <> ''
          AND upper(btrim(pr.pci)) = upper(btrim(p.pci))
        )
        OR
        (
          p.upc IS NOT NULL
          AND btrim(p.upc) <> ''
          AND pr.upc IS NOT NULL
          AND btrim(pr.upc) <> ''
          AND public.norm_upc(pr.upc) = public.norm_upc(p.upc)
        )
      ORDER BY
        CASE
          WHEN p.pci IS NOT NULL
           AND pr.pci IS NOT NULL
           AND upper(btrim(pr.pci)) = upper(btrim(p.pci))
          THEN 0
          ELSE 1
        END,
        pr.updated_at DESC NULLS LAST
      LIMIT 1
    ) pr ON TRUE
    LIMIT 1
    `,
    [terms, pci, upc, matchText, brandText]
  );

  const row = q.rows[0];

  if (!row) return null;

  const featureScore = scoreProduct(categorySlug, row.specs_norm || {});
  const price = Number(row.best_price_cents) / 100;
  const valueScore = price > 0 ? featureScore / Math.sqrt(price) : 0;

  return {
    ...row,
    featureScore,
    valueScore
  };
}

function buildWinnerPayload(pageConfig, picks) {
  const winners = Array.isArray(pageConfig.winners) ? pageConfig.winners : [];

  return winners.map(item => {
    const product = picks.find(p => p.slot === item.winner_slot);

    return {
      label: item.label || "",
      winner_slot: item.winner_slot || "",
      winner: product ? product.title : item.winner_slot || "",
      reason: item.reason || ""
    };
  });
}

function buildVerdictBlocksPayload(pageConfig, picks) {
  const blocks = Array.isArray(pageConfig.verdict_blocks) ? pageConfig.verdict_blocks : [];

  return blocks.map(block => {
    const product = picks.find(p => p.slot === block.product_slot);

    return {
      heading: block.heading || "",
      product_slot: block.product_slot || "",
      product_title: product ? product.title : "",
      items: Array.isArray(block.items) ? block.items : []
    };
  });
}

async function buildComparisonPagePayload(pageConfig) {
  const categorySlug = slugify(pageConfig.category || "");
  const categoryLabel = slugToTitle(categorySlug);
  const productConfigs = Array.isArray(pageConfig.products) ? pageConfig.products : [];
  const rows = [];
  const missingProducts = [];

  for (const productConfig of productConfigs) {
    const row = await getComparisonProduct(pageConfig, productConfig);

    if (!row) {
      missingProducts.push(productConfig.label || productConfig.match || productConfig.slot || "Unknown product");
      continue;
    }

    rows.push({
      row,
      config: productConfig
    });
  }

  const picks = rows.map(({ row, config }) => {
    return toProductPayload(row, {
      slot: config.slot,
      label: config.label || productTitle(row)
    });
  });

  const comparisonRows = buildComparisonRows(pageConfig, picks);
  const canonicalPath = pageConfig.path || `/compare/${pageConfig.slug}/`;
  const canonicalUrl = `${SITE_ORIGIN}${canonicalPath}`;

  return {
    page: {
      ...pageConfig,
      category_label: categoryLabel,
      canonical_url: canonicalUrl
    },
    picks,
    comparison_rows: comparisonRows,
    winners: buildWinnerPayload(pageConfig, picks),
    verdict_blocks: buildVerdictBlocksPayload(pageConfig, picks),
    missing_products: missingProducts,
    ranked_count: picks.length,
    generated_at: new Date().toISOString(),
    json_ld: buildItemListJsonLd(pageConfig, picks, canonicalUrl)
  };
}

async function buildPagePayload(pageConfig) {

const pageType = String(pageConfig.type || "").toLowerCase();

if (pageType === "comparison" || pageType === "worth_it") {
return buildComparisonPagePayload(pageConfig);
}

  const categorySlug = slugify(pageConfig.category || "");
  const categoryLabel = slugToTitle(categorySlug);
  const ranked = await getRankedCandidates(pageConfig);
  const picks = buildPickedProducts(ranked, pageConfig);
  const comparisonRows = buildComparisonRows(pageConfig, picks);
  const canonicalPath = pageConfig.path || `/guides/${categorySlug}/${pageConfig.slug}/`;
  const canonicalUrl = `${SITE_ORIGIN}${canonicalPath}`;

  return {
    page: {
      ...pageConfig,
      category_label: categoryLabel,
      canonical_url: canonicalUrl
    },
    picks,
    comparison_rows: comparisonRows,
    ranked_count: ranked.length,
    generated_at: new Date().toISOString(),
    json_ld: buildItemListJsonLd(pageConfig, picks, canonicalUrl)
  };
}

router.get("/api/guides/:category/:slug", async (req, res, next) => {
  try {
    const category = slugify(req.params.category || "");
    const slug = slugify(req.params.slug || "");
    const pageConfig = findPageConfig(category, slug);

    if (!pageConfig) return res.status(404).json({ error: "Guide not found." });

    const payload = await buildPagePayload(pageConfig);

    return res.json(payload);
  } catch (err) {
    next(err);
  }
});

router.get(["/guides/:category/:slug", "/guides/:category/:slug/"], async (req, res, next) => {
  try {
    const category = slugify(req.params.category || "");
    const slug = slugify(req.params.slug || "");
    const pageConfig = findPageConfig(category, slug);

    if (!pageConfig) return next();

    const payload = await buildPagePayload(pageConfig);

    if (!payload.picks.length) return next();

    const pageTitle = pageConfig.seo_title || `${pageConfig.title} - PriceCheck`;
    const desc = pageConfig.description || "";
    const canonicalUrl = payload.page.canonical_url;
    const firstImage = payload.picks[0]?.image_url || DEFAULT_IMAGE;

    let html = fs.readFileSync(BUYING_TEMPLATE_PATH, "utf8");

    html = html
      .replace(/__BUYING_PAGE_JSON__/g, safeJsonForHtml(payload))
      .replace(/__PAGE_TITLE__/g, esc(pageTitle))
      .replace(/__PAGE_DESCRIPTION__/g, esc(desc))
      .replace(/__CANONICAL_URL__/g, esc(canonicalUrl))
      .replace(/__OG_IMAGE__/g, esc(firstImage))
      .replace(/__JSON_LD__/g, safeJsonForHtml(payload.json_ld));

    return res.type("html").send(html);
  } catch (err) {
    next(err);
  }
});

router.get("/api/buying/compare/:slug", async (req, res, next) => {
  try {
    const slug = slugify(req.params.slug || "");
    const pageConfig = findComparisonPageConfig(slug);

    if (!pageConfig) return res.status(404).json({ error: "Comparison page not found." });

    const payload = await buildComparisonPagePayload(pageConfig);

    return res.json(payload);
  } catch (err) {
    next(err);
  }
});

router.get(["/compare/:slug", "/compare/:slug/"], async (req, res, next) => {
  try {
    const slug = slugify(req.params.slug || "");
    const pageConfig = findComparisonPageConfig(slug);

    if (!pageConfig) return next();

    const payload = await buildComparisonPagePayload(pageConfig);

    if (!payload.picks.length) return next();

    const pageTitle = pageConfig.seo_title || `${pageConfig.title} - PriceCheck`;
    const desc = pageConfig.description || "";
    const canonicalUrl = payload.page.canonical_url;
    const firstImage = payload.picks[0]?.image_url || DEFAULT_IMAGE;

    let html = fs.readFileSync(BUYING_TEMPLATE_PATH, "utf8");

    html = html
      .replace(/__BUYING_PAGE_JSON__/g, safeJsonForHtml(payload))
      .replace(/__PAGE_TITLE__/g, esc(pageTitle))
      .replace(/__PAGE_DESCRIPTION__/g, esc(desc))
      .replace(/__CANONICAL_URL__/g, esc(canonicalUrl))
      .replace(/__OG_IMAGE__/g, esc(firstImage))
      .replace(/__JSON_LD__/g, safeJsonForHtml(payload.json_ld));

    return res.type("html").send(html);
  } catch (err) {
    next(err);
  }
});

module.exports = router;