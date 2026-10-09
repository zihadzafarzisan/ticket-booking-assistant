const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

async function convert() {
  const inputPath = path.resolve(__dirname, '../download.png');
  const buffer = fs.readFileSync(inputPath);
  const base64 = buffer.toString('base64');
  // Detect mime type
  const isJpg = buffer[0] === 0xff && buffer[1] === 0xd8;
  const mime = isJpg ? 'image/jpeg' : 'image/png';
  const dataUri = `data:${mime};base64,${base64}`;

  const browser = await chromium.launch();
  const page = await browser.newPage();

  await page.setContent(`
    <!DOCTYPE html>
    <html>
      <body>
        <img id="srcImg" src="${dataUri}" />
        <canvas id="cvs"></canvas>
      </body>
    </html>
  `);

  await page.waitForFunction(() => {
    const img = document.getElementById('srcImg');
    return img.complete && img.naturalWidth > 0;
  });

  const dimensions = await page.evaluate(() => {
    const img = document.getElementById('srcImg');
    return { width: img.naturalWidth, height: img.naturalHeight };
  });

  console.log('Input icon dimensions:', dimensions);

  const sizes = [16, 32, 48, 128];
  const outPublic = path.resolve(__dirname, '../extension/public/icons');
  const outDist = path.resolve(__dirname, '../extension/dist/icons');

  fs.mkdirSync(outPublic, { recursive: true });
  fs.mkdirSync(outDist, { recursive: true });

  for (const size of sizes) {
    const pngBase64 = await page.evaluate((s) => {
      const img = document.getElementById('srcImg');
      const cvs = document.getElementById('cvs');
      cvs.width = s;
      cvs.height = s;
      const ctx = cvs.getContext('2d');
      ctx.clearRect(0, 0, s, s);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, s, s);
      return cvs.toDataURL('image/png').split(',')[1];
    }, size);

    const outBuf = Buffer.from(pngBase64, 'base64');
    fs.writeFileSync(path.join(outPublic, `icon-${size}.png`), outBuf);
    fs.writeFileSync(path.join(outDist, `icon-${size}.png`), outBuf);
    console.log(`Generated icon-${size}.png (${outBuf.length} bytes)`);
  }

  await browser.close();
  console.log('All icons successfully updated from download.png!');
}

convert().catch(err => {
  console.error('Conversion failed:', err);
  process.exit(1);
});
