// scripts/resize-seller-logos.js
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const LOGO_DIR = path.join(__dirname, '../logo/seller');
const SIZE = 80; // 2x of your 34px display size (retina)

async function run() {
  const files = fs.readdirSync(LOGO_DIR).filter(f => /\.(jpg|jpeg|png)$/i.test(f));

  for (const file of files) {
    const filepath = path.join(LOGO_DIR, file);
    const ext = path.extname(file).toLowerCase();
    const outName = file.replace(/\.(jpg|jpeg|png)$/i, '.webp');
    const outPath = path.join(LOGO_DIR, outName);

    await sharp(filepath)
      .resize(SIZE, SIZE, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 85 })
      .toFile(outPath);

    console.log(`✓ ${file} → ${outName}`);

    // Remove old file if we renamed it
    if (outName !== file) fs.unlinkSync(filepath);
  }
}

run().catch(console.error);