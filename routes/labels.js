const express = require("express");
const crypto  = require("crypto");
const pool    = require("../db");

const router = express.Router();

const SESSION_COOKIE_NAME = "pc_session";
const MAX_LABELS_PER_USER = 50;
const MAX_ITEMS_PER_LABEL = 500;

// ─── Auth helper ──────────────────────────────────────────────────────────────

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

// ─── GET /api/labels ──────────────────────────────────────────────────────────
// All labels for the user with item count.

router.get("/api/labels", async (req, res) => {
  try {
    const userId = await getSignedInUserId(req);
    if (!userId) return res.json({ ok: true, signed_in: false, results: [] });

    const q = await pool.query(
      `SELECT
         l.id,
         l.name,
         l.created_at,
         l.updated_at,
         COUNT(li.id)::int AS item_count,
         (
           SELECT li2.image_url FROM public.user_label_items li2
           WHERE li2.label_id = l.id AND li2.image_url IS NOT NULL
           ORDER BY li2.added_at DESC LIMIT 1
         ) AS cover_image
       FROM public.user_labels l
       LEFT JOIN public.user_label_items li ON li.label_id = l.id
       WHERE l.user_id = $1
       GROUP BY l.id
       ORDER BY l.updated_at DESC`,
      [userId]
    );

    return res.json({ ok: true, signed_in: true, results: q.rows || [] });
  } catch (err) {
    console.error("GET /api/labels failed:", err);
    return res.status(500).json({ ok: false, error: "Failed to load labels." });
  }
});

// ─── POST /api/labels ─────────────────────────────────────────────────────────
// Create a new label.  Body: { name }

router.post("/api/labels", async (req, res) => {
  const name = clean(req.body?.name).slice(0, 80);
  if (!name) return res.status(400).json({ ok: false, error: "Label name is required." });

  try {
    const userId = await getSignedInUserId(req);
    if (!userId) return res.status(401).json({ ok: false, error: "Sign in required." });

    // Enforce label cap
    const count = await pool.query(
      `SELECT COUNT(*) FROM public.user_labels WHERE user_id = $1`,
      [userId]
    );
    if (Number(count.rows[0].count) >= MAX_LABELS_PER_USER) {
      return res.status(400).json({ ok: false, error: `You can have at most ${MAX_LABELS_PER_USER} labels.` });
    }

    const q = await pool.query(
      `INSERT INTO public.user_labels (user_id, name)
       VALUES ($1, $2)
       RETURNING id, name, created_at, updated_at`,
      [userId, name]
    );

    return res.status(201).json({ ok: true, label: { ...q.rows[0], item_count: 0, cover_image: null } });
  } catch (err) {
    console.error("POST /api/labels failed:", err);
    return res.status(500).json({ ok: false, error: "Failed to create label." });
  }
});

// ─── PATCH /api/labels/:id ────────────────────────────────────────────────────
// Rename a label. Body: { name }

router.patch("/api/labels/:id", async (req, res) => {
  const labelId = toPositiveInt(req.params.id);
  const name    = clean(req.body?.name).slice(0, 80);

  if (!labelId) return res.status(400).json({ ok: false, error: "Invalid id." });
  if (!name)    return res.status(400).json({ ok: false, error: "Name is required." });

  try {
    const userId = await getSignedInUserId(req);
    if (!userId) return res.status(401).json({ ok: false, error: "Sign in required." });

    const q = await pool.query(
      `UPDATE public.user_labels SET name = $1, updated_at = now()
       WHERE id = $2 AND user_id = $3
       RETURNING id, name, updated_at`,
      [name, labelId, userId]
    );

    if (q.rowCount === 0) return res.status(404).json({ ok: false, error: "Label not found." });
    return res.json({ ok: true, label: q.rows[0] });
  } catch (err) {
    console.error("PATCH /api/labels/:id failed:", err);
    return res.status(500).json({ ok: false, error: "Failed to rename label." });
  }
});

// ─── DELETE /api/labels/:id ───────────────────────────────────────────────────
// Delete a label (and all its items via CASCADE).

router.delete("/api/labels/:id", async (req, res) => {
  const labelId = toPositiveInt(req.params.id);
  if (!labelId) return res.status(400).json({ ok: false, error: "Invalid id." });

  try {
    const userId = await getSignedInUserId(req);
    if (!userId) return res.status(401).json({ ok: false, error: "Sign in required." });

    await pool.query(
      `DELETE FROM public.user_labels WHERE id = $1 AND user_id = $2`,
      [labelId, userId]
    );

    return res.json({ ok: true });
  } catch (err) {
    console.error("DELETE /api/labels/:id failed:", err);
    return res.status(500).json({ ok: false, error: "Failed to delete label." });
  }
});

// ─── GET /api/labels/:id/items ────────────────────────────────────────────────
// Items inside a label, newest first.

router.get("/api/labels/:id/items", async (req, res) => {
  const labelId = toPositiveInt(req.params.id);
  if (!labelId) return res.status(400).json({ ok: false, error: "Invalid id." });

  try {
    const userId = await getSignedInUserId(req);
    if (!userId) return res.status(401).json({ ok: false, error: "Sign in required." });

    // Verify ownership
    const own = await pool.query(
      `SELECT id, name FROM public.user_labels WHERE id = $1 AND user_id = $2 LIMIT 1`,
      [labelId, userId]
    );
    if (own.rowCount === 0) return res.status(404).json({ ok: false, error: "Label not found." });

    const q = await pool.query(
      `SELECT id, entity_key, title, image_url, brand, added_at
       FROM public.user_label_items
       WHERE label_id = $1
       ORDER BY added_at DESC
       LIMIT $2`,
      [labelId, MAX_ITEMS_PER_LABEL]
    );

    return res.json({
      ok: true,
      label: own.rows[0],
      results: q.rows || []
    });
  } catch (err) {
    console.error("GET /api/labels/:id/items failed:", err);
    return res.status(500).json({ ok: false, error: "Failed to load label items." });
  }
});

// ─── POST /api/labels/:id/items ──────────────────────────────────────────────
// Add a product to a label.
// Body: { entity_key, title, image_url?, brand? }

router.post("/api/labels/:id/items", async (req, res) => {
  const labelId   = toPositiveInt(req.params.id);
  const entityKey = clean(req.body?.entity_key);
  const title     = clean(req.body?.title) || "Product";
  const imageUrl  = clean(req.body?.image_url) || null;
  const brand     = clean(req.body?.brand) || null;

  if (!labelId)   return res.status(400).json({ ok: false, error: "Invalid label id." });
  if (!entityKey) return res.status(400).json({ ok: false, error: "entity_key required." });

  try {
    const userId = await getSignedInUserId(req);
    if (!userId) return res.status(401).json({ ok: false, error: "Sign in required." });

    // Verify ownership
    const own = await pool.query(
      `SELECT id FROM public.user_labels WHERE id = $1 AND user_id = $2 LIMIT 1`,
      [labelId, userId]
    );
    if (own.rowCount === 0) return res.status(404).json({ ok: false, error: "Label not found." });

    // Insert (ignore if already exists)
    await pool.query(
      `INSERT INTO public.user_label_items (label_id, user_id, entity_key, title, image_url, brand)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (label_id, entity_key) DO NOTHING`,
      [labelId, userId, entityKey, title, imageUrl, brand]
    );

    // Bump label updated_at so it sorts to top
    pool.query(
      `UPDATE public.user_labels SET updated_at = now() WHERE id = $1`,
      [labelId]
    ).catch(() => {});

    return res.json({ ok: true, added: true });
  } catch (err) {
    console.error("POST /api/labels/:id/items failed:", err);
    return res.status(500).json({ ok: false, error: "Failed to add to label." });
  }
});

// ─── DELETE /api/labels/:id/items/:itemId ────────────────────────────────────
// Remove one item from a label.

router.delete("/api/labels/:id/items/:itemId", async (req, res) => {
  const labelId = toPositiveInt(req.params.id);
  const itemId  = toPositiveInt(req.params.itemId);

  if (!labelId || !itemId) return res.status(400).json({ ok: false, error: "Invalid id." });

  try {
    const userId = await getSignedInUserId(req);
    if (!userId) return res.status(401).json({ ok: false, error: "Sign in required." });

    await pool.query(
      `DELETE FROM public.user_label_items
       WHERE id = $1 AND label_id = $2 AND user_id = $3`,
      [itemId, labelId, userId]
    );

    return res.json({ ok: true });
  } catch (err) {
    console.error("DELETE /api/labels/:id/items/:itemId failed:", err);
    return res.status(500).json({ ok: false, error: "Failed to remove item." });
  }
});

// ─── GET /api/labels/check?entity_key=X ──────────────────────────────────────
// Which label IDs already contain this product? Used by the dashboard panel.

router.get("/api/labels/check", async (req, res) => {
  const entityKey = clean(req.query.entity_key);
  if (!entityKey) return res.status(400).json({ ok: false, error: "entity_key required." });

  try {
    const userId = await getSignedInUserId(req);
    if (!userId) return res.json({ ok: true, signed_in: false, label_ids: [] });

    const q = await pool.query(
      `SELECT label_id AS id FROM public.user_label_items
       WHERE user_id = $1 AND entity_key = $2`,
      [userId, entityKey]
    );

    return res.json({ ok: true, signed_in: true, label_ids: q.rows.map(r => r.id) });
  } catch (err) {
    console.error("GET /api/labels/check failed:", err);
    return res.status(500).json({ ok: false, error: "Failed to check labels." });
  }
});

module.exports = router;