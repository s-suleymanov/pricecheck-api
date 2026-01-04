// routes/admin.js
const path = require("path");
const express = require("express");
const { Pool } = require("pg");

const router = express.Router();

// add this
router.use(express.json({ limit: "1mb" }));

// -------------------------
// Auth (Basic)
// -------------------------
function unauthorized(res) {
  res.setHeader("WWW-Authenticate", 'Basic realm="PriceCheck Admin"');
  return res.status(401).send("Auth required");
}

function basicAuth(req, res, next) {
  const user = process.env.ADMIN_USER || "";
  const pass = process.env.ADMIN_PASS || "";

  // If you forgot to set env vars, do not accidentally expose admin
  if (!user || !pass) return res.status(500).send("Admin auth not configured");

  const header = req.headers.authorization || "";
  const [scheme, encoded] = header.split(" ");

  if (scheme !== "Basic" || !encoded) return unauthorized(res);

  let decoded = "";
  try {
    decoded = Buffer.from(encoded, "base64").toString("utf8");
  } catch {
    return unauthorized(res);
  }

  const idx = decoded.indexOf(":");
  if (idx < 0) return unauthorized(res);

  const u = decoded.slice(0, idx);
  const p = decoded.slice(idx + 1);

  if (u !== user || p !== pass) return unauthorized(res);

  next();
}

// Protect both UI + API
router.use("/admin", basicAuth);
router.use("/admin/api", basicAuth);

// -------------------------
// DB
// -------------------------
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSLMODE ? undefined : { rejectUnauthorized: false },
});

// -------------------------
// Helpers
// -------------------------
function normKey(x) {
  if (!x) return null;
  const s = String(x).trim();
  return s.length ? s : null;
}

function toInt(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function normalizeEmpty(v) {
  if (v === undefined) return undefined;
  if (v === null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function buildUpdate({ table, idCol, id, allowed, body }) {
  const sets = [];
  const vals = [];
  let idx = 1;

  for (const key of allowed) {
    if (!(key in body)) continue;
    sets.push(`${key} = $${idx++}`);
    vals.push(body[key]);
  }

  if (!sets.length) return null;

  vals.push(id);
  const sql = `update ${table} set ${sets.join(", ")} where ${idCol} = $${idx} returning *`;
  return { sql, vals };
}

// -------------------------
// Serve the admin UI
// -------------------------
router.use(
  "/admin",
  express.static(path.join(__dirname, "..", "public", "admin"), { index: "index.html" })
);

// Convenience: /admin -> /admin/
router.get("/admin", (req, res) => res.redirect(302, "/admin/"));

// -------------------------
// Admin API: edits
// -------------------------

// Update a catalog row
router.patch("/admin/api/catalog/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "bad_id" });

  const body = req.body || {};
  const allowed = [
    "pci",
    "upc",
    "brand",
    "category",
    "model_number",
    "model_name",
    "version",
    "color",
    "image_url",
    "recall_url",
    "dropship_warning",
  ];

  for (const k of allowed) {
    if (k in body) body[k] = normalizeEmpty(body[k]);
  }

  const built = buildUpdate({
    table: "public.catalog",
    idCol: "id",
    id,
    allowed,
    body,
  });

  if (!built) return res.status(400).json({ error: "no_fields" });

  const client = await pool.connect();
  try {
    const r = await client.query(built.sql, built.vals);
    if (!r.rows[0]) return res.status(404).json({ error: "not_found" });
    res.json({ ok: true, row: r.rows[0] });
  } catch (err) {
    console.error("admin catalog patch error", err);
    res.status(500).json({ error: "catalog_patch_failed" });
  } finally {
    client.release();
  }
});

// Update a listing row
router.patch("/admin/api/listing/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "bad_id" });

  const body = req.body || {};
  const allowed = ["pci", "upc", "title", "url", "status", "offer_tag"];

  for (const k of allowed) {
    if (k in body) body[k] = normalizeEmpty(body[k]);
  }

  const built = buildUpdate({
    table: "public.listings",
    idCol: "id",
    id,
    allowed,
    body,
  });

  if (!built) return res.status(400).json({ error: "no_fields" });

  const client = await pool.connect();
  try {
    const r = await client.query(built.sql, built.vals);
    if (!r.rows[0]) return res.status(404).json({ error: "not_found" });
    res.json({ ok: true, row: r.rows[0] });
  } catch (err) {
    console.error("admin listing patch error", err);
    res.status(500).json({ error: "listing_patch_failed" });
  } finally {
    client.release();
  }
});

router.get("/admin/api/search", async (req, res) => {
  const qRaw = normKey(req.query.q);
  const limit = Math.min(Math.max(toInt(req.query.limit) || 30, 1), 100);
  if (!qRaw) return res.json({ q: "", bridge: null, catalog: [], listings: [] });

  const q = qRaw.trim();
  const qDigits = q.replace(/[^\d]/g, "");
  const qAlnum = q.replace(/[^0-9A-Za-z]/g, "");

  const maybeUpc =
    qDigits.length === 12 || (qDigits.length === 13 && qDigits.startsWith("0"))
      ? qDigits
      : null;

  // Generic store_sku (ASIN/TCIN/itemId/SKU)
  const maybeSku = qAlnum.length ? qAlnum.toUpperCase() : null;

  const client = await pool.connect();
  try {
    // 1) Listings first (ASIN/store_sku lives here)
    const listingsSql = `
      select
        id, store, store_sku, pci, upc, title, url, status, offer_tag,
        current_price_cents, current_price_observed_at,
        coupon_text, coupon_type, coupon_value_cents, coupon_value_pct,
        coupon_requires_clip, coupon_code, coupon_expires_at,
        effective_price_cents, coupon_observed_at,
        created_at
      from public.listings
      where
        ($1::text is not null and upper(btrim(pci)) = upper(btrim($1)))
        or ($2::text is not null and regexp_replace(coalesce(upc,''), '[^0-9]', '', 'g') = regexp_replace(coalesce($2::text,''), '[^0-9]', '', 'g'))
        or ($5::text is not null and upper(regexp_replace(coalesce(store_sku,''), '[^0-9A-Za-z]', '', 'g')) = upper(regexp_replace(coalesce($5::text,''), '[^0-9A-Za-z]', '', 'g')))
        or (store_sku ilike '%' || $3 || '%')
        or (title ilike '%' || $3 || '%')
        or (store ilike '%' || $3 || '%')
      order by greatest(coalesce(current_price_observed_at, created_at), coalesce(coupon_observed_at, created_at)) desc nulls last
      limit $4
    `;
    const lis = await client.query(listingsSql, [q, maybeUpc, q, limit, maybeSku]);
    const listings = lis.rows;

    // 2) Bridge: pick the best listing match and extract PCI/UPC
    const best = listings[0] || null;
    const bridgePci = best?.pci || null;
    const bridgeUpc = best?.upc || null;

    let bridge = null;
    let catalogRows = [];

    // 3) If we have PCI/UPC, prefer PCI, then resolve model_number, then return all variants by model_number
    if (bridgePci || bridgeUpc) {
      // Resolve model_number
      const anchor = await client.query(
        `
        select id, pci, upc, model_number, model_name, brand, category, version, color, image_url, created_at
        from public.catalog
        where
          ($1::text is not null and upper(btrim(pci)) = upper(btrim($1)))
          or ($2::text is not null and regexp_replace(coalesce(upc,''), '[^0-9]', '', 'g') = regexp_replace(coalesce($2::text,''), '[^0-9]', '', 'g'))
        order by
          (case when $1::text is not null and upper(btrim(pci)) = upper(btrim($1)) then 0 else 1 end),
          created_at desc nulls last
        limit 1
        `,
        [bridgePci, bridgeUpc]
      );

      const anchorRow = anchor.rows[0] || null;
      const modelNumber = anchorRow?.model_number || null;

      if (modelNumber) {
        const variants = await client.query(
          `
          select id, pci, upc, model_number, model_name, brand, category, version, color, image_url, created_at
          from public.catalog
          where model_number = $1
          order by
            lower(btrim(version)) nulls last,
            lower(btrim(color)) nulls last,
            created_at desc nulls last
          limit 200
          `,
          [modelNumber]
        );
        catalogRows = variants.rows;
      } else {
        // fallback: at least return the anchor match if any
        catalogRows = anchor.rows;
      }

      bridge = {
        input: q,
        matched_listing: best ? { id: best.id, store: best.store, store_sku: best.store_sku } : null,
        pci: bridgePci,
        upc: bridgeUpc,
        model_number: modelNumber,
      };
    } else {
      // 4) No bridge possible: do normal catalog text search so you still get results for brand/model
      const catalogSql = `
        select
          id, pci, upc, model_number, model_name, brand, category, version, color, image_url,
          created_at
        from public.catalog
        where
          ($1::text is not null and upper(btrim(pci)) = upper(btrim($1)))
          or ($2::text is not null and regexp_replace(coalesce(upc,''), '[^0-9]', '', 'g') = regexp_replace(coalesce($2::text,''), '[^0-9]', '', 'g'))
          or (model_number ilike '%' || $3 || '%')
          or (model_name ilike '%' || $3 || '%')
          or (brand ilike '%' || $3 || '%')
          or (category ilike '%' || $3 || '%')
          or (version ilike '%' || $3 || '%')
          or (color ilike '%' || $3 || '%')
        order by created_at desc nulls last
        limit $4
      `;
      const cat = await client.query(catalogSql, [q, maybeUpc, q, limit]);
      catalogRows = cat.rows;
    }

    res.json({
      q,
      bridge,
      catalog: catalogRows,
      listings,
    });
  } catch (err) {
    console.error("admin search error", err);
    res.status(500).json({ error: "admin_search_failed" });
  } finally {
    client.release();
  }
});

// -------------------------
// Admin API: item view (WITH bridging)
// -------------------------
router.get("/admin/api/item", async (req, res) => {
  const pci = normKey(req.query.pci);
  const upc = normKey(req.query.upc);
  const asin = normKey(req.query.asin); // treat as generic store_sku too

  if (!pci && !upc && !asin) {
    return res.status(400).json({ error: "missing_key", hint: "Provide pci= or upc= or asin=" });
  }

  const client = await pool.connect();
  try {
    // 1) Find anchor in catalog (PCI or UPC)
    const anchorCatalog = await client.query(
      `
      select *
      from public.catalog
      where
        ($1::text is not null and upper(btrim(pci)) = upper(btrim($1)))
        or ($2::text is not null and regexp_replace(coalesce(upc,''), '[^0-9]', '', 'g') = regexp_replace(coalesce($2::text,''), '[^0-9]', '', 'g'))
      order by
        (case when $1::text is not null and upper(btrim(pci)) = upper(btrim($1)) then 0 else 1 end),
        created_at desc nulls last
      limit 1
      `,
      [pci, upc]
    );

    // 2) If no catalog anchor, infer PCI/UPC from listings using store_sku (asin param)
    let inferred = { pci: null, upc: null };
    if (anchorCatalog.rows.length === 0) {
      const fromListings = await client.query(
        `
        select pci, upc
        from public.listings
        where
          ($1::text is not null and upper(btrim(pci)) = upper(btrim($1)))
          or ($2::text is not null and regexp_replace(coalesce(upc,''), '[^0-9]', '', 'g') = regexp_replace(coalesce($2::text,''), '[^0-9]', '', 'g'))
          or ($3::text is not null and upper(regexp_replace(coalesce(store_sku,''), '[^0-9A-Za-z]', '', 'g')) = upper(regexp_replace(coalesce($3::text,''), '[^0-9A-Za-z]', '', 'g')))
        order by greatest(coalesce(current_price_observed_at, created_at), coalesce(coupon_observed_at, created_at)) desc nulls last
        limit 1
        `,
        [pci, upc, asin]
      );
      if (fromListings.rows[0]) {
        inferred = { pci: fromListings.rows[0].pci || null, upc: fromListings.rows[0].upc || null };
      }
    }

    const keyPci = pci || inferred.pci;
    const keyUpc = upc || inferred.upc;

    // 3) Load variants by model_number when possible
    let variants = [];
    let modelNumber = null;

    if (anchorCatalog.rows[0]?.model_number) {
      modelNumber = anchorCatalog.rows[0].model_number;
      const v = await client.query(
        `
        select id, pci, upc, model_number, model_name, brand, category, version, color, image_url, recall_url, dropship_warning
        from public.catalog
        where model_number = $1
        order by
          lower(btrim(version)) nulls last,
          lower(btrim(color)) nulls last,
          created_at desc nulls last
        `,
        [modelNumber]
      );
      variants = v.rows;
    } else if (keyPci || keyUpc) {
      const v = await client.query(
        `
        select id, pci, upc, model_number, model_name, brand, category, version, color, image_url, recall_url, dropship_warning
        from public.catalog
        where
          ($1::text is not null and upper(btrim(pci)) = upper(btrim($1)))
          or ($2::text is not null and regexp_replace(coalesce(upc,''), '[^0-9]', '', 'g') = regexp_replace(coalesce($2::text,''), '[^0-9]', '', 'g'))
        order by created_at desc nulls last
        limit 50
        `,
        [keyPci, keyUpc]
      );
      variants = v.rows;
      modelNumber = variants[0]?.model_number || null;
    }

  // 4) Load offers by PCI/UPC (ONLY fall back to store_sku when pci/upc are missing)
        const skuFallback = (!keyPci && !keyUpc) ? asin : null;

        const offers = await client.query(
        `
        select
            id, store, store_sku, pci, upc, title, url, status, offer_tag,
            current_price_cents, current_price_observed_at,
            coupon_text, coupon_type, coupon_value_cents, coupon_value_pct,
            coupon_requires_clip, coupon_code, coupon_expires_at,
            effective_price_cents, coupon_observed_at,
            created_at
        from public.listings
        where
            ($1::text is not null and upper(btrim(pci)) = upper(btrim($1)))
            or ($2::text is not null and regexp_replace(coalesce(upc,''), '[^0-9]', '', 'g') = regexp_replace(coalesce($2::text,''), '[^0-9]', '', 'g'))
            or ($3::text is not null and upper(regexp_replace(coalesce(store_sku,''), '[^0-9A-Za-z]', '', 'g')) = upper(regexp_replace(coalesce($3::text,''), '[^0-9A-Za-z]', '', 'g')))
        order by greatest(coalesce(current_price_observed_at, created_at), coalesce(coupon_observed_at, created_at)) desc nulls last
        limit 200
        `,
        [keyPci, keyUpc, skuFallback]
        );

    // 5) Gaps
    const now = Date.now();
    const gaps = {
      missing_catalog: anchorCatalog.rows.length === 0 && variants.length === 0,
      missing_pci: !keyPci,
      missing_upc: !keyUpc,
      offers_by_store: {},
      stale_offers: [],
      coupon_missing: [],
    };

    for (const o of offers.rows) {
      const storeKey = String(o.store || "").trim() || "Unknown";
      gaps.offers_by_store[storeKey] = (gaps.offers_by_store[storeKey] || 0) + 1;

      const t = new Date(o.current_price_observed_at || o.coupon_observed_at || o.created_at || 0).getTime();
      if (t && now - t > 1000 * 60 * 60 * 24 * 7) {
        gaps.stale_offers.push({ store: storeKey, store_sku: o.store_sku, t });
      }

      if (!o.coupon_text && !o.coupon_type && !o.coupon_value_cents && !o.coupon_value_pct) {
        gaps.coupon_missing.push({ store: storeKey, store_sku: o.store_sku });
      }
    }

    res.json({
      key: { pci: keyPci || null, upc: keyUpc || null, asin: asin || null, model_number: modelNumber || null },
      anchor_catalog: anchorCatalog.rows[0] || null,
      variants,
      offers: offers.rows,
      gaps,
    });
  } catch (err) {
    console.error("admin item error", err);
    res.status(500).json({ error: "admin_item_failed" });
  } finally {
    client.release();
  }
});

module.exports = router;