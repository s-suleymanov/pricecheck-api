// routes/uninstall.js
const express = require("express");
const { Pool } = require("pg");

const router = express.Router();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSLMODE === "disable" ? false : { rejectUnauthorized: false },
});

// POST /api/uninstall_feedback
router.post("/api/uninstall_feedback", async (req, res) => {
  try {
    const body = req.body || {};
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    const details = typeof body.details === "string" ? body.details : "";
    const meta = body.meta || {};

    if (!reason) return res.status(400).json({ ok: false, error: "reason_required" });

    const v = typeof meta.v === "string" ? meta.v : null;
    const utm_source = typeof meta.utm_source === "string" ? meta.utm_source : null;
    const utm_medium = typeof meta.utm_medium === "string" ? meta.utm_medium : null;
    const utm_campaign = typeof meta.utm_campaign === "string" ? meta.utm_campaign : null;
    const user_agent =
      (typeof meta.ua === "string" && meta.ua) ||
      req.headers["user-agent"] ||
      null;

    await pool.query(
      `insert into public.uninstall_feedback
       (reason, details, v, utm_source, utm_medium, utm_campaign, user_agent)
       values ($1,$2,$3,$4,$5,$6,$7)`,
      [
        reason.slice(0, 80),
        details.slice(0, 4000),
        v,
        utm_source,
        utm_medium,
        utm_campaign,
        String(user_agent || "").slice(0, 600),
      ]
    );

    return res.json({ ok: true });
  } catch (e) {
    console.log("[uninstall_feedback] error", String(e));
    return res.status(500).json({ ok: false, error: "server_error" });
  }
});

module.exports = router;