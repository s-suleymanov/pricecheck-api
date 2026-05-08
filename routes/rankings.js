const express = require("express");
const pool = require("../db");
const rankingRules = require("../public/data/ranking_rules.json");

const router = express.Router();

const SITE_ORIGIN = "https://www.pricechecktool.com";
const DEFAULT_IMAGE = `${SITE_ORIGIN}/logo/default.webp`;

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

function boolVal(v) {
  if (typeof v === "boolean") return v;
  const s = String(v ?? "").trim().toLowerCase();
  return ["true", "yes", "1"].includes(s);
}

function numVal(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
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
  if (s.includes("IPX7") || s.includes("IP57") || s.includes("IP67")) return 100;
  if (s.includes("IPX5") || s.includes("IP55")) return 75;
  if (s.includes("IPX4") || s.includes("IP54")) return 55;
  return 20;
}

function resolutionScore(v) {
  const s = String(v || "").toLowerCase();
  if (s.includes("8k")) return 100;
  if (s.includes("4k") || s.includes("2160")) return 80;
  if (s.includes("1080") || s.includes("full hd")) return 45;
  return 25;
}

function whyText(row, _categoryLabel) {
  const s = row.specs_norm || {};
  const points = [];

  for (const [key, value] of Object.entries(s)) {
    if (points.length >= 3) break;

    if (value === true) points.push(prettyKey(key));
    else if (typeof value === "number" && value > 0) points.push(`${prettyKey(key)} (${value})`);
    else if (typeof value === "string" && value.trim()) points.push(`${prettyKey(key)} (${String(value).trim()})`);
  }

  const score = Number(row.valueScore || 0);

  if (!points.length) {
    return "Ranked using available product features and current store pricing.";
  }

  if (score >= 7) {
    return `Strong value for the price, with ${points.join(", ")}.`;
  }

  if (score >= 4) {
    return `Good value for the price, with ${points.join(", ")}.`;
  }

  if (score >= 2) {
    return `Moderate value based on ${points.join(", ")} and current store pricing.`;
  }

  return `Lower value at its current price, despite offering ${points.join(", ")}.`;
}

function prettyKey(key) {
  return String(key || "")
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\btv\b/g, "TV")
    .replace(/\bhdr\b/g, "HDR")
    .replace(/\bhdmi\b/g, "HDMI")
    .replace(/\banc\b/g, "ANC")
    .replace(/\bip\b/g, "IP");
}

function dashboardKey(row) {
  if (row.pci) return `pci:${String(row.pci).trim()}`;
  if (row.upc) return `upc:${String(row.upc).trim()}`;
  return "";
}

function slugify(s) {
  return String(s || "product")
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "product";
}

function absImageUrl(url) {
  const u = String(url || "").trim();
  if (!u) return DEFAULT_IMAGE;
  if (/^https?:\/\//i.test(u)) return u;
  return `${SITE_ORIGIN}${u.startsWith("/") ? "" : "/"}${u}`;
}

function normalizeDashboardRankKey(raw) {
  const s = String(raw || "").trim();
  const i = s.indexOf(":");
  if (i === -1) return null;

  const kind = s.slice(0, i).trim().toLowerCase();
  const value = s.slice(i + 1).trim();

  if (!value) return null;
  if (kind !== "pci" && kind !== "upc") return null;

  return {
    kind,
    value: kind === "pci"
      ? value.toUpperCase()
      : value.replace(/[\s-]/g, "")
  };
}

function sameRankKey(row, target) {
  if (!row || !target) return false;

  if (target.kind === "pci") {
    return String(row.pci || "").trim().toUpperCase() === target.value;
  }

  if (target.kind === "upc") {
    return String(row.upc || "").replace(/[\s-]/g, "") === target.value;
  }

  return false;
}

router.get("/api/rankings/:category/rank", async (req, res, next) => {
  try {
    const categorySlug = slugify(req.params.category || "");
    const categoryLabel = slugToTitle(categorySlug);
    const terms = categoryTerms(categorySlug);
    const target = normalizeDashboardRankKey(req.query.key);

    if (!target) {
      return res.status(400).json({ error: "Missing rank key." });
    }

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
      ),
      target_group AS (
        SELECT DISTINCT
          cr.model_number_norm,
          cr.version_norm
        FROM catalog_rows cr
        WHERE
          (
            $2::text = 'pci'
            AND cr.pci IS NOT NULL
            AND btrim(cr.pci) <> ''
            AND upper(btrim(cr.pci)) = upper(btrim($3::text))
          )
          OR
          (
            $2::text = 'upc'
            AND cr.upc IS NOT NULL
            AND btrim(cr.upc) <> ''
            AND public.norm_upc(cr.upc) = public.norm_upc($3::text)
          )
        LIMIT 1
      ),
      group_prices AS (
        SELECT
          cr.model_number_norm,
          cr.version_norm,
          MIN(
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
            END
          ) AS best_price_cents
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
        GROUP BY cr.model_number_norm, cr.version_norm
      ),
      picked AS (
        SELECT DISTINCT ON (cr.model_number_norm, cr.version_norm)
          cr.pci,
          cr.upc,
          cr.brand,
          cr.model_name,
          cr.model_number,
          cr.category,
          cr.image_url,
          cr.specs_norm,
          cr.model_number_norm,
          cr.version_norm,
          gp.best_price_cents,
          EXISTS (
            SELECT 1
            FROM target_group tg
            WHERE tg.model_number_norm = cr.model_number_norm
              AND tg.version_norm = cr.version_norm
          ) AS is_target_group
        FROM catalog_rows cr
        JOIN group_prices gp
          ON gp.model_number_norm = cr.model_number_norm
         AND gp.version_norm = cr.version_norm
        WHERE gp.best_price_cents IS NOT NULL
        ORDER BY
          cr.model_number_norm,
          cr.version_norm,
          CASE WHEN cr.image_url IS NULL OR btrim(cr.image_url) = '' THEN 1 ELSE 0 END,
          CASE WHEN cr.pci IS NULL OR btrim(cr.pci) = '' THEN 1 ELSE 0 END,
          cr.created_at DESC NULLS LAST,
          cr.id DESC
      )
      SELECT *
      FROM picked
      LIMIT 300
      `,
      [terms.map(t => t.toLowerCase()), target.kind, target.value]
    );

    const ranked = q.rows
      .map((row) => {
        const featureScore = scoreProduct(categorySlug, row.specs_norm || {});
        const price = Number(row.best_price_cents) / 100;
        const valueScore = price > 0 ? featureScore / Math.sqrt(price) : 0;

        return {
          ...row,
          featureScore,
          valueScore
        };
      })
      .sort((a, b) => b.valueScore - a.valueScore)
      .slice(0, 100);

    const index = ranked.findIndex(row => !!row.is_target_group);

    if (index === -1) {
      return res.status(404).json({ error: "Rank not found." });
    }

    const row = ranked[index];

    return res.json({
      rank: index + 1,
      total: ranked.length,
      category: categoryLabel,
      score: Number(row.valueScore || 0),
      url: "/trending/"
    });
  } catch (err) {
    next(err);
  }
});

router.get(["/rankings/:category", "/rankings/:category/"], (req, res) => {
  res.redirect(301, "/trending/");
});

module.exports = router;