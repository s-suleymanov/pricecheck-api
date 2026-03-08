const express = require("express");
const crypto  = require("crypto");
const pool    = require("../db");

const router = express.Router();

const SESSION_COOKIE_NAME = "pc_session";
const MAX_HISTORY_PER_USER = 200;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function clean(v) {
  return String(v || "").trim();
}

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

  const tokenHash = hashSessionToken(rawToken);

  const q = await pool.query(
    `SELECT u.id, s.id AS session_id
     FROM public.user_sessions s
     JOIN public.users u ON u.id = s.user_id
     WHERE s.session_token_hash = $1
       AND s.revoked_at IS NULL
       AND s.expires_at > now()
       AND u.is_active = true
     LIMIT 1`,
    [tokenHash]
  );

  const row = q.rows[0];
  if (!row) return null;

  pool.query(
    `UPDATE public.user_sessions SET last_seen_at = now() WHERE id = $1`,
    [row.session_id]
  ).catch(() => {});

  return toPositiveInt(row.id);
}

// ─── GET /api/history ─────────────────────────────────────────────────────────
// Returns the user's most recent 200 history entries, newest first.

router.get("/api/history", async (req, res) => {
  try {
    const userId = await getSignedInUserId(req);

    if (!userId) {
      return res.json({ ok: true, signed_in: false, results: [] });
    }

    const q = await pool.query(
      `SELECT id, entity_key, title, image_url, brand, viewed_at
       FROM public.user_history
       WHERE user_id = $1
       ORDER BY viewed_at DESC
       LIMIT $2`,
      [userId, MAX_HISTORY_PER_USER]
    );

    return res.json({ ok: true, signed_in: true, results: q.rows || [] });
  } catch (err) {
    console.error("GET /api/history failed:", err);
    return res.status(500).json({ ok: false, error: "Failed to load history." });
  }
});

// ─── POST /api/history ────────────────────────────────────────────────────────
// Record or refresh a product visit.
// Body: { entity_key, title, image_url?, brand? }
// Upserts (update viewed_at if row already exists) then prunes to MAX cap.

router.post("/api/history", async (req, res) => {
  const entityKey = clean(req.body?.entity_key);
  const title     = clean(req.body?.title) || "Product";
  const imageUrl  = clean(req.body?.image_url) || null;
  const brand     = clean(req.body?.brand)     || null;

  if (!entityKey) {
    return res.status(400).json({ ok: false, error: "entity_key is required." });
  }

  try {
    const userId = await getSignedInUserId(req);

    if (!userId) {
        return res.status(204).end();
    }

    // Upsert: insert or bump viewed_at if already exists.
    await pool.query(
      `INSERT INTO public.user_history (user_id, entity_key, title, image_url, brand, viewed_at)
       VALUES ($1, $2, $3, $4, $5, now())
       ON CONFLICT (user_id, entity_key)
       DO UPDATE SET
         title     = EXCLUDED.title,
         image_url = EXCLUDED.image_url,
         brand     = EXCLUDED.brand,
         viewed_at = now()`,
      [userId, entityKey, title, imageUrl, brand]
    );

    // Prune: keep only the newest MAX rows for this user.
    // Runs async — doesn't block the response.
    pool.query(
      `DELETE FROM public.user_history
       WHERE user_id = $1
         AND id NOT IN (
           SELECT id FROM public.user_history
           WHERE user_id = $1
           ORDER BY viewed_at DESC
           LIMIT $2
         )`,
      [userId, MAX_HISTORY_PER_USER]
    ).catch(() => {});

    return res.json({ ok: true });
  } catch (err) {
    console.error("POST /api/history failed:", err);
    return res.status(500).json({ ok: false, error: "Failed to record history." });
  }
});

// ─── DELETE /api/history/:id ──────────────────────────────────────────────────
// Remove a single history entry.

router.delete("/api/history/:id", async (req, res) => {
  const id = toPositiveInt(req.params.id);

  if (!id) {
    return res.status(400).json({ ok: false, error: "Invalid id." });
  }

  try {
    const userId = await getSignedInUserId(req);

    if (!userId) {
      return res.status(401).json({ ok: false, error: "Sign in required." });
    }

    await pool.query(
      `DELETE FROM public.user_history WHERE id = $1 AND user_id = $2`,
      [id, userId]
    );

    return res.json({ ok: true });
  } catch (err) {
    console.error("DELETE /api/history/:id failed:", err);
    return res.status(500).json({ ok: false, error: "Failed to remove entry." });
  }
});

// ─── DELETE /api/history ──────────────────────────────────────────────────────
// Clear ALL history for the signed-in user.

router.delete("/api/history", async (req, res) => {
  try {
    const userId = await getSignedInUserId(req);

    if (!userId) {
      return res.status(401).json({ ok: false, error: "Sign in required." });
    }

    await pool.query(
      `DELETE FROM public.user_history WHERE user_id = $1`,
      [userId]
    );

    return res.json({ ok: true });
  } catch (err) {
    console.error("DELETE /api/history failed:", err);
    return res.status(500).json({ ok: false, error: "Failed to clear history." });
  }
});

module.exports = router;