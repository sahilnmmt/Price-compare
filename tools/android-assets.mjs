// Draws the Android launcher icons and splash screens from one design.
// Run after changing the icon: `node tools/android-assets.mjs`.

import { chromium } from 'playwright';

const RES = new URL('../android/app/src/main/res/', import.meta.url).pathname;
const TEAL = '#0f766e';
// Three price bars and a coin, drawn on a 64×64 grid (same as public/favicon.svg).
const GLYPH = `<path d="M18 40h10M18 30h18M18 20h28" stroke="#fff" stroke-width="6" stroke-linecap="round"/><circle cx="46" cy="40" r="6" fill="#fbbf24"/>`;

const svg = (w, h, body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`;
// The glyph scaled to `size` px and centred in a w×h canvas.
const glyphAt = (w, h, size) =>
  `<g transform="translate(${(w - size) / 2} ${(h - size) / 2}) scale(${size / 64})">${GLYPH}</g>`;

const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
const SPLASH = {
  'drawable/splash.png': [480, 320],
  'drawable-land-mdpi/splash.png': [480, 320],
  'drawable-land-hdpi/splash.png': [800, 480],
  'drawable-land-xhdpi/splash.png': [1280, 720],
  'drawable-land-xxhdpi/splash.png': [1600, 960],
  'drawable-land-xxxhdpi/splash.png': [1920, 1280],
  'drawable-port-mdpi/splash.png': [320, 480],
  'drawable-port-hdpi/splash.png': [480, 800],
  'drawable-port-xhdpi/splash.png': [720, 1280],
  'drawable-port-xxhdpi/splash.png': [960, 1600],
  'drawable-port-xxxhdpi/splash.png': [1280, 1920],
};

const images = {};
for (const [density, scale] of Object.entries(DENSITIES)) {
  const icon = 48 * scale;
  // Legacy icons (Android 7 and older launchers): a rounded square and a circle.
  images[`mipmap-${density}/ic_launcher.png`] = svg(icon, icon,
    `<rect width="${icon}" height="${icon}" rx="${icon * 0.22}" fill="${TEAL}"/>${glyphAt(icon, icon, icon * 0.9)}`);
  images[`mipmap-${density}/ic_launcher_round.png`] = svg(icon, icon,
    `<circle cx="${icon / 2}" cy="${icon / 2}" r="${icon / 2}" fill="${TEAL}"/>${glyphAt(icon, icon, icon * 0.85)}`);
  // Adaptive icon foreground: 108dp canvas, art inside the central 66dp safe zone.
  const fg = 108 * scale;
  images[`mipmap-${density}/ic_launcher_foreground.png`] = svg(fg, fg, glyphAt(fg, fg, 70 * scale));
}
for (const [path, [w, h]] of Object.entries(SPLASH)) {
  images[path] = svg(w, h, `<rect width="${w}" height="${h}" fill="${TEAL}"/>${glyphAt(w, h, Math.min(w, h) * 0.3)}`);
}

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const page = await browser.newPage();
for (const [path, markup] of Object.entries(images)) {
  const [, w, h] = markup.match(/width="([\d.]+)" height="([\d.]+)"/).map(Number);
  await page.setViewportSize({ width: w, height: h });
  await page.setContent(`<style>html,body{margin:0;background:transparent}</style>${markup}`);
  await page.locator('svg').screenshot({ path: RES + path, omitBackground: true });
}
await browser.close();
console.log(`wrote ${Object.keys(images).length} images`);
