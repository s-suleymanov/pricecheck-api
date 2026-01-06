console.log("BOOT: server.js starting");

process.on("uncaughtException", (e) => {
  console.error("BOOT: uncaughtException", e);
  process.exit(1);
});

process.on("unhandledRejection", (e) => {
  console.error("BOOT: unhandledRejection", e);
  process.exit(1);
});

// server.js

const path = require('path');
const express = require('express');

const app = express();

// --- first-time redirect to /overview/ (server-side, no flash) ---
const VISIT_COOKIE = "pc_seen_overview_v1";

function hasCookie(req, name) {
  const raw = req.headers.cookie || "";
  return raw.split(";").some(part => part.trim().startsWith(name + "="));
}

app.get("/", (req, res, next) => {
  // If they have never been redirected before, do it immediately.
  if (!hasCookie(req, VISIT_COOKIE)) {
    // Mark them as seen (1 year)
    res.setHeader("Set-Cookie", `${VISIT_COOKIE}=1; Path=/; Max-Age=315360000; SameSite=Lax`);
    return res.redirect(302, "/overview/");
  }
  return next(); // let static/index.html (or your normal handler) serve /
});
// --- end first-time redirect ---

// core middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// feature routers
app.use(require('./routes/browse'));
app.use(require('./routes/dashboard'));
app.use(require('./routes/insights'));
app.use(require('./routes/research'));
app.use(require('./routes/admin'));

// health
app.get('/health', (_req, res) => res.json({ ok: true }));

const port = process.env.PORT || 3000;
console.log("BOOT: about to listen. PORT=", process.env.PORT);
app.listen(port, "0.0.0.0", () => {
  console.log(`Listening on port ${port}`);
});