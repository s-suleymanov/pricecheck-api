// routes/support.js
const path = require("path");
const express = require("express");
const crypto = require("crypto");
const { Pool } = require("pg");

const router = express.Router();

// Make this router self-contained (so you do not depend on app-level json())
router.use(express.json({ limit: "1mb" }));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSLMODE === "disable" ? false : { rejectUnauthorized: false }
});

const ADMIN_TOKEN = String(process.env.SUPPORT_ADMIN_TOKEN || "").trim();
const VOTE_SALT = String(process.env.SUPPORT_VOTE_SALT || ADMIN_TOKEN || "dev-salt").trim();

function isAdmin(req) {
  const h = String(req.headers["x-support-admin-token"] || "").trim();
  const q = String(req.query.admin_token || "").trim();
  return Boolean(ADMIN_TOKEN) && (h === ADMIN_TOKEN || q === ADMIN_TOKEN);
}

function getClientIp(req) {
  // Cloudflare
  const cf = req.headers["cf-connecting-ip"];
  if (cf && typeof cf === "string") return cf.trim();

  // Standard proxy chain
  const xf = req.headers["x-forwarded-for"];
  if (xf && typeof xf === "string") return xf.split(",")[0].trim();
  if (Array.isArray(xf) && xf[0]) return String(xf[0]).trim();

  // Express fallback
  return String(req.ip || "").replace("::ffff:", "");
}

function voterHash(req) {
  const ip = getClientIp(req) || "noip";
  const ua = String(req.headers["user-agent"] || "noua");
  return crypto.createHash("sha256").update(`${ip}|${ua}|${VOTE_SALT}`).digest("hex");
}

function clampText(s, max) {
  s = String(s || "").trim();
  if (!s) return "";
  return s.length > max ? s.slice(0, max) : s;
}

function okVote(x) {
  return x === 1 || x === -1 || x === 0;
}

function allowedStatus(s) {
  return new Set(["open", "investigating", "planned", "fixed", "closed"]).has(s);
}

function supportPath(...parts) {
  return path.join(process.cwd(), "public", "support", ...parts);
}

/* Pages */
router.get(["/support", "/support/"], (req, res) => {
  res.sendFile(supportPath("index.html"));
});

// Avoid /support/admin/ because ../styles.css breaks there
router.get("/support/admin/", (req, res) => res.redirect(302, "/support/admin"));

router.get(["/support/admin", "/support/admin.html"], (req, res) => {
  res.sendFile(supportPath("admin.html"));
});

/* API health (optional but nice for debugging) */
router.get("/api/support/health", (req, res) => {
  res.json({ ok: true });
});

/* API: list issues */
router.get("/api/support/issues", async (req, res) => {
  const admin = isAdmin(req);

  const view = String(req.query.view || "public"); // public | admin
  const wantAdmin = view === "admin";
  if (wantAdmin && !admin) return res.status(401).json({ error: "admin_required" });

  const sort = String(req.query.sort || "new"); // new | top
  const status = String(req.query.status || "open"); // open | all | investigating | planned | fixed | closed
  const q = clampText(req.query.q || "", 200);

  const limit = Math.max(1, Math.min(Number(req.query.limit || 50), 100));
  const offset = Math.max(0, Math.min(Number(req.query.offset || 0), 2000));

  const voter = voterHash(req);

  // Public list never shows private issues
  const where = [];
  const params = [];
  let p = 1;

  if (!wantAdmin) {
    where.push(`i.is_public = true`);
  }

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

  // IMPORTANT: public responses exclude reporter_email, reporter_ip, user_agent
  const selectCols = wantAdmin
    ? `
      i.id, i.created_at, i.updated_at,
      i.title, i.body,
      i.category, i.status,
      i.is_public,
      i.reporter_email, i.source_url, i.app_version,
      i.user_agent, i.reporter_ip
    `
    : `
      i.id, i.created_at, i.updated_at,
      i.title, i.body,
      i.category, i.status,
      i.is_public,
      i.source_url, i.app_version
    `;

  const groupCols = wantAdmin
    ? `
      i.id, i.created_at, i.updated_at,
      i.title, i.body,
      i.category, i.status,
      i.is_public,
      i.reporter_email, i.source_url, i.app_version,
      i.user_agent, i.reporter_ip
    `
    : `
      i.id, i.created_at, i.updated_at,
      i.title, i.body,
      i.category, i.status,
      i.is_public,
      i.source_url, i.app_version
    `;

  const sql = `
    select
      ${selectCols},
      coalesce(sum(v.vote), 0)::int as score,
      coalesce(max(case when v.voter_hash = $${p} then v.vote end), 0)::int as viewer_vote
    from public.support_issues i
    left join public.support_votes v on v.issue_id = i.id
    ${whereSql}
    group by ${groupCols}
    ${orderSql}
    limit ${limit} offset ${offset}
  `;

  params.push(voter);

  try {
    const r = await pool.query(sql, params);
    res.json({ issues: r.rows, admin });
  } catch (e) {
    res.status(500).json({ error: "db_error" });
  }
});

/* API: create issue (public or private) */
router.post("/api/support/issues", async (req, res) => {
  const title = clampText(req.body?.title, 120);
  const body = clampText(req.body?.body, 6000);
  const category = clampText(req.body?.category, 40) || "Bug";

  // default public if missing
  const is_public = req.body?.is_public === false ? false : true;

  const reporter_email = clampText(req.body?.reporter_email, 200) || null;
  const source_url = clampText(req.body?.source_url, 800) || null;
  const app_version = clampText(req.body?.app_version, 60) || null;

  if (!title || title.length < 4) return res.status(400).json({ error: "title_required" });
  if (!body || body.length < 10) return res.status(400).json({ error: "body_required" });

  const ua = clampText(req.headers["user-agent"] || "", 500) || null;
  const ip = getClientIp(req) || null;

  try {
    const r = await pool.query(
      `
      insert into public.support_issues
        (title, body, category, is_public, reporter_email, source_url, app_version, user_agent, reporter_ip)
      values
        ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      returning id, created_at
      `,
      [title, body, category, is_public, reporter_email, source_url, app_version, ua, ip]
    );

    // Return minimal safe response (frontend does not need the full row)
    res.json({ ok: true, id: r.rows[0].id, created_at: r.rows[0].created_at });
  } catch (e) {
    res.status(500).json({ error: "db_error" });
  }
});

/* API: vote on an issue */
router.post("/api/support/issues/:id/vote", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "bad_id" });

  const vote = Number(req.body?.vote);
  if (!okVote(vote)) return res.status(400).json({ error: "bad_vote" });

  const admin = isAdmin(req);
  const voter = voterHash(req);

  try {
    const issue = await pool.query(
      `select id, is_public from public.support_issues where id = $1`,
      [id]
    );
    if (!issue.rows[0]) return res.status(404).json({ error: "not_found" });

    if (!issue.rows[0].is_public && !admin) {
      return res.status(403).json({ error: "private_issue" });
    }

    if (vote === 0) {
      await pool.query(
        `delete from public.support_votes where issue_id = $1 and voter_hash = $2`,
        [id, voter]
      );
    } else {
      await pool.query(
        `
        insert into public.support_votes (issue_id, voter_hash, vote)
        values ($1,$2,$3)
        on conflict (issue_id, voter_hash)
        do update set vote = excluded.vote, created_at = now()
        `,
        [id, voter, vote]
      );
    }

    const r = await pool.query(
      `
      select
        coalesce(sum(v.vote), 0)::int as score,
        coalesce(max(case when v.voter_hash = $2 then v.vote end), 0)::int as viewer_vote
      from public.support_issues i
      left join public.support_votes v on v.issue_id = i.id
      where i.id = $1
      group by i.id
      `,
      [id, voter]
    );

    res.json({
      id,
      score: r.rows[0]?.score ?? 0,
      viewer_vote: r.rows[0]?.viewer_vote ?? 0
    });
  } catch (e) {
    res.status(500).json({ error: "db_error" });
  }
});

/* Admin: update issue (status, visibility, category) */
router.patch("/api/support/issues/:id", async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: "admin_required" });

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
    res.status(500).json({ error: "db_error" });
  }
});

module.exports = router;