// routes/admin.js
const path = require("path");
const express = require("express");
const crypto = require("crypto");
const { Pool } = require("pg");

const router = express.Router();

// JSON for login + API
router.use(express.json({ limit: "1mb" }));

// -------------------------
// DB
// -------------------------
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSLMODE === "disable" ? false : { rejectUnauthorized: false },
});

// -------------------------
// Admin session cookie auth
// -------------------------
const COOKIE_NAME = "pc_admin";
const COOKIE_MAX_AGE_MS = 1000 * 60 * 60 * 12; // 12 hours

function base64urlEncode(buf) {
  return Buffer.from(buf)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function base64urlDecodeToString(s) {
  s = String(s || "").replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  return Buffer.from(s, "base64").toString("utf8");
}

function parseCookies(req) {
  const h = String(req.headers.cookie || "");
  const out = {};
  h.split(";").forEach((part) => {
    const idx = part.indexOf("=");
    if (idx < 0) return;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = v;
  });
  return out;
}

function signToken(payloadB64, secret) {
  return base64urlEncode(
    crypto.createHmac("sha256", secret).update(payloadB64).digest()
  );
}

function makeSessionToken(secret, user) {
  const payload = { u: String(user || "admin"), iat: Date.now() };
  const payloadB64 = base64urlEncode(JSON.stringify(payload));
  const sig = signToken(payloadB64, secret);
  return `${payloadB64}.${sig}`;
}

function verifySessionToken(secret, token) {
  const t = String(token || "");
  const dot = t.lastIndexOf(".");
  if (dot < 0) return null;

  const payloadB64 = t.slice(0, dot);
  const sig = t.slice(dot + 1);

  const want = signToken(payloadB64, secret);

  // timingSafeEqual requires same length
  if (sig.length !== want.length) return null;

  const ok = crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want));
  if (!ok) return null;

  let payload = null;
  try {
    payload = JSON.parse(base64urlDecodeToString(payloadB64));
  } catch {
    return null;
  }

  const iat = Number(payload?.iat || 0);
  if (!Number.isFinite(iat)) return null;
  if (Date.now() - iat > COOKIE_MAX_AGE_MS) return null;

  return payload;
}

function isHttps(req) {
  const xf = String(req.headers["x-forwarded-proto"] || "");
  return xf === "https" || req.secure === true;
}

function adminSecret() {
  const user = String(process.env.ADMIN_USER || "").trim();
  const pass = String(process.env.ADMIN_PASS || "").trim();

  // Do not accidentally expose admin
  if (!user || !pass) return null;

  return String(process.env.ADMIN_SECRET || `${user}:${pass}`).trim();
}

function requireAdminUi(req, res, next) {
  const secret = adminSecret();
  if (!secret) return res.status(500).send("Admin auth not configured");

  const cookies = parseCookies(req);
  const tok = cookies[COOKIE_NAME];
  const ok = verifySessionToken(secret, tok);
  if (!ok) return res.redirect(302, "/admin/login");

  req.admin = ok;
  next();
}

function requireAdminApi(req, res, next) {
  const secret = adminSecret();
  if (!secret) return res.status(500).json({ error: "admin_auth_not_configured" });

  const cookies = parseCookies(req);
  const tok = cookies[COOKIE_NAME];
  const ok = verifySessionToken(secret, tok);
  if (!ok) return res.status(401).json({ error: "admin_required" });

  req.admin = ok;
  next();
}

// Bulk imports should not guess store names.
// Preserve exactly what you typed (after trim).
function canonicalManufacturerStore(store) {
  const s = String(store || "").trim();
  return s ? s : null;
}

function parseBoolLoose(x) {
  if (x === true || x === false) return x;
  const s = String(x == null ? "" : x).trim().toLowerCase();
  if (!s) return null;
  if (s === "true" || s === "t" || s === "1" || s === "yes" || s === "y") return true;
  if (s === "false" || s === "f" || s === "0" || s === "no" || s === "n") return false;
  return null;
}

// -------------------------
// Helpers (existing admin DB manager helpers)
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
// Bulk import (auth gated)
// -------------------------
router.post("/admin/api/bulk", requireAdminApi, async (req, res) => {
  const options = req.body?.options || {};
  const doCatalog = !!options.doCatalog;
  const doListings = !!options.doListings;
  const doHistory = !!options.doHistory;

  const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
  if (!rows.length) return res.status(400).json({ error: "no_rows" });
  if (rows.length > 500) {
    return res.status(400).json({ error: "too_many_rows", hint: "Max 500 rows per import" });
  }
  if (!doCatalog && !doListings && !doHistory) {
    return res.status(400).json({ error: "no_actions_selected" });
  }

  let catalog_upserts = 0;
  let listing_upserts = 0;
  let history_inserts = 0;
  const errors = [];

  const client = await pool.connect();
  try {
    await client.query("begin");

    for (const r of rows) {
      const line = Number(r.__line) || 0;

      const pci = normalizeEmpty(r.pci);
      const upc = normalizeEmpty(r.upc);

      // ---------- CATALOG UPSERT ----------
      if (doCatalog) {
        const brand = normalizeEmpty(r.brand);
        const category = normalizeEmpty(r.category);
        const model_number = normalizeEmpty(r.model_number);
        const model_name = normalizeEmpty(r.model_name);
        const version = normalizeEmpty(r.version);
        const color = normalizeEmpty(r.color);
        const image_url = normalizeEmpty(r.image_url);
        const recall_url = normalizeEmpty(r.recall_url);

        const dropship_warning = parseBoolLoose(r.dropship_warning);
        const coverage_warning = parseBoolLoose(r.coverage_warning);

        const hasAnyCatalogField =
          pci ||
          upc ||
          brand ||
          category ||
          model_number ||
          model_name ||
          version ||
          color ||
          image_url ||
          recall_url ||
          dropship_warning != null ||
          coverage_warning != null;

        if (hasAnyCatalogField) {
          try {
            let existingId = null;

            // Prefer matching by normalized UPC when present
            if (upc) {
              const find = await client.query(
                `select id
                 from public.catalog
                 where norm_upc(upc) = norm_upc($1)
                 order by created_at desc nulls last
                 limit 1`,
                [upc]
              );
              existingId = find.rows[0]?.id || null;
            }

            // Fallback: match by PCI if UPC missing
            if (!existingId && pci) {
              const find = await client.query(
                `select id
                 from public.catalog
                 where upper(btrim(pci)) = upper(btrim($1))
                 order by created_at desc nulls last
                 limit 1`,
                [pci]
              );
              existingId = find.rows[0]?.id || null;
            }

            if (existingId) {
              // Bulk safety: never write nulls, blank cells should not wipe existing data.
              const sets = [];
              const vals = [];
              let p = 1;

              function setIf(name, val) {
                if (val === undefined) return; // column not present
                if (val === null) return; // blank cell should not erase
                sets.push(`${name} = $${p++}`);
                vals.push(val);
              }

              setIf("pci", pci);
              setIf("upc", upc);
              setIf("brand", brand);
              setIf("category", category);
              setIf("model_number", model_number);
              setIf("model_name", model_name);
              setIf("version", version);
              setIf("color", color);
              setIf("image_url", image_url);
              setIf("recall_url", recall_url);

              if (dropship_warning != null) {
                sets.push(`dropship_warning = $${p++}`);
                vals.push(dropship_warning);
              }
              if (coverage_warning != null) {
                sets.push(`coverage_warning = $${p++}`);
                vals.push(coverage_warning);
              }

              if (sets.length) {
                vals.push(existingId);
                await client.query(
                  `update public.catalog set ${sets.join(", ")} where id = $${p}`,
                  vals
                );
                catalog_upserts++;
              }
            } else {
              await client.query(
                `
                insert into public.catalog
                  (pci, upc, brand, category, model_number, model_name, version, color, image_url, recall_url, dropship_warning, coverage_warning)
                values
                  ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, coalesce($11,false), coalesce($12,false))
                `,
                [
                  pci,
                  upc,
                  brand,
                  category,
                  model_number,
                  model_name,
                  version,
                  color,
                  image_url,
                  recall_url,
                  dropship_warning,
                  coverage_warning,
                ]
              );
              catalog_upserts++;
            }
          } catch (e) {
            errors.push({ line, error: "catalog_failed" });
          }
        }
      }

      // ---------- LISTINGS UPSERT ----------
      if (doListings) {
        const store = canonicalManufacturerStore(r.store);
        const store_sku = normalizeEmpty(r.store_sku);

        if (!store || !store_sku) {
          errors.push({ line, error: "missing_store_or_store_sku" });
        } else {
          const title = normalizeEmpty(r.title);
          const url = normalizeEmpty(r.url);
          const status = normalizeEmpty(r.status) || "active";
          const offer_tag = normalizeEmpty(r.offer_tag);

          const rawPrice = r.current_price_cents;
          const current_price_cents =
            rawPrice == null || String(rawPrice).trim() === ""
              ? null
              : Number.isFinite(Number(rawPrice))
                ? Math.trunc(Number(rawPrice))
                : null;

          try {
            const now = new Date().toISOString();

            await client.query(
              `
              insert into public.listings
                (store, store_sku, pci, upc, title, url, status, offer_tag, current_price_cents, current_price_observed_at)
              values
                ($1,$2,$3,$4,$5,$6,$7,$8,$9, case when $9 is null then null else $10::timestamptz end)
              on conflict (store, store_sku)
              do update set
                pci = coalesce(excluded.pci, public.listings.pci),
                upc = coalesce(excluded.upc, public.listings.upc),
                title = coalesce(excluded.title, public.listings.title),
                url = coalesce(excluded.url, public.listings.url),
                status = coalesce(excluded.status, public.listings.status),
                offer_tag = coalesce(excluded.offer_tag, public.listings.offer_tag),
                current_price_cents = coalesce(excluded.current_price_cents, public.listings.current_price_cents),
                current_price_observed_at =
                  case
                    when excluded.current_price_cents is null then public.listings.current_price_observed_at
                    else greatest(
                      coalesce(public.listings.current_price_observed_at, 'epoch'::timestamptz),
                      excluded.current_price_observed_at
                    )
                  end
              `,
              [store, store_sku, pci, upc, title, url, status, offer_tag, current_price_cents, now]
            );

            listing_upserts++;
          } catch (e) {
            errors.push({ line, error: "listing_failed" });
          }
        }
      }

      // ---------- PRICE HISTORY (OPTIONAL) ----------
      if (doHistory) {
        const store = canonicalManufacturerStore(r.store);
        const store_sku = normalizeEmpty(r.store_sku);

        const rawPrice = r.current_price_cents;
        const price_cents =
          rawPrice == null || String(rawPrice).trim() === ""
            ? null
            : Number.isFinite(Number(rawPrice))
              ? Math.trunc(Number(rawPrice))
              : null;

        if (store && store_sku && Number.isFinite(price_cents)) {
          try {
            await client.query(
              `
              insert into public.price_history
                (store, store_sku, price_cents, observed_at, pci, upc)
              values
                ($1,$2,$3, now(), $4, $5)
              `,
              [store, store_sku, price_cents, pci, upc]
            );
            history_inserts++;
          } catch (e) {
            errors.push({ line, error: "history_failed" });
          }
        }
      }
    }

    await client.query("commit");
    res.json({ ok: true, catalog_upserts, listing_upserts, history_inserts, errors });
  } catch (err) {
    try {
      await client.query("rollback");
    } catch {}
    console.error("admin bulk error", err);
    res.status(500).json({ error: "bulk_failed" });
  } finally {
    client.release();
  }
});

// -------------------------
// Static files (no auth gate here)
// We gate pages with route handlers below.
// -------------------------
router.use(
  "/admin",
  express.static(path.join(__dirname, "..", "public", "admin"), { index: false })
);

// Convenience: /admin -> /admin/
router.get("/admin", (req, res) => res.redirect(302, "/admin/"));

router.get("/admin/bulk", requireAdminUi, (req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "admin", "bulk.html"));
});

// -------------------------
// Login / Logout
// -------------------------
router.get("/admin/login", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "admin", "login.html"));
});

router.post("/admin/api/login", async (req, res) => {
  const user = String(process.env.ADMIN_USER || "").trim();
  const pass = String(process.env.ADMIN_PASS || "").trim();
  const secret = adminSecret();

  if (!secret) return res.status(500).json({ error: "admin_auth_not_configured" });

  const u = String(req.body?.user || "").trim();
  const p = String(req.body?.pass || "").trim();

  if (!u || !p) return res.status(400).json({ error: "missing_fields" });
  if (u !== user || p !== pass) return res.status(401).json({ error: "invalid_login" });

  const token = makeSessionToken(secret, u);

  const secure = isHttps(req);
  const parts = [
    `${COOKIE_NAME}=${token}`,
    "Path=/admin",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.floor(COOKIE_MAX_AGE_MS / 1000)}`,
  ];
  if (secure) parts.push("Secure");

  res.setHeader("Set-Cookie", parts.join("; "));
  res.json({ ok: true });
});

router.post("/admin/api/logout", (req, res) => {
  const secure = isHttps(req);
  const parts = [
    `${COOKIE_NAME}=`,
    "Path=/admin",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
  ];
  if (secure) parts.push("Secure");

  res.setHeader("Set-Cookie", parts.join("; "));
  res.json({ ok: true });
});

// -------------------------
// UI pages (auth gated)
// -------------------------
router.get("/admin/", requireAdminUi, (req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "admin", "index.html"));
});

router.get("/admin/support", requireAdminUi, (req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "admin", "support.html"));
});

router.get("/admin/db", requireAdminUi, (req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "admin", "db.html"));
});

// -------------------------
// Admin API: DB manager (auth gated)
// -------------------------
router.patch("/admin/api/catalog/:id", requireAdminApi, async (req, res) => {
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

// -------------------------
// Admin API: DB Manager (grouped rows)
// One "row" per catalog item, offers grouped by store
// -------------------------
router.get("/admin/api/db/items", requireAdminApi, async (req, res) => {
  const qRaw = normKey(req.query.q);
  const limit = Math.min(Math.max(toInt(req.query.limit) || 25, 1), 50);
  const offset = Math.max(0, Math.min(toInt(req.query.offset) || 0, 500));

  const q = (qRaw || "").trim();
  const qDigits = q.replace(/[^\d]/g, "");
  const qAlnum = q.replace(/[^0-9A-Za-z]/g, "");

  const maybeUpc =
    qDigits.length === 12 || (qDigits.length === 13 && qDigits.startsWith("0"))
      ? qDigits
      : null;

  const maybePci = qAlnum.length >= 6 ? qAlnum.toUpperCase() : null;
  const maybeSku = qAlnum.length ? qAlnum.toUpperCase() : null;

  const client = await pool.connect();
  try {
    const seedSql = `
      with direct as (
        select c.*
        from public.catalog c
        where
          ($1::text is not null and upper(btrim(c.pci)) = upper(btrim($1)))
          or ($2::text is not null and norm_upc(c.upc) = norm_upc($2))
          or (coalesce(c.model_number,'') ilike '%' || $3 || '%')
          or (coalesce(c.model_name,'') ilike '%' || $3 || '%')
          or (coalesce(c.brand,'') ilike '%' || $3 || '%')
          or (coalesce(c.category,'') ilike '%' || $3 || '%')
          or (coalesce(c.version,'') ilike '%' || $3 || '%')
          or (coalesce(c.color,'') ilike '%' || $3 || '%')
        order by c.created_at desc nulls last
        limit $4 offset $5
      ),
      from_listings as (
        select distinct on (c2.id) c2.*
        from public.listings l
        join lateral (
          select c.*
          from public.catalog c
          where
            (l.pci is not null and c.pci is not null and upper(btrim(c.pci)) = upper(btrim(l.pci)))
            or (l.upc is not null and c.upc is not null and norm_upc(c.upc) = norm_upc(l.upc))
          order by
            (case when l.pci is not null and c.pci is not null and upper(btrim(c.pci)) = upper(btrim(l.pci)) then 0 else 1 end),
            c.created_at desc nulls last
          limit 1
        ) c2 on true
        where
          ($6::text is not null and upper(regexp_replace(coalesce(l.store_sku,''), '[^0-9A-Za-z]', '', 'g')) = upper(regexp_replace(coalesce($6::text,''), '[^0-9A-Za-z]', '', 'g')))
          or (coalesce(l.store_sku,'') ilike '%' || $3 || '%')
          or (coalesce(l.title,'') ilike '%' || $3 || '%')
          or (coalesce(l.store,'') ilike '%' || $3 || '%')
          or ($1::text is not null and upper(btrim(l.pci)) = upper(btrim($1)))
          or ($2::text is not null and norm_upc(l.upc) = norm_upc($2))
        order by c2.id, greatest(coalesce(l.current_price_observed_at, l.created_at), coalesce(l.coupon_observed_at, l.created_at)) desc nulls last
        limit $4 offset $5
      )
      select * from direct
      union
      select * from from_listings
      order by created_at desc nulls last
      limit $4 offset $5
    `;

    const q3 = q || "";
    const seed = await client.query(seedSql, [maybePci, maybeUpc, q3, limit, offset, maybeSku]);

    const catalogs = seed.rows || [];
    if (!catalogs.length) return res.json({ q, items: [] });

    const pcis = [];
    const upcs = [];
    for (const c of catalogs) {
      if (c.pci && String(c.pci).trim()) pcis.push(String(c.pci).trim());
      if (c.upc && String(c.upc).trim()) upcs.push(String(c.upc).trim());
    }

    let offers = [];
    if (pcis.length || upcs.length) {
      const offersSql = `
        select
          id, store, store_sku, pci, upc, title, url, status, offer_tag,
          current_price_cents, current_price_observed_at,
          coupon_text, coupon_type, coupon_value_cents, coupon_value_pct,
          coupon_requires_clip, coupon_code, coupon_expires_at,
          effective_price_cents, coupon_observed_at,
          created_at
        from public.listings
        where
          ($1::text[] is not null and array_length($1::text[], 1) > 0 and upper(btrim(pci)) = any (select upper(btrim(x)) from unnest($1::text[]) x))
          or ($2::text[] is not null and array_length($2::text[], 1) > 0 and norm_upc(upc) = any (select norm_upc(x) from unnest($2::text[]) x))
        order by greatest(coalesce(current_price_observed_at, created_at), coalesce(coupon_observed_at, created_at)) desc nulls last
        limit 2000
      `;
      const r = await client.query(offersSql, [pcis.length ? pcis : null, upcs.length ? upcs : null]);
      offers = r.rows || [];
    }

    const byCatalogId = new Map();
    for (const c of catalogs) {
      byCatalogId.set(c.id, { catalog: c, offers_by_store: {} });
    }

    function normStore(s) {
      return String(s || "").trim() || "Unknown";
    }
    function samePci(a, b) {
      const A = String(a || "").trim().toUpperCase();
      const B = String(b || "").trim().toUpperCase();
      return A && B && A === B;
    }
    function normUpcLocal(x) {
      const raw = String(x || "").replace(/[^\d]/g, "");
      if (!raw) return "";
      if (raw.length === 13 && raw.startsWith("0")) return raw.slice(1);
      return raw;
    }

    for (const o of offers) {
      let matchedId = null;

      if (o.pci) {
        for (const c of catalogs) {
          if (samePci(o.pci, c.pci)) {
            matchedId = c.id;
            break;
          }
        }
      }

      if (!matchedId && o.upc) {
        const ou = normUpcLocal(o.upc);
        if (ou) {
          for (const c of catalogs) {
            const cu = normUpcLocal(c.upc);
            if (cu && cu === ou) {
              matchedId = c.id;
              break;
            }
          }
        }
      }

      if (!matchedId) continue;

      const item = byCatalogId.get(matchedId);
      if (!item) continue;

      const sk = normStore(o.store);
      if (!item.offers_by_store[sk]) item.offers_by_store[sk] = [];
      item.offers_by_store[sk].push(o);
    }

    const items = catalogs.map((c) => byCatalogId.get(c.id)).filter(Boolean);
    res.json({ q, items });
  } catch (err) {
    console.error("admin db items error", err);
    res.status(500).json({ error: "admin_db_items_failed" });
  } finally {
    client.release();
  }
});

router.post("/admin/api/db/price_history", requireAdminApi, async (req, res) => {
  const store = String(req.body?.store || "").trim();
  const store_sku = String(req.body?.store_sku || "").trim();
  const price_cents = Number(req.body?.price_cents);

  if (!store || !store_sku) return res.status(400).json({ error: "missing_store_or_sku" });
  if (!Number.isFinite(price_cents)) return res.status(400).json({ error: "missing_price_cents" });

  const observed_at = req.body?.observed_at ? new Date(req.body.observed_at) : null;
  const oa = observed_at && Number.isFinite(observed_at.getTime()) ? observed_at.toISOString() : null;

  const payload = {
    store,
    store_sku,
    price_cents: Math.trunc(price_cents),

    pci: normalizeEmpty(req.body?.pci),
    upc: normalizeEmpty(req.body?.upc),

    coupon_text: normalizeEmpty(req.body?.coupon_text),
    coupon_value_cents:
      req.body?.coupon_value_cents == null ? null : Math.trunc(Number(req.body.coupon_value_cents) || 0),
    coupon_value_pct: req.body?.coupon_value_pct == null ? null : Number(req.body.coupon_value_pct),
    effective_price_cents:
      req.body?.effective_price_cents == null ? null : Math.trunc(Number(req.body.effective_price_cents) || 0),

    observed_at: oa,
  };

  const sql = `
    insert into public.price_history
      (store, store_sku, price_cents, observed_at, pci, upc, coupon_text, coupon_value_cents, coupon_value_pct, effective_price_cents)
    values
      ($1,$2,$3,coalesce($4::timestamptz, now()), $5,$6,$7,$8,$9,$10)
    returning *
  `;

  try {
    const r = await pool.query(sql, [
      payload.store,
      payload.store_sku,
      payload.price_cents,
      payload.observed_at,
      payload.pci,
      payload.upc,
      payload.coupon_text,
      payload.coupon_value_cents,
      payload.coupon_value_pct,
      payload.effective_price_cents,
    ]);
    res.json({ ok: true, row: r.rows[0] });
  } catch (e) {
    console.error("admin price_history insert error", e);
    res.status(500).json({ error: "price_history_insert_failed" });
  }
});

router.patch("/admin/api/listing/:id", requireAdminApi, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "bad_id" });

  const body = req.body || {};
  const allowed = [
    "pci",
    "upc",
    "title",
    "url",
    "status",
    "offer_tag",

    // price fields
    "current_price_cents",
    "current_price_observed_at",

    // coupon fields
    "coupon_text",
    "coupon_type",
    "coupon_value_cents",
    "coupon_value_pct",
    "coupon_requires_clip",
    "coupon_code",
    "coupon_expires_at",
    "effective_price_cents",
    "coupon_observed_at",
  ];

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

router.get("/admin/api/search", requireAdminApi, async (req, res) => {
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

  const maybeSku = qAlnum.length ? qAlnum.toUpperCase() : null;

  const client = await pool.connect();
  try {
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

    const best = listings[0] || null;
    const bridgePci = best?.pci || null;
    const bridgeUpc = best?.upc || null;

    let bridge = null;
    let catalogRows = [];

    if (bridgePci || bridgeUpc) {
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
      const catalogSql = `
        select
          id, pci, upc, model_number, model_name, brand, category, version, color, image_url,
          created_at
        from public.catalog
        where
          ($1::text is not null and upper(btrim(pci)) = upper(btrim($1)))
          or ($2::text is not null and regexp_replace(coalesce(upc,''), '[^0-9]', '', 'g') = regexp_replace(coalesce($2::text,''), '[^0-9]', '', 'g'))
          or (coalesce(model_number,'') ilike '%' || $3 || '%')
          or (coalesce(model_name,'') ilike '%' || $3 || '%')
          or (coalesce(brand,'') ilike '%' || $3 || '%')
          or (coalesce(category,'') ilike '%' || $3 || '%')
          or (coalesce(version,'') ilike '%' || $3 || '%')
          or (coalesce(color,'') ilike '%' || $3 || '%')
        order by created_at desc nulls last
        limit $4
      `;
      const cat = await client.query(catalogSql, [q, maybeUpc, q, limit]);
      catalogRows = cat.rows;
    }

    res.json({ q, bridge, catalog: catalogRows, listings });
  } catch (err) {
    console.error("admin search error", err);
    res.status(500).json({ error: "admin_search_failed" });
  } finally {
    client.release();
  }
});

router.get("/admin/api/item", requireAdminApi, async (req, res) => {
  const pci = normKey(req.query.pci);
  const upc = normKey(req.query.upc);
  const asin = normKey(req.query.asin);

  if (!pci && !upc && !asin) {
    return res.status(400).json({ error: "missing_key", hint: "Provide pci= or upc= or asin=" });
  }

  const client = await pool.connect();
  try {
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

    const skuFallback = !keyPci && !keyUpc ? asin : null;

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

// -------------------------
// Admin API: Support inbox moved under /admin
// -------------------------
function clampText(s, max) {
  s = String(s || "").trim();
  if (!s) return "";
  return s.length > max ? s.slice(0, max) : s;
}

function allowedStatus(s) {
  return new Set(["open", "investigating", "planned", "fixed", "closed"]).has(s);
}

router.get("/admin/api/support/health", requireAdminApi, (req, res) => {
  res.json({ ok: true });
});

router.get("/admin/api/support/issues", requireAdminApi, async (req, res) => {
  const sort = String(req.query.sort || "new"); // new | top
  let status = String(req.query.status || "all"); // all | open | ...
  if (status !== "all" && !allowedStatus(status)) status = "all";

  const q = clampText(req.query.q || "", 200);
  const limit = Math.max(1, Math.min(Number(req.query.limit || 80), 100));
  const offset = Math.max(0, Math.min(Number(req.query.offset || 0), 2000));

  const where = [];
  const params = [];
  let p = 1;

  if (status && status !== "all") {
    where.push(`i.status = $${p++}`);
    params.push(status);
  }

  if (q) {
    where.push(`(i.title ilike $${p} or i.body ilike $${p})`);
    params.push(`%${q}%`);
    p++;
  }

  const whereSql = where.length ? `where ${where.join(" and ")}` : "";

  const orderSql =
    sort === "top"
      ? `order by coalesce(sum(v.vote), 0) desc, i.created_at desc`
      : `order by i.created_at desc`;

  const selectCols = `
    i.id, i.created_at, i.updated_at,
    i.title, i.body,
    i.category, i.status,
    i.is_public,
    i.reporter_email, i.source_url, i.app_version,
    i.user_agent, i.reporter_ip,
    coalesce(sum(v.vote), 0)::int as score
  `;

  const groupCols = `
    i.id, i.created_at, i.updated_at,
    i.title, i.body,
    i.category, i.status,
    i.is_public,
    i.reporter_email, i.source_url, i.app_version,
    i.user_agent, i.reporter_ip
  `;

  const sql = `
    select
      ${selectCols}
    from public.support_issues i
    left join public.support_votes v on v.issue_id = i.id
    ${whereSql}
    group by ${groupCols}
    ${orderSql}
    limit ${limit} offset ${offset}
  `;

  try {
    const r = await pool.query(sql, params);
    res.json({ issues: r.rows });
  } catch (e) {
    console.error("admin support list error", e);
    res.status(500).json({ error: "db_error" });
  }
});

router.patch("/admin/api/support/issues/:id", requireAdminApi, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "bad_id" });

  const status = clampText(req.body?.status, 20);
  const category = clampText(req.body?.category, 40);
  const is_public = req.body?.is_public;

  const fields = [];
  const params = [];
  let p = 1;

  if (status && allowedStatus(status)) {
    fields.push(`status = $${p++}`);
    params.push(status);
  }
  if (category) {
    fields.push(`category = $${p++}`);
    params.push(category);
  }
  if (typeof is_public === "boolean") {
    fields.push(`is_public = $${p++}`);
    params.push(is_public);
  }

  if (!fields.length) return res.status(400).json({ error: "no_changes" });

  params.push(id);

  try {
    const r = await pool.query(
      `
      update public.support_issues
      set ${fields.join(", ")}
      where id = $${p}
      returning *
      `,
      params
    );

    if (!r.rows[0]) return res.status(404).json({ error: "not_found" });

    res.json({ issue: r.rows[0] });
  } catch (e) {
    console.error("admin support patch error", e);
    res.status(500).json({ error: "db_error" });
  }
});

module.exports = router;