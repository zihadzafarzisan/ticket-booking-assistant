/**
 * Post-build script for Chrome extension output.
 *
 * Fixes the dist/ layout so it can be loaded as an unpacked MV3 extension:
 *  - Vite emits the popup HTML at dist/src/popup/index.html. The manifest
 *    expects popup/index.html, so we move it.
 *  - The built HTML references `/popup.js` and `/assets/...` with absolute
 *    root paths. Those resolve from the extension root (dist/), so moving the
 *    HTML into dist/popup/ keeps them working without rewriting.
 *  - Copies public/icons to dist/icons so the manifest references resolve.
 *  - Removes the leftover empty dist/src tree.
 *
 * Run via: vite build && node scripts/postbuild.mjs
 */
import { copyFileSync, rmSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { resolve, join } from 'path';

const dist = resolve(process.cwd(), 'dist');

const srcPopup = resolve(dist, 'src/popup/index.html');
const popupDir = resolve(dist, 'popup');
const targetPopup = resolve(popupDir, 'index.html');

if (!existsSync(srcPopup)) {
  console.error('[postbuild] Expected popup HTML not found at', srcPopup);
  process.exit(1);
}

mkdirSync(popupDir, { recursive: true });
copyFileSync(srcPopup, targetPopup);
console.log('[postbuild] Moved popup HTML -> dist/popup/index.html');

// Copy icons from public/icons to dist/icons
const publicIcons = resolve(process.cwd(), 'public/icons');
const distIcons = resolve(dist, 'icons');

if (existsSync(publicIcons)) {
  mkdirSync(distIcons, { recursive: true });
  const icons = readdirSync(publicIcons);
  for (const icon of icons) {
    copyFileSync(join(publicIcons, icon), join(distIcons, icon));
  }
  console.log(`[postbuild] Copied ${icons.length} icon(s) -> dist/icons/`);
}

// Remove the now-redundant src tree Vite left behind
rmSync(resolve(dist, 'src'), { recursive: true, force: true });
console.log('[postbuild] Removed empty dist/src tree');

console.log('[postbuild] Done. dist/ is now loadable as an unpacked extension.');