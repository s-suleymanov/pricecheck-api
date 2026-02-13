// routes/seller.js
const path = require("path");
const fs = require("fs");
const express = require("express");

const router = express.Router();

const SELLER_HTML = path.join(__dirname, "..", "public", "seller", "index.html");
const SELLERS_JSON = path.join(__dirname, "..", "public", "data", "sellers.json");

function normText(v) {
  return String(v ?? "").trim();
}

function normalizeExternalUrl(u) {
  let s = String(u ?? "").trim();
  if (!s) return "";
  if (s.startsWith("//")) s = "https:" + s;
  if (!/^https?:\/\//i.test(s)) s = "https://" + s;

  try {
    const url = new URL(s);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    return url.href;
  } catch {
    return "";
  }
}

function normalizeBool(v) {
  if (v === true || v === false) return v;
  const s = String(v ?? "").trim().toLowerCase();
  if (s === "true" || s === "yes" || s === "1") return true;
  if (s === "false" || s === "no" || s === "0") return false;
  return null;
}

function pickDefined(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) {
    if (v === undefined) continue;
    if (v === null) continue;
    if (typeof v === "string" && !v.trim()) continue;
    out[k] = v;
  }
  return out;
}

let _cache = null;
let _cacheMtimeMs = 0;

function loadSellersMap() {
  try {
    const st = fs.statSync(SELLERS_JSON);
    const mtime = Number(st.mtimeMs || 0);

    if (!_cache || mtime !== _cacheMtimeMs) {
      const txt = fs.readFileSync(SELLERS_JSON, "utf8");
      const parsed = txt ? JSON.parse(txt) : {};
      _cache = parsed && typeof parsed === "object" ? parsed : {};
      _cacheMtimeMs = mtime;
    }

    return _cache || {};
  } catch {
    return {};
  }
}

// Page routes (SPA style)
// /seller/ is not a browse/search page. Send to 404.
router.get("/seller", (_req, res) => res.redirect(301, "/seller/"));
router.get("/seller/", (_req, res) => res.redirect(302, "/404/"));
router.get("/seller/*", (_req, res) => res.sendFile(SELLER_HTML));

/*
API
- GET /api/seller?id=bestbuy   (id == slug == JSON key)
Returns ok:true always. Not found stays 200 with found:false so the client can 404 redirect.
*/
router.get("/api/seller", (req, res) => {
  const idRaw = normText(req.query.id);
  const id = idRaw.toLowerCase();

  // strict, but never 400: treat invalid as not found
  if (!id || !/^[a-z0-9_-]+$/.test(id)) {
    return res.json({ ok: true, found: false, seller: null });
  }

  const map = loadSellersMap();
  const raw = map[id];

  if (!raw || typeof raw !== "object") {
    return res.json({ ok: true, found: false, seller: null });
  }

  const seller = {};
  seller.name = normText(raw.name || "");
  seller.logo = normText(raw.logo || "");
  seller.website = normalizeExternalUrl(raw.website || raw.url || "");

  seller.owned_by = normText(raw.owned_by || raw.ownedBy || raw.owned || "");
  seller.type = normText(raw.type || "");
  seller.location = normText(raw.location || raw.origin || "");
  seller.founded =
    raw.founded === 0 ? 0 : (Number.isFinite(Number(raw.founded)) ? Number(raw.founded) : "");

  const policiesRaw = raw.policies && typeof raw.policies === "object" ? raw.policies : {};
  const policies = pickDefined({
    return_period: normText(policiesRaw.return_period || ""),
    restocking_fee: normText(policiesRaw.restocking_fee || ""),
    free_shipping_threshold: normText(policiesRaw.free_shipping_threshold || ""),
    price_match: normText(policiesRaw.price_match || ""),
  });

  const contactRaw = raw.contact && typeof raw.contact === "object" ? raw.contact : {};
  const contact = pickDefined({
    phone: normText(contactRaw.phone || ""),
    chat_available: normalizeBool(contactRaw.chat_available),
    support_page: normalizeExternalUrl(contactRaw.support_page || ""),
  });

  const out = pickDefined({
    name: seller.name,
    logo: seller.logo,
    website: seller.website,
    owned_by: seller.owned_by,
    type: seller.type,
    location: seller.location,
    founded: seller.founded,
  });

  if (Object.keys(policies).length) out.policies = policies;
  if (Object.keys(contact).length) out.contact = contact;

  return res.json({ ok: true, found: true, seller: out });
});

module.exports = router;