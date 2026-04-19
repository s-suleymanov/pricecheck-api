console.log("BOOT: server.js starting");

process.on("uncaughtException", (e) => {
  console.error("BOOT: uncaughtException");
  console.error(e && e.stack ? e.stack : e);
  process.exit(1);
});

process.on("unhandledRejection", (e) => {
  console.error("BOOT: unhandledRejection");
  console.error(e && e.stack ? e.stack : e);
  process.exit(1);
});

const Sentry = require("@sentry/node");

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 0.2
});

const path = require("path");
const express = require("express");
const cookieParser = require("cookie-parser");

const app = express();

app.set("trust proxy", 1);

// core middleware
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));

// feature routers
app.use(require("./routes/browse"));
app.use(require("./routes/dashboard"));
app.use(require("./routes/research"));
app.use(require("./routes/admin"));
app.use(require("./routes/sitemap"));
app.use(require("./routes/uninstall"));
app.use(require("./routes/support"));
app.use(require("./routes/seller"));
app.use(require("./routes/search"));
app.use(require("./routes/home"));
app.use(require("./routes/auth"));
app.use(require("./routes/follows"));
app.use(require("./routes/account"));
app.use(require("./routes/history"));
app.use(require("./routes/labels"));
app.use(require("./routes/algorithm"));
app.use("/api/reviews", require("./routes/reviews"));

// health
app.get("/health", (_req, res) => res.json({ ok: true }));

// Sentry Express error handler
Sentry.setupExpressErrorHandler(app);

// Catch-all 404
app.use((req, res) => {
  res.status(404).sendFile(path.join(__dirname, "public", "404", "index.html"));
});

const port = process.env.PORT || 3000;
console.log("BOOT: about to listen. PORT=", process.env.PORT);

app.listen(port, "0.0.0.0", () => {
  console.log(`Listening on port ${port}`);
});