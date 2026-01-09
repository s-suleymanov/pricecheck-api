// routes/sitemap.js
const express = require("express");
const { Pool } = require("pg");

const router = express.Router();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSLMODE === "disable" ? false : { rejectUnauthorized: false },
});

function slugify(s) {
  return String(s ?? "")
    .trim()
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function xmlEscape(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function getBaseUrl(req) {
  // Prefer explicit canonical base if you set it, otherwise derive from request.
  const base = String(process.env.PUBLIC_BASE_URL || "").trim();
  if (base) return base.replace(/\/+$/g, "");

  const proto = (req.headers["x-forwarded-proto"] || req.protocol || "https").toString().split(",")[0].trim();
  const host = (req.headers["x-forwarded-host"] || req.get("host") || "").toString().split(",")[0].trim();
  return `${proto}://${host}`.replace(/\/+$/g, "");
}

// Tune these based on how your catalog stores scooter categories.
const SCOOTER_CATEGORY_SQL = `
  (
    lower(coalesce(c.category,'')) like '%scooter%'
    or lower(coalesce(c.category,'')) like '%e-scooter%'
    or lower(coalesce(c.category,'')) like '%electric scooter%'
    or lower(coalesce(c.category,'')) like '%escooter%'
  )
`;

router.get("/sitemap.xml", async (req, res) => {
  const base = getBaseUrl(req);

  // How many brands to include
  const limit = Number.isFinite(parseInt(process.env.SITEMAP_BRAND_LIMIT || "200", 10))
    ? parseInt(process.env.SITEMAP_BRAND_LIMIT || "200", 10)
    : 200;

  const client = await pool.connect();
  try {
    // Top e-scooter brands by distinct variants (model_number + version)
    const sql = `
      WITH base AS (
        SELECT
          lower(btrim(c.brand)) AS brand_norm,
          MIN(btrim(c.brand)) AS brand_label,
          COUNT(DISTINCT (
            upper(btrim(c.model_number)) || '|' ||
            COALESCE(NULLIF(lower(btrim(c.version)), ''), '')
          ))::int AS products
        FROM public.catalog c
        WHERE c.model_number IS NOT NULL AND btrim(c.model_number) <> ''
          AND c.brand IS NOT NULL AND btrim(c.brand) <> ''
          AND ${SCOOTER_CATEGORY_SQL}
        GROUP BY lower(btrim(c.brand))
      )
      SELECT brand_label, products
      FROM base
      ORDER BY products DESC, brand_label ASC
      LIMIT $1
    `;

    const { rows } = await client.query(sql, [limit]);

    // Build URL list
    const urls = [];

    // Optional: include the browse home (I usually keep it out, since you are noindexing it)
    // urls.push({ loc: `${base}/browse/`, changefreq: "daily", priority: "0.3" });

    for (const r of rows || []) {
      const label = String(r.brand_label || "").trim();
      if (!label) continue;
      const slug = slugify(label);
      if (!slug) continue;

      urls.push({
        loc: `${base}/browse/${encodeURIComponent(slug)}/`,
        changefreq: "daily",
        priority: "0.6",
      });
    }

    const now = new Date().toISOString();

    const body =
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
      urls
        .map((u) => {
          return (
            `  <url>\n` +
            `    <loc>${xmlEscape(u.loc)}</loc>\n` +
            `    <lastmod>${xmlEscape(now)}</lastmod>\n` +
            `    <changefreq>${xmlEscape(u.changefreq)}</changefreq>\n` +
            `    <priority>${xmlEscape(u.priority)}</priority>\n` +
            `  </url>`
          );
        })
        .join("\n") +
      `\n</urlset>\n`;

    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    // Cache for 1 hour (safe for sitemaps)
    res.setHeader("Cache-Control", "public, max-age=3600");
    return res.status(200).send(body);
  } catch (e) {
    console.error("sitemap.xml error:", e);
    return res.status(500).type("text/plain").send("server_error");
  } finally {
    client.release();
  }
});

module.exports = router;