// Δοκιμή end-to-end με Chromium (Playwright). Η κάμερα προσομοιώνεται με canvas που δείχνει εικόνες.
// Χρήση: node tools/serve.mjs 8080 &  node test/e2e.mjs [imagesDir]
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire('/opt/node-tools/node_modules/playwright/');
const { chromium } = require('playwright');

const BASE = process.env.BASE || 'http://localhost:8080/';
const IMG = process.argv[2] || '/tmp/probe/img';
const results = [];
const ok = (name, cond, extra = '') => { results.push([name, !!cond]); console.log((cond ? '✅' : '❌') + ' ' + name + (extra ? '  → ' + extra : '')); };

const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, permissions: ['camera', 'microphone', 'geolocation'], geolocation: { latitude: 37.9838, longitude: 23.7275, accuracy: 10 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

const imgs = { tennis: 'tennis_standing.jpg', burger: 'burger.jpg', portrait: 'portrait.jpg' };
await page.route('**/__img/*', route => {
  const f = imgs[route.request().url().split('/').pop()];
  route.fulfill({ body: fs.readFileSync(`${IMG}/${f}`), contentType: 'image/jpeg' });
});

// Εικονική κάμερα
await page.addInitScript(() => {
  const c = document.createElement('canvas'); c.width = 720; c.height = 960;
  const g = c.getContext('2d'); let img = null;
  const draw = () => {
    g.fillStyle = '#222'; g.fillRect(0, 0, c.width, c.height);
    if (window.__text) { g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.fillStyle = '#000'; g.font = 'bold 70px sans-serif'; window.__text.split('|').forEach((l, i) => g.fillText(l, 40, 200 + i * 110)); }
    else if (img && img.complete) { const s = Math.min(c.width / img.width, c.height / img.height); const w = img.width * s, h = img.height * s; g.drawImage(img, (c.width - w) / 2, (c.height - h) / 2, w, h); }
    requestAnimationFrame(draw);
  };
  window.__setImg = (name) => { window.__text = null; img = new Image(); img.src = '/__img/' + name; };
  window.__setText = (t) => { window.__text = t; };
  draw();
  const stream = c.captureStream(20);
  navigator.mediaDevices.getUserMedia = async () => stream;
  navigator.mediaDevices.enumerateDevices = async () => [];
  // Καταγραφή ομιλίας
  window.__said = [];
});

await page.route('https://*.wikipedia.org/**', route => {
  const u = route.request().url();
  const body = u.includes('list=search') ? { query: { search: [{ title: 'Χάμπουργκερ' }] } } : { title: 'Χάμπουργκερ', extract: 'Το χάμπουργκερ είναι σάντουιτς με μπιφτέκι. Σερβίρεται σε ψωμάκι.' };
  route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
});
await page.goto(BASE);
await page.evaluate(() => window.__setImg('tennis'));
await page.click('#btnStart');
await page.waitForFunction(() => document.getElementById('status')?.dataset.kind === 'ready', null, { timeout: 120000 });
await page.evaluate(() => { const v = window.__sv.voice; const o = v.speak.bind(v); v.speak = (t, opts) => { window.__said.push(t); o(t, opts); };
  // Ψεύτικο αυτοκίνητο κοντά στην κάμερα, πάνω από την πραγματική ανίχνευση
  const d = window.__sv.detector, orig = d.detect.bind(d);
  d.detect = (v, t) => { const r = orig(v, t); if (window.__fakeCar) r.push({ cls: 'car', score: 0.9, bbox: { x: 100, y: 300, w: 500, h: 380 } }); return r; };
  window.__fakeCar = true; });
const said = () => page.evaluate(() => window.__said.slice());
await page.waitForFunction(() => window.__said.some(x => /Προσοχή! αυτοκίνητο/.test(x)), null, { timeout: 30000 }).catch(() => {});
ok('κανονική λειτουργία: προειδοποίηση για κοντινό αυτοκίνητο', (await said()).some(x => /Προσοχή! αυτοκίνητο/.test(x)));
await page.evaluate(() => { window.__said.length = 0; return window.__sv.handleUtterance(['είμαι σε αυτοκίνητο']); });
ok('λειτουργία οχήματος ενεργοποιείται', await page.evaluate(() => JSON.parse(localStorage.getItem('secondvision.settings.v1')).mode) === 'car');
await page.evaluate(() => { window.__said.length = 0; });
await page.waitForTimeout(12000);
const s2 = await said();
ok('σε όχημα: καμία προειδοποίηση/ανακοίνωση αυτοκινήτου', !s2.some(x => /αυτοκίνητο/.test(x.replace('Λειτουργία οχήματος: δεν θα προειδοποιώ για αυτοκίνητα γύρω σας.', ''))), s2.join(' | '));
ok('σε όχημα: συνεχίζει για άλλα αντικείμενα', s2.some(x => /άνθρωπος|ρακέτα/.test(x)), s2.join(' | '));
await page.evaluate(() => window.__sv.handleUtterance(['βγήκα από το αυτοκίνητο']));
ok('έξοδος από όχημα', await page.evaluate(() => JSON.parse(localStorage.getItem('secondvision.settings.v1')).mode) === 'explore');
await page.evaluate(() => { window.__fakeCar = false; });

// ---- Τι είναι αυτό ----
await page.evaluate(() => window.__setImg('tennis'));
await page.waitForFunction(() => window.__sv.st.tracks.some(t => t.cls === 'tennis racket' && t.hits >= 2), null, { timeout: 30000 }).catch(() => {});
console.log('DBG2', JSON.stringify(await page.evaluate(async () => { const v = document.getElementById('video'); const c = document.createElement('canvas'); c.width = 64; c.height = 64; const g = c.getContext('2d'); g.drawImage(v, 0, 0, 64, 64); const d = g.getImageData(0, 0, 64, 64).data; let s = 0; for (let i = 0; i < d.length; i += 4) s += d[i]; return { luma: s / 4096, raw: window.__sv.detector.detect(v, performance.now() + 100000).map(x => x.cls + ':' + x.score.toFixed(2)), min: JSON.parse(localStorage.getItem('secondvision.settings.v1')).minScore, lastVT: window.__sv.st.lastVideoTime, vt: v.currentTime, rs: v.readyState }; })));
console.log('DBG', JSON.stringify(await page.evaluate(() => ({ n: window.__sv.st.tracks.length, hits: window.__sv.st.tracks.map(t => t.cls + ':' + t.hits), busy: window.__sv.st.busy, paused: window.__sv.st.paused, fps: window.__sv.st.fps, mode: JSON.parse(localStorage.getItem('secondvision.settings.v1')).mode }))));
await page.evaluate(() => { window.__said.length = 0; });
await page.evaluate(() => window.__sv.handleUtterance(['τι αντικείμενο είναι αυτό']));
await page.waitForFunction(() => !window.__sv.st.busy && window.__said.length > 1, null, { timeout: 90000 }).catch(() => {});
const s3 = await said();
ok('«τι είναι αυτό» δίνει πληροφορίες από το διαδίκτυο', s3.some(x => /Από το διαδίκτυο, Χάμπουργκερ/.test(x)), s3.join(' | '));
await page.evaluate(() => { window.__setText('ΓΑΛΑ|ΔΕΛΤΑ'); window.__said.length = 0; });
await page.waitForTimeout(800);
await page.evaluate(() => window.__sv.identify(null));
const s3b = await said();
ok('διαβάζει ετικέτα (OCR) πριν την αναζήτηση', s3b.some(x => /Στην ετικέτα γράφει: .*ΑΛΑ/.test(x)), s3b.join(' | '));
// χωρίς σύνδεση
await ctx.setOffline(true);
await page.evaluate(() => { window.__said.length = 0; return window.__sv.identify(null); });
const s4 = await said();
ok('χωρίς internet το λέει καθαρά', s4.some(x => /Δεν υπάρχει σύνδεση/.test(x)), s4.join(' | '));
await browser.close();
const failed = results.filter(r => !r[1]).length;
console.log(`\n${results.length - failed}/${results.length} επιτυχίες`);
process.exit(failed ? 1 : 0);
