// routes/seller.js
const path = require("path");
const fs = require("fs");
const express = require("express");

const router = express.Router();

const SELLER_HTML = path.join(__dirname, "..", "public", "seller", "index.html");
const BRAND_INFO_JSON = path.join(__dirname, "..", "public", "data", "brand_info.json");

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

let _brandInfoCache = null;
let _brandInfoMtimeMs = 0;

function loadBrandInfoMap() {
  try {
    const st = fs.statSync(BRAND_INFO_JSON);
    const mtime = Number(st.mtimeMs || 0);

    if (!_brandInfoCache || mtime !== _brandInfoMtimeMs) {
      const txt = fs.readFileSync(BRAND_INFO_JSON, "utf8");
      const parsed = txt ? JSON.parse(txt) : {};
      _brandInfoCache = parsed && typeof parsed === "object" ? parsed : {};
      _brandInfoMtimeMs = mtime;
    }

    return _brandInfoCache || {};
  } catch (_e) {
    return {};
  }
}

// Page routes (SPA style)
router.get("/seller", (_req, res) => res.redirect(301, "/seller/"));
router.get("/seller/", (_req, res) => res.sendFile(SELLER_HTML));
router.get("/seller/*", (_req, res) => res.sendFile(SELLER_HTML));

// API: GET /api/seller?name=Apple
router.get("/api/seller", (req, res) => {
  const name = normText(req.query.name);
  if (!name) return res.status(400).json({ ok: false, error: "name is required" });

  const key = name.toLowerCase();
  const map = loadBrandInfoMap();
  const raw = map && typeof map === "object" ? map[key] : null;

  if (!raw || typeof raw !== "object") {
    return res.json({ ok: true, name, found: false, info: null });
  }

  const typeTxt = normText(raw.type || raw.Type || "");
  const originTxt = normText(raw.origin || "");
  const ownedByTxt = normText(raw.owned_by || "");
  const officialUrl = normalizeExternalUrl(raw.url || "");

  return res.json({
    ok: true,
    name,
    found: true,
    info: {
      type: typeTxt,
      origin: originTxt,
      owned_by: ownedByTxt,
      official_url: officialUrl,
    },
  });
});

module.exports = router;
