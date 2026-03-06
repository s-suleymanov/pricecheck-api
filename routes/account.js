const express = require("express");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const multer = require("multer");
const pool = require("../db");

const router = express.Router();

const SESSION_COOKIE_NAME = "pc_session";
const AVATAR_DIR = path.join(process.cwd(), "public", "uploads", "avatars");

fs.mkdirSync(AVATAR_DIR, { recursive: true });

function clean(v) {
  return String(v || "").trim();
}

function normalizeNickname(v) {
  return clean(v).replace(/\s+/g, " ").slice(0, 40);
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
  if (!row) return null;

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

async function getAccountRow(userId) {
  const q = await pool.query(
    `
    SELECT
      u.id,
      u.display_name,
      u.nickname,
      u.email,
      u.phone,
      u.profile_image_url,
      u.created_at,
      COALESCE((
        SELECT COUNT(*)
        FROM public.user_follows uf
        WHERE uf.user_id = u.id
      ), 0)::int AS follow_count
    FROM public.users u
    WHERE u.id = $1
      AND u.is_active = true
    LIMIT 1
    `,
    [userId]
  );

  return q.rows[0] || null;
}

function toPublicAccount(row) {
  if (!row) return null;

  return {
    id: row.id,
    display_name: row.display_name,
    nickname: clean(row.nickname) || row.display_name,
    email: row.email,
    phone: row.phone,
    profile_image_url: clean(row.profile_image_url) || null,
    created_at: row.created_at,
    follow_count: Number(row.follow_count || 0)
  };
}

function avatarExtFromMime(mime) {
  switch (String(mime || "").toLowerCase()) {
    case "image/jpeg":
      return ".jpg";
    case "image/png":
      return ".png";
    case "image/webp":
      return ".webp";
    case "image/gif":
      return ".gif";
    default:
      return "";
  }
}

function deleteLocalAvatar(urlPath) {
  const value = clean(urlPath);
  if (!value.startsWith("/uploads/avatars/")) return;

  const filename = path.basename(value);
  if (!filename) return;

  const abs = path.join(AVATAR_DIR, filename);
  fs.unlink(abs, () => {});
}

const upload = multer({
  storage: multer.diskStorage({
    destination(_req, _file, cb) {
      cb(null, AVATAR_DIR);
    },
    filename(req, file, cb) {
      const ext = avatarExtFromMime(file.mimetype);
      const stamp = Date.now();
      const rand = crypto.randomBytes(8).toString("hex");
      cb(null, `u${req.authUserId || "x"}-${stamp}-${rand}${ext}`);
    }
  }),
  limits: {
    fileSize: 3 * 1024 * 1024
  },
  fileFilter(_req, file, cb) {
    const ok = new Set([
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/gif"
    ]);

    if (!ok.has(String(file.mimetype || "").toLowerCase())) {
      return cb(new Error("Only JPG, PNG, WEBP, or GIF images are allowed."));
    }

    cb(null, true);
  }
});

router.get("/api/account/me", async (req, res) => {
  try {
    const userId = await getSignedInUserId(req);

    if (!userId) {
      return res.json({
        ok: true,
        signed_in: false,
        user: null
      });
    }

    const row = await getAccountRow(userId);

    return res.json({
      ok: true,
      signed_in: true,
      user: toPublicAccount(row)
    });
  } catch (err) {
    console.error("GET /api/account/me failed:", err);
    return res.status(500).json({
      ok: false,
      error: "Unable to load account."
    });
  }
});

router.post("/api/account/profile", async (req, res) => {
  try {
    const userId = await getSignedInUserId(req);

    if (!userId) {
      return res.status(401).json({
        ok: false,
        error: "Sign in required."
      });
    }

    const nickname = normalizeNickname(req.body?.nickname);

    if (!nickname) {
      return res.status(400).json({
        ok: false,
        error: "Nickname is required."
      });
    }

    await pool.query(
      `
      UPDATE public.users
      SET
        nickname = $1,
        updated_at = now()
      WHERE id = $2
      `,
      [nickname, userId]
    );

    const row = await getAccountRow(userId);

    return res.json({
      ok: true,
      user: toPublicAccount(row)
    });
  } catch (err) {
    console.error("POST /api/account/profile failed:", err);
    return res.status(500).json({
      ok: false,
      error: "Unable to save profile."
    });
  }
});

router.post("/api/account/avatar", async (req, res) => {
  try {
    const userId = await getSignedInUserId(req);

    if (!userId) {
      return res.status(401).json({
        ok: false,
        error: "Sign in required."
      });
    }

    req.authUserId = userId;

    upload.single("avatar")(req, res, async (err) => {
      if (err) {
        return res.status(400).json({
          ok: false,
          error: err.message || "Unable to upload image."
        });
      }

      if (!req.file) {
        return res.status(400).json({
          ok: false,
          error: "Choose an image first."
        });
      }

      try {
        const current = await pool.query(
          `
          SELECT profile_image_url
          FROM public.users
          WHERE id = $1
          LIMIT 1
          `,
          [userId]
        );

        const previousUrl = current.rows[0]?.profile_image_url || null;
        const nextUrl = `/uploads/avatars/${req.file.filename}`;

        await pool.query(
          `
          UPDATE public.users
          SET
            profile_image_url = $1,
            updated_at = now()
          WHERE id = $2
          `,
          [nextUrl, userId]
        );

        deleteLocalAvatar(previousUrl);

        const row = await getAccountRow(userId);

        return res.json({
          ok: true,
          user: toPublicAccount(row)
        });
      } catch (innerErr) {
        console.error("POST /api/account/avatar failed:", innerErr);
        return res.status(500).json({
          ok: false,
          error: "Unable to save image."
        });
      }
    });
  } catch (err) {
    console.error("POST /api/account/avatar failed:", err);
    return res.status(500).json({
      ok: false,
      error: "Unable to upload image."
    });
  }
});

module.exports = router;