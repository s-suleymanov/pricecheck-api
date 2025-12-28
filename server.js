// server.js
const path = require('path');
const express = require('express');

const app = express();

// core middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// feature routers
app.use(require('./routes/browse'));
app.use(require('./routes/dashboard'));
app.use(require('./routes/insights'));
app.use(require('./routes/research'));


// health
app.get('/health', (_req, res) => res.json({ ok: true }));

const port = process.env.PORT || 3000;
app.listen(port, "0.0.0.0", () => {
  console.log(`Listening on port ${port}`);
});
