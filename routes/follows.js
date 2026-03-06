const express = require("express");
const crypto = require("crypto");
const pool = require("../db");

const router = express.Router();

const SESSION_COOKIE_NAME = "pc_session";

function clean(v) {
  return String(v || "").trim();
}

function cleanBrandLabel(v) {
  return String(v || "").replace(/\s+/g, " ").trim();
}

function brandKey(v) {
  return cleanBrandLabel(v).toLowerCase();
}

function hashSessionToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

function toPositiveInt(v) {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

async function getSignedInUserId(req) {
  const attachedUserId =
    toPositiveInt(req.user?.id) ||
    toPositiveInt(req.authUser?.id);

  if (attachedUserId) {
    return attachedUserId;
  }

  const rawToken = clean(req.cookies?.[SESSION_COOKIE_NAME]);
  if (!rawToken) return null;

  const tokenHash = hashSessionToken(rawToken);

  const q = await pool.query(
    `
    SELECT
      u.id,
      s.id AS session_id
    FROM public.user_sessions s
    JOIN public.users u
      ON u.id = s.user_id
    WHERE s.session_token_hash = $1
      AND s.revoked_at IS NULL
      AND s.expires_at > now()
      AND u.is_active = true
    LIMIT 1
    `,
    [tokenHash]
  );

  const row = q.rows[0];
  if (!row) {
    return null;
  }

  await pool.query(
    `
    UPDATE public.user_sessions
    SET last_seen_at = now()
    WHERE id = $1
    `,
    [row.session_id]
  ).catch(() => {});

  return toPositiveInt(row.id);
}

router.get("/api/follows/brand", async (req, res) => {
  const label = cleanBrandLabel(req.query.brand);
  const key = brandKey(label);

  if (!key) {
    return res.status(400).json({
      ok: false,
      error: "Missing brand."
    });
  }

  try {
    const userId = await getSignedInUserId(req);

    if (!userId) {
      return res.json({
        ok: true,
        signed_in: false,
        following: false
      });
    }

    const q = await pool.query(
      `
      SELECT 1
      FROM public.user_follows
      WHERE user_id = $1
        AND entity_type = 'brand'
        AND entity_key = $2
      LIMIT 1
      `,
      [userId, key]
    );

    return res.json({
      ok: true,
      signed_in: true,
      following: q.rowCount > 0
    });
  } catch (err) {
    console.error("GET /api/follows/brand failed:", err);
    return res.status(500).json({
      ok: false,
      error: "Failed to read follow state."
    });
  }
});

router.post("/api/follows/brand/toggle", async (req, res) => {
  const label = cleanBrandLabel(req.body?.brand);
  const key = brandKey(label);

  if (!key) {
    return res.status(400).json({
      ok: false,
      error: "Missing brand."
    });
  }

  try {
    const userId = await getSignedInUserId(req);

    if (!userId) {
      return res.status(401).json({
        ok: false,
        error: "Sign in required."
      });
    }

    const existing = await pool.query(
      `
      SELECT id
      FROM public.user_follows
      WHERE user_id = $1
        AND entity_type = 'brand'
        AND entity_key = $2
      LIMIT 1
      `,
      [userId, key]
    );

    if (existing.rowCount > 0) {
      await pool.query(
        `
        DELETE FROM public.user_follows
        WHERE user_id = $1
          AND entity_type = 'brand'
          AND entity_key = $2
        `,
        [userId, key]
      );

      return res.json({
        ok: true,
        following: false
      });
    }

    await pool.query(
      `
      INSERT INTO public.user_follows (
        user_id,
        entity_type,
        entity_key,
        entity_label
      )
      VALUES ($1, 'brand', $2, $3)
      `,
      [userId, key, label]
    );

    return res.json({
      ok: true,
      following: true
    });
  } catch (err) {
    console.error("POST /api/follows/brand/toggle failed:", err);
    return res.status(500).json({
      ok: false,
      error: "Failed to update follow state."
    });
  }
});

router.get("/api/following", async (req, res) => {
  const type = clean(req.query.type).toLowerCase();
  const entityType = type || "brand";

  try {
    const userId = await getSignedInUserId(req);

    if (!userId) {
      return res.json({
        ok: true,
        signed_in: false,
        results: []
      });
    }

    const q = await pool.query(
      `
      SELECT
        id,
        entity_type,
        entity_key,
        entity_label
      FROM public.user_follows
      WHERE user_id = $1
        AND entity_type = $2
      ORDER BY id DESC
      LIMIT 500
      `,
      [userId, entityType]
    );

    return res.json({
      ok: true,
      signed_in: true,
      results: q.rows || []
    });
  } catch (err) {
    console.error("GET /api/following failed:", err);
    return res.status(500).json({
      ok: false,
      error: "Failed to load following."
    });
  }
});

module.exports = router;