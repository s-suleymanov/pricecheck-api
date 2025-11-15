// routes/insights.js
const fs = require('fs');
const path = require('path');
const express = require('express');
const router = express.Router();

const DATA_DIR = path.join(__dirname, '..', 'data');
const CSV_PATH = path.join(DATA_DIR, 'alerts.csv');

function ensureDataFile(){
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(CSV_PATH)){
    fs.writeFileSync(
      CSV_PATH,
      'created_at_utc,channel,recipient,query,target_price_cents,page_url,created_client_at\n',
      'utf8'
    );
  }
}

// page (static file)
router.get('/insights', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'insights', 'index.html'));
});

// api to save alerts
router.post('/api/alerts', (req, res) => {
  try {
    ensureDataFile();

    const { channel, recipient, query, target_price_cents, page_url, created_client_at } = req.body || {};

    if (!recipient || !query || !(Number.isInteger(target_price_cents) && target_price_cents > 0)){
      return res.status(400).json({ error: 'invalid_input' });
    }

    const row = [
      new Date().toISOString(),
      (channel || '').replace(/[\n\r,]/g,' ').trim(),
      (recipient || '').replace(/[\n\r,]/g,' ').trim(),
      (query || '').replace(/[\n\r,]/g,' ').trim(),
      String(target_price_cents),
      (page_url || '').replace(/[\n\r,]/g,' ').trim(),
      (created_client_at || '').replace(/[\n\r,]/g,' ').trim()
    ].join(',') + '\n';

    fs.appendFileSync(CSV_PATH, row, 'utf8');
    return res.json({ ok: true });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'server_error' });
  }
});

module.exports = router;
