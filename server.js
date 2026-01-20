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
const path = require("path");
const express = require("express");

const app = express();

// core middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// feature routers
app.use(require("./routes/browse"));
app.use(require("./routes/dashboard"));
app.use(require("./routes/insights"));
app.use(require("./routes/research"));
app.use(require("./routes/admin"));
app.use(require("./routes/sitemap"));
app.use(require("./routes/uninstall"));
app.use(require("./routes/support"));

// health
app.get("/health", (_req, res) => res.json({ ok: true }));

const port = process.env.PORT || 3000;
console.log("BOOT: about to listen. PORT=", process.env.PORT);
app.listen(port, "0.0.0.0", () => {
  console.log(`Listening on port ${port}`);
});