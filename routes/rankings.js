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

router.get(["/rankings/:category", "/rankings/:category/"], async (req, res, next) => {
  try {
    const categorySlug = slugify(req.params.category || "");
    const categoryLabel = slugToTitle(categorySlug);
    const terms = categoryTerms(categorySlug);
    const canonicalUrl = `${SITE_ORIGIN}/rankings/${categorySlug}/`;

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
        groups AS (
            SELECT DISTINCT
            model_number_norm,
            version_norm
            FROM catalog_rows
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
            gp.best_price_cents
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
        [terms.map(t => t.toLowerCase())]
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
      .slice(0, 50);

    if (!ranked.length) {
        return next();
    }

    const pageTitle = `Best ${categoryLabel} by Value (2026) - PriceCheck`;
    const h1 = `Best ${categoryLabel} Ranked by Value`;
    const desc = `See the best ${categoryLabel.toLowerCase()} ranked by value using current store prices, product specs, expert review signals, and PriceCheck product data.`;
    const firstImage = absImageUrl(ranked[0]?.image_url);

    const itemListJsonLd = {
        "@context": "https://schema.org",
        "@type": "ItemList",
        name: h1,
        description: desc,
        url: canonicalUrl,
        numberOfItems: ranked.length,
        itemListElement: ranked.slice(0, 20).map((p, i) => {
            const title = `${p.brand || ""} ${p.model_name || p.model_number || "Product"}`.trim();
            const key = dashboardKey(p);
            const href = key
            ? `${SITE_ORIGIN}/dashboard/${slugify(title)}/${key.split(":")[0]}/${encodeURIComponent(key.split(":").slice(1).join(":"))}/`
            : canonicalUrl;

            return {
            "@type": "ListItem",
            position: i + 1,
            url: href,
            name: title
            };
        })
    };

    const items = ranked.map((p, i) => {
      const title = `${p.brand || ""} ${p.model_name || p.model_number || "Product"}`.trim();
      const key = dashboardKey(p);
      const href = key
        ? `/dashboard/${slugify(title)}/${key.split(":")[0]}/${encodeURIComponent(key.split(":").slice(1).join(":"))}/`
        : "#";

      return `
        <article class="ranking-item">
          <div class="ranking-rank">${i + 1}</div>

          <a class="ranking-img" href="${esc(href)}" aria-label="Open ${esc(title)} dashboard">
            ${
              p.image_url
                ? `<img src="${esc(p.image_url)}" alt="${esc(title)}" loading="lazy" decoding="async">`
                : `<div class="ranking-img-empty">No image</div>`
            }
          </a>

          <div class="ranking-body">
            <a class="ranking-title" href="${esc(href)}">${esc(title)}</a>

            <div class="ranking-meta">
              <span>${esc(money(p.best_price_cents))}</span>
              <span>Feature score ${esc(p.featureScore)}/100</span>
              <span>Value score ${esc(p.valueScore.toFixed(2))}</span>
            </div>

            <p>${esc(whyText(p))}</p>
          </div>
        </article>
      `;
    }).join("");

    res.type("html").send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">

  <title>${esc(pageTitle)}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="${esc(desc)}">
  <meta name="robots" content="index,follow">
  <link rel="canonical" href="${esc(canonicalUrl)}">

  <link rel="icon" type="image/png" href="/logo/logo.png">

  <meta property="og:type" content="website">
  <meta property="og:site_name" content="PriceCheck">
  <meta property="og:title" content="${esc(pageTitle)}">
  <meta property="og:description" content="${esc(desc)}">
  <meta property="og:url" content="${esc(canonicalUrl)}">
  <meta property="og:image" content="${esc(firstImage)}">

  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${esc(pageTitle)}">
  <meta name="twitter:description" content="${esc(desc)}">
  <meta name="twitter:image" content="${esc(firstImage)}">

  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Google+Sans:ital,opsz,wght@0,17..18,400..700;1,17..18,400..700&display=swap" rel="stylesheet">

  <link rel="stylesheet" href="/styles.css">
  <script src="/partials/partials.js" defer></script>
  <script src="/search.js" defer></script>

  <style>
    body{
      margin:0;
      background:#f5f5f7;
      color:#111827;
      font-family:"Google Sans", Arial, sans-serif;
    }

    .ranking-page{
      max-width:1120px;
      margin:0 auto;
      padding:80px 22px;
    }

    .ranking-head{
      background:#fff;
      border-radius:24px;
      padding:34px;
      margin-bottom:22px;
    }

    .ranking-head h1{
      margin:0 0 10px;
      font-size:clamp(34px,5vw,52px);
      letter-spacing:-.04em;
      line-height:1.05;
      font-weight:600;
    }

    .ranking-sub{
      margin:0;
      max-width:760px;
      color:#64748b;
      font-size:18px;
      line-height:1.55;
    }

    .ranking-list{
      display:grid;
      gap:12px;
    }

    .ranking-item{
      display:grid;
      grid-template-columns:64px 96px minmax(0,1fr);
      gap:16px;
      align-items:center;
      background:#fff;
      border-radius:20px;
      padding:14px;
    }

    .ranking-rank{
      font-size:50px;
      font-weight:800;
      text-align:center;
    }

    .ranking-img{
      width:96px;
      height:96px;
      border-radius:16px;
      background:#f8fafc;
      display:grid;
      place-items:center;
      overflow:hidden;
      text-decoration:none;
    }

    .ranking-img img{
      width:100%;
      height:100%;
      object-fit:contain;
    }

    .ranking-img-empty{
      font-size:12px;
      color:#94a3b8;
    }

    .ranking-title{
      display:block;
      font-size:21px;
      font-weight:800;
      color:#111827;
      text-decoration:none;
      margin-bottom:6px;
    }

    .ranking-meta{
      display:flex;
      gap:12px;
      flex-wrap:wrap;
      color:#64748b;
      font-size:16px;
      margin-bottom:8px;
    }

    .ranking-body p{
      margin:0;
      color:#334155;
      line-height:1.45;
    }

    .ranking-empty{
      background:#fff;
      border-radius:20px;
      padding:22px;
      color:#64748b;
    }

    .ranking-footer{
      margin-top:26px;
      color:#64748b;
      font-size:14px;
      line-height:1.5;
    }

    @media(max-width:700px){
      .ranking-page{
        padding:22px 14px 60px;
      }

      .ranking-head{
        padding:24px;
      }

      .ranking-item{
        grid-template-columns:44px 74px minmax(0,1fr);
        gap:10px;
      }

      .ranking-img{
        width:74px;
        height:74px;
      }

      .ranking-title{
        font-size:16px;
      }
    }
  </style>
  <script type="application/ld+json">${JSON.stringify(itemListJsonLd)}</script>
</head>

<body>
   <header class="nav">
        <a class="logo-head" href="/" aria-label="Go to PriceCheck home">
            <img src="/logo/logo2.png" alt="PriceCheck Logo" class="logo">
            <div class="brand">
            <span class="wordmark" data-pc-wordmark="1">PriceCheck</span>
            <span class="edition" data-pc-edition="1">Beta</span>
            </div>
        </a>

        <div class="nav-searchwrap" role="search" aria-label="Search PriceCheck">
        <form class="nav-search" action="#" method="GET">
            <input
            class="nav-search__input"
            type="search"
            name="q"
            autocomplete="off"
            spellcheck="false"
            />
        </form>

            <button
            class="nav-ai"
            type="button"
            title="PriceAI"
            data-pc-plus="1"
            aria-label="AI"
            >
            <img class="nav-ai__icon" src="/logo/ai.svg" alt="PriceAI" loading="lazy" decoding="async">
            </button> 
        </div>

        <div class="nav-actions">
        <button
            class="btn btn--outline nav-signin-btn"
            type="button"
            data-signin-open="1"
            data-auth-signedout-only="1"
            aria-haspopup="dialog"
            aria-controls="pcSignInModal"
            aria-label="Sign in"
            hidden
        >
            <span class="nav-signin-btn__text">Sign in</span>

            <span class="nav-signin-btn__icon" aria-hidden="true">
            <svg viewBox="0 -960 960 960" width="20" height="20" focusable="false">
                <path fill="currentColor" d="M367-527q-47-47-47-113t47-113q47-47 113-47t113 47q47 47 47 113t-47 113q-47 47-113 47t-113-47ZM160-160v-112q0-34 17.5-62.5T224-378q62-31 126-46.5T480-440q66 0 130 15.5T736-378q29 15 46.5 43.5T800-272v112H160Zm80-80h480v-32q0-11-5.5-20T700-306q-54-27-109-40.5T480-360q-56 0-111 13.5T260-306q-9 5-14.5 14t-5.5 20v32Zm296.5-343.5Q560-607 560-640t-23.5-56.5Q513-720 480-720t-56.5 23.5Q400-673 400-640t23.5 56.5Q447-560 480-560t56.5-23.5ZM480-640Zm0 400Z"/>
            </svg>
            </span>
        </button>

        <button
            class="pc-account-trigger"
            type="button"
            aria-label="Open account menu"
            aria-haspopup="menu"
            aria-expanded="false"
            aria-controls="pcAccountMenu"
            data-account-menu-toggle="1"
            data-auth-signedin-only="1"
            hidden
        >
            <img
            id="pcAccountTriggerImg"
            class="pc-account-trigger__img"
            alt=""
            hidden
            >
            <span
            id="pcAccountTriggerFallback"
            class="pc-account-trigger__fallback"
            aria-hidden="true"
            >
            S
            </span>
            <span class="sr-only">Account</span>
        </button>

        <div id="pcAccountMenu" class="pc-account-menu" hidden>
            <a class="pc-account-menu__item" href="/accounts/">Account</a>
            <a class="pc-account-menu__item" href="/settings/">Settings</a>
            <a class="pc-account-menu__item" href="/support/">Support</a>
            <a class="pc-account-menu__item" href="/upgrade/">Upgrade</a>
                <a
            class="pc-account-menu__item"
            href="https://chromewebstore.google.com/detail/pricecheck-your-all-in-on/ikpdkmnglgckdhlkcboeccifjpikcfcf?authuser=0&hl=en"
            target="_blank"
            rel="noopener noreferrer"
            >
            Extension
            </a>

            <div class="pc-account-menu__sep"></div>

            <button
            class="pc-account-menu__item pc-account-menu__item--danger"
            type="button"
            data-account-signout="1"
            >
            Sign Out
            </button>
        </div>
        </div>
        </header>

        <div id="pcPlusToast" class="pc-plus-toast" hidden aria-live="polite"></div>

        <div id="pcSignInModal" class="pc-signin" hidden>
        <div class="pc-signin__backdrop" data-signin-close="1" aria-hidden="true"></div>

        <section
            class="pc-signin__card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="pcSignInTitle"
        >
            <div class="pc-signin__head">
            <div>
                <h2 id="pcSignInTitle" class="pc-signin__title">Quick Sign in</h2>
                <p class="pc-signin__sub">Use your PriceCheck account to save lists and access your profile.</p>
            </div>

            <button
                type="button"
                class="pc-signin__close"
                data-signin-close="1"
                aria-label="Close sign in"
            >
                <svg viewBox="0 -960 960 960" width="20" height="20" aria-hidden="true" focusable="false">
                <path fill="currentColor" d="m251.33-200-51.33-51.33L428.67-480 200-708.67 251.33-760 480-531.33 708.67-760 760-708.67 531.33-480 760-251.33 708.67-200 480-428.67 251.33-200Z"/>
                </svg>
            </button>
            </div>

            <form id="pcQuickSignInForm" class="pc-signin__form" novalidate>
            <label class="pc-signin__label" for="pcSignInEmail">Email</label>
            <input
                id="pcSignInEmail"
                class="pc-signin__input"
                type="email"
                name="email"
                placeholder="you@example.com"
                autocomplete="email"
            >

            <label class="pc-signin__label" for="pcSignInPassword">Password</label>
            <input
                id="pcSignInPassword"
                class="pc-signin__input"
                type="password"
                name="password"
                placeholder="Enter your password"
                autocomplete="current-password"
            >

            <button type="submit" class="btn btn--solid pc-signin__submit">Continue</button>

            <div class="pc-signin__note" style="display:flex; align-items:center; justify-content:center; gap:8px;">
                <span>Don't have an account?</span>
                <a style="text-decoration: none;" href="/signup/index.html">Sign Up</a>
            </div>

            <p id="pcSignInStatus" class="pc-signin__status" hidden aria-live="polite"></p>
            </form>
        </section>
        </div>

  <main class="ranking-page">
    <section class="ranking-head">
      <h1>${esc(h1)}</h1>
      <p class="ranking-sub">
        PriceCheck ranks products using available specs, store prices, expert reviews, and product signals to estimate which options offer the strongest value.
      </p>
    </section>

    <section class="ranking-list" aria-label="${esc(h1)}">
      ${ranked.length ? items : `<div class="ranking-empty">No ranked products found yet.</div>`}
    </section>
  </main>
</body>
</html>`);
  } catch (err) {
    next(err);
  }
});

module.exports = router;