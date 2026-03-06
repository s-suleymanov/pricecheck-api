const express = require("express");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const pool = require("../db");

const router = express.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BCRYPT_ROUNDS = 12;

const SESSION_COOKIE_NAME = "pc_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;
const SESSION_REMEMBER_TTL_MS = 1000 * 60 * 60 * 24 * 30;

function clean(v) {
  return String(v || "").trim();
}

function normalizeEmail(v) {
  return clean(v).toLowerCase();
}

function hashSessionToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

function createSessionToken() {
  return crypto.randomBytes(32).toString("hex");
}

function getSessionTtlMs(rememberMe) {
  return rememberMe ? SESSION_REMEMBER_TTL_MS : SESSION_TTL_MS;
}

function getCookieOptions(maxAge) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge
  };
}

function clearSessionCookie(res) {
  res.clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/"
  });
}

function toPublicUser(row) {
  if (!row) return null;

  return {
    id: row.id,
    display_name: row.display_name,
    phone: row.phone,
    email: row.email,
    profile_image_url: row.profile_image_url || null,
    plan_tier: row.plan_tier || "free",
    is_active: row.is_active,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function getClientIp(req) {
  const forwarded = String(req.headers["x-forwarded-for"] || "")
    .split(",")[0]
    .trim();

  if (forwarded) return forwarded;
  return String(req.socket?.remoteAddress || "").trim();
}

async function createSessionAndSetCookie({ req, res, userId, rememberMe }) {
  const rawToken = createSessionToken();
  const tokenHash = hashSessionToken(rawToken);
  const ttlMs = getSessionTtlMs(!!rememberMe);
  const expiresAt = new Date(Date.now() + ttlMs);

  await pool.query(
    `
      insert into public.user_sessions (
        user_id,
        session_token_hash,
        expires_at,
        user_agent,
        ip_address
      )
      values ($1, $2, $3, $4, $5)
    `,
    [
      userId,
      tokenHash,
      expiresAt,
      clean(req.headers["user-agent"]),
      getClientIp(req)
    ]
  );

  res.cookie(SESSION_COOKIE_NAME, rawToken, getCookieOptions(ttlMs));
}

async function getUserFromRequest(req) {
  const rawToken = clean(req.cookies?.[SESSION_COOKIE_NAME]);
  if (!rawToken) return null;

  const tokenHash = hashSessionToken(rawToken);

  const result = await pool.query(
    `
      select
        u.id,
        u.display_name,
        u.phone,
        u.email,
        u.profile_image_url,
        u.plan_tier,
        u.is_active,
        u.created_at,
        u.updated_at,
        s.id as session_id
      from public.user_sessions s
      join public.users u
        on u.id = s.user_id
      where s.session_token_hash = $1
        and s.revoked_at is null
        and s.expires_at > now()
        and u.is_active = true
      limit 1
    `,
    [tokenHash]
  );

  const row = result.rows[0];
  if (!row) return null;

  await pool.query(
    `
      update public.user_sessions
      set last_seen_at = now()
      where id = $1
    `,
    [row.session_id]
  ).catch(() => {});

  return toPublicUser(row);
}

router.post("/api/auth/signup", async (req, res) => {
  const displayName = clean(req.body.display_name);
  const phone = clean(req.body.phone);
  const email = normalizeEmail(req.body.email);
  const password = String(req.body.password || "");
  const rememberMe = !!req.body.remember_me;

  if (!displayName || !phone || !email || !password) {
    return res.status(400).json({
      ok: false,
      error: "display_name, phone, email, and password are required."
    });
  }

  if (!EMAIL_RE.test(email)) {
    return res.status(400).json({
      ok: false,
      error: "Enter a valid email address."
    });
  }

  if (password.length < 8) {
    return res.status(400).json({
      ok: false,
      error: "Password must be at least 8 characters."
    });
  }

  try {
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    const result = await pool.query(
      `
        insert into public.users (
          display_name,
          nickname,
          phone,
          email,
          password_hash,
          plan_tier
        )
        values ($1, $2, $3, $4, $5, $6)
        returning
          id,
          display_name,
          phone,
          email,
          profile_image_url,
          plan_tier,
          is_active,
          created_at,
          updated_at
      `,
      [displayName, displayName, phone, email, passwordHash, "plus"]
    );

    const user = result.rows[0];

    await createSessionAndSetCookie({
      req,
      res,
      userId: user.id,
      rememberMe
    });

    return res.status(201).json({
      ok: true,
      user: toPublicUser(user)
    });
  } catch (err) {
    if (err && err.code === "23505") {
      return res.status(409).json({
        ok: false,
        error: "An account with that email already exists."
      });
    }

    console.error("AUTH SIGNUP ERROR:", err);
    return res.status(500).json({
      ok: false,
      error: "Unable to create account right now."
    });
  }
});

router.post("/api/auth/signin", async (req, res) => {
  const email = normalizeEmail(req.body.email);
  const password = String(req.body.password || "");
  const rememberMe = !!req.body.remember_me;

  if (!email || !password) {
    return res.status(400).json({
      ok: false,
      error: "email and password are required."
    });
  }

  try {
    const result = await pool.query(
      `
        select
          id,
          display_name,
          phone,
          email,
          profile_image_url,
          plan_tier,
          password_hash,
          is_active,
          created_at,
          updated_at
        from public.users
        where email = $1
        limit 1
      `,
      [email]
    );

    const user = result.rows[0];

    if (!user || !user.is_active) {
      return res.status(401).json({
        ok: false,
        error: "Invalid email or password."
      });
    }

    const passwordOk = await bcrypt.compare(password, user.password_hash);

    if (!passwordOk) {
      return res.status(401).json({
        ok: false,
        error: "Invalid email or password."
      });
    }

    await createSessionAndSetCookie({
      req,
      res,
      userId: user.id,
      rememberMe
    });

    return res.json({
      ok: true,
      user: toPublicUser(user)
    });
  } catch (err) {
    console.error("AUTH SIGNIN ERROR:", err);
    return res.status(500).json({
      ok: false,
      error: "Unable to sign in right now."
    });
  }
});

router.get("/api/auth/me", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);

    if (!user) {
      clearSessionCookie(res);
      return res.json({
        ok: true,
        user: null
      });
    }

    return res.json({
      ok: true,
      user
    });
  } catch (err) {
    console.error("AUTH ME ERROR:", err);
    clearSessionCookie(res);
    return res.status(500).json({
      ok: false,
      error: "Unable to load auth state."
    });
  }
});

router.post("/api/auth/signout", async (req, res) => {
  const rawToken = clean(req.cookies?.[SESSION_COOKIE_NAME]);

  try {
    if (rawToken) {
      await pool.query(
        `
          update public.user_sessions
          set revoked_at = coalesce(revoked_at, now())
          where session_token_hash = $1
        `,
        [hashSessionToken(rawToken)]
      );
    }
  } catch (err) {
    console.error("AUTH SIGNOUT ERROR:", err);
  }

  clearSessionCookie(res);

  return res.json({
    ok: true
  });
});

module.exports = router;