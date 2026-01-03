// server.js
const path = require("path");
const express = require("express");

const app = express();

app.get("/health", (_req, res) => res.status(200).send("ok"));

// core middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));
app.use("/data", express.static(path.join(__dirname, "data")));

// feature routers
app.use(require("./routes/browse"));
app.use(require("./routes/dashboard"));
app.use(require("./routes/insights"));
app.use(require("./routes/research"));

const port = process.env.PORT || 3000;
app.listen(port, "0.0.0.0", () => {
  console.log(`Listening on port ${port}`);
});