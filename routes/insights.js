// routes/insights.js
const path = require('path');
const fs = require('fs');
const express = require('express');

const router = express.Router();

// Only handle alerts.csv here
const dataDir       = path.join(__dirname, '..', 'data');
const alertsCsvPath = path.join(dataDir, 'alerts.csv');

// Make sure data directory exists on local and Render
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// Serve the Insights page
router.get('/insights', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'insights', 'index.html'));
});

// PriceAlert API - writes one row to alerts.csv
router.post('/api/alerts', (req, res) => {
  try {
    const {
      channel,
      recipient,
      query,
      target_price_cents,
      page_url,
      created_client_at
    } = req.body || {};

    if (!recipient || !query || !target_price_cents) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const now = new Date().toISOString();

    const csvRow = [
      now,
      channel || '',
      recipient || '',
      query || '',
      target_price_cents || '',
      page_url || '',
      created_client_at || ''
    ]
      .map(v => `"${String(v).replace(/"/g, '""')}"`)
      .join(',') + '\n';

    // This will create alerts.csv if it does not exist
    fs.appendFileSync(alertsCsvPath, csvRow, 'utf8');

    res.json({ ok: true });
  } catch (err) {
    console.error('Error saving alert', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

module.exports = router;
