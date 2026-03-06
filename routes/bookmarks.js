const express = require("express");
const crypto  = require("crypto");
const pool    = require("../db");

const router = express.Router();

const SESSION_COOKIE_NAME  = "pc_session";
const MAX_BOOKMARKS_PER_USER = 500;

// ─── Auth helper (same pattern as follows/history) ────────────────────────────

function clean(v) { return String(v || "").trim(); }

function toPositiveInt(v) {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function hashSessionToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

async function getSignedInUserId(req) {
  const attached = toPositiveInt(req.user?.id) || toPositiveInt(req.authUser?.id);
  if (attached) return attached;

  const rawToken = clean(req.cookies?.[SESSION_COOKIE_NAME]);
  if (!rawToken) return null;

  const q = await pool.query(
    `SELECT u.id, s.id AS session_id
     FROM public.user_sessions s
     JOIN public.users u ON u.id = s.user_id
     WHERE s.session_token_hash = $1
       AND s.revoked_at IS NULL AND s.expires_at > now() AND u.is_active = true
     LIMIT 1`,
    [hashSessionToken(rawToken)]
  );

  const row = q.rows[0];
  if (!row) return null;
  pool.query(`UPDATE public.user_sessions SET last_seen_at = now() WHERE id = $1`, [row.session_id]).catch(() => {});
  return toPositiveInt(row.id);
}

// ─── GET /api/bookmarks ───────────────────────────────────────────────────────
// All bookmarks for the signed-in user, newest first.

router.get("/api/bookmarks", async (req, res) => {
  try {
    const userId = await getSignedInUserId(req);
    if (!userId) return res.json({ ok: true, signed_in: false, results: [] });

    const q = await pool.query(
      `SELECT id, entity_key, title, image_url, brand, created_at
       FROM public.user_bookmarks
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [userId, MAX_BOOKMARKS_PER_USER]
    );

    return res.json({ ok: true, signed_in: true, results: q.rows || [] });
  } catch (err) {
    console.error("GET /api/bookmarks failed:", err);
    return res.status(500).json({ ok: false, error: "Failed to load bookmarks." });
  }
});

// ─── GET /api/bookmarks/check?entity_key=X ───────────────────────────────────
// Check if a single product is bookmarked. Used by the dashboard button.

router.get("/api/bookmarks/check", async (req, res) => {
  const entityKey = clean(req.query.entity_key);
  if (!entityKey) return res.status(400).json({ ok: false, error: "entity_key required." });

  try {
    const userId = await getSignedInUserId(req);
    if (!userId) return res.json({ ok: true, signed_in: false, bookmarked: false });

    const q = await pool.query(
      `SELECT 1 FROM public.user_bookmarks WHERE user_id = $1 AND entity_key = $2 LIMIT 1`,
      [userId, entityKey]
    );

    return res.json({ ok: true, signed_in: true, bookmarked: q.rowCount > 0 });
  } catch (err) {
    console.error("GET /api/bookmarks/check failed:", err);
    return res.status(500).json({ ok: false, error: "Failed to check bookmark." });
  }
});

// ─── POST /api/bookmarks/toggle ──────────────────────────────────────────────
// Toggle bookmark on/off. Returns new state.
// Body: { entity_key, title, image_url?, brand? }

router.post("/api/bookmarks/toggle", async (req, res) => {
  const entityKey = clean(req.body?.entity_key);
  const title     = clean(req.body?.title) || "Product";
  const imageUrl  = clean(req.body?.image_url) || null;
  const brand     = clean(req.body?.brand) || null;

  if (!entityKey) return res.status(400).json({ ok: false, error: "entity_key required." });

  try {
    const userId = await getSignedInUserId(req);
    if (!userId) return res.status(401).json({ ok: false, error: "Sign in required." });

    // Check if already bookmarked
    const existing = await pool.query(
      `SELECT id FROM public.user_bookmarks WHERE user_id = $1 AND entity_key = $2 LIMIT 1`,
      [userId, entityKey]
    );

    if (existing.rowCount > 0) {
      // Remove bookmark
      await pool.query(
        `DELETE FROM public.user_bookmarks WHERE user_id = $1 AND entity_key = $2`,
        [userId, entityKey]
      );
      return res.json({ ok: true, bookmarked: false });
    }

    // Add bookmark
    await pool.query(
      `INSERT INTO public.user_bookmarks (user_id, entity_key, title, image_url, brand)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id, entity_key)
       DO UPDATE SET title = EXCLUDED.title, image_url = EXCLUDED.image_url, brand = EXCLUDED.brand`,
      [userId, entityKey, title, imageUrl, brand]
    );

    // Prune async (keep newest MAX per user)
    pool.query(
      `DELETE FROM public.user_bookmarks WHERE user_id = $1
       AND id NOT IN (
         SELECT id FROM public.user_bookmarks WHERE user_id = $1
         ORDER BY created_at DESC LIMIT $2
       )`,
      [userId, MAX_BOOKMARKS_PER_USER]
    ).catch(() => {});

    return res.json({ ok: true, bookmarked: true });
  } catch (err) {
    console.error("POST /api/bookmarks/toggle failed:", err);
    return res.status(500).json({ ok: false, error: "Failed to toggle bookmark." });
  }
});

// ─── DELETE /api/bookmarks/:id ────────────────────────────────────────────────
// Remove one bookmark by ID (used from the bookmarks page).

router.delete("/api/bookmarks/:id", async (req, res) => {
  const id = toPositiveInt(req.params.id);
  if (!id) return res.status(400).json({ ok: false, error: "Invalid id." });

  try {
    const userId = await getSignedInUserId(req);
    if (!userId) return res.status(401).json({ ok: false, error: "Sign in required." });

    await pool.query(
      `DELETE FROM public.user_bookmarks WHERE id = $1 AND user_id = $2`,
      [id, userId]
    );

    return res.json({ ok: true });
  } catch (err) {
    console.error("DELETE /api/bookmarks/:id failed:", err);
    return res.status(500).json({ ok: false, error: "Failed to remove bookmark." });
  }
});

// ─── DELETE /api/bookmarks ────────────────────────────────────────────────────
// Clear all bookmarks for the signed-in user.

router.delete("/api/bookmarks", async (req, res) => {
  try {
    const userId = await getSignedInUserId(req);
    if (!userId) return res.status(401).json({ ok: false, error: "Sign in required." });

    await pool.query(`DELETE FROM public.user_bookmarks WHERE user_id = $1`, [userId]);
    return res.json({ ok: true });
  } catch (err) {
    console.error("DELETE /api/bookmarks failed:", err);
    return res.status(500).json({ ok: false, error: "Failed to clear bookmarks." });
  }
});

module.exports = router;