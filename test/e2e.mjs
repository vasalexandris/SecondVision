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

await page.goto(BASE);
await page.evaluate(() => window.__setImg('tennis'));
ok('σελίδα φορτώθηκε', await page.title() === 'Δεύτερη Όραση');
await page.evaluate(() => { const orig = window.speechSynthesis?.speak?.bind(window.speechSynthesis); });
await page.click('#btnStart');
await page.waitForFunction(() => document.getElementById('status')?.dataset.kind === 'ready', null, { timeout: 120000 });
ok('μοντέλα φορτώθηκαν (status ready)', true);
await page.evaluate(() => { const v = window.__sv.voice; const o = v.speak.bind(v); v.speak = (t, opts) => { window.__said.push(t); o(t, opts); }; });
const said = () => page.evaluate(() => window.__said.slice());

// ---- Ανίχνευση ----
await page.waitForFunction(() => window.__sv.st.tracks.some(t => t.cls === 'person'), null, { timeout: 30000 }).catch(() => {});
const tracks = await page.evaluate(() => window.__sv.st.tracks.map(t => ({ cls: t.cls, d: t.dist && +t.dist.toFixed(1), a: +t.angle.toFixed(0) })));
ok('ανίχνευση άνθρωπος', tracks.some(t => t.cls === 'person'), JSON.stringify(tracks));
console.log('   delegate:', await page.evaluate(() => window.__sv.detector.delegate), ' fps:', await page.evaluate(() => window.__sv.st.fps));

// ---- Φωνητικές εντολές (μέσω handleUtterance) ----
await page.evaluate(() => window.__said.length = 0);
await page.evaluate(() => window.__sv.handleUtterance(['τι βλέπεις']));
let s = await said();
ok('«τι βλέπεις» περιγράφει', s.some(x => /Βλέπω/.test(x)), s.join(' | '));

await page.evaluate(() => window.__said.length = 0);
await page.evaluate(() => window.__sv.handleUtterance(['πιο δυνατά']));
ok('ένταση ανεβαίνει', await page.evaluate(() => window.__sv.parseCommand('πιο δυνατά').intent) === 'VOLUME_UP');

// ---- Αναζήτηση ----
await page.evaluate(() => window.__said.length = 0);
await page.evaluate(() => window.__sv.handleUtterance(['βρες τον άνθρωπο']));
await page.waitForFunction(() => window.__sv.search.foundSaid, null, { timeout: 15000 }).catch(() => {});
s = await said();
ok('αναζήτηση βρίσκει άνθρωπο', await page.evaluate(() => window.__sv.search.foundSaid), s.join(' | '));
await page.evaluate(() => window.__sv.handleUtterance(['σταμάτα']));
ok('στοπ ακυρώνει αναζήτηση', !(await page.evaluate(() => window.__sv.search.active)));

// ---- Εκμάθηση νέου αντικειμένου με embeddings ----
await page.evaluate(() => window.__setImg('burger'));
await page.waitForTimeout(800);
await page.evaluate(() => window.__said.length = 0);
await page.evaluate(() => window.__sv.handleUtterance(['μάθε αυτό ως μπέργκερ']));
await page.waitForFunction(() => window.__sv.memory.items.length === 1 && !window.__sv.st.busy, null, { timeout: 40000 });
ok('εκμάθηση αντικειμένου', await page.evaluate(() => window.__sv.memory.items[0].name) === 'μπέργκερ', (await said()).slice(-1)[0]);
// Αναγνώριση ξανά
await page.waitForFunction(() => window.__sv.st.tracks.some(t => t.cls.startsWith('custom:')), null, { timeout: 20000 }).catch(() => {});
ok('αναγνώριση του νέου αντικειμένου', await page.evaluate(() => window.__sv.st.tracks.some(t => t.cls.startsWith('custom:'))));
await page.evaluate(() => window.__setImg('tennis'));
await page.waitForTimeout(3500);
ok('δεν αναγνωρίζεται σε άλλη εικόνα (χωρίς ψευδώς θετικό)', !(await page.evaluate(() => window.__sv.st.tracks.some(t => t.cls.startsWith('custom:')))));
// Αναζήτηση νέου αντικειμένου με μνήμη
await page.evaluate(() => window.__sv.handleUtterance(['πού άφησα το μπέργκερ']));
s = await said();
ok('μνήμη: «πού άφησα» απαντά με πότε το είδε', s.some(x => /Τελευταία φορά/.test(x)), s.slice(-1)[0]);

// ---- Πρόσωπα ----
await page.evaluate(() => window.__setImg('portrait'));
await page.waitForTimeout(800);
await page.evaluate(() => window.__sv.handleUtterance(['αυτός είναι ο Γιάννης']));
await page.waitForFunction(() => window.__sv.memory.people.length === 1 || /Δεν είδα|Δεν μπόρεσα/.test(window.__said.slice(-1)[0] || ''), null, { timeout: 90000 }).catch(() => {});
await page.waitForFunction(() => !window.__sv.st.busy, null, { timeout: 30000 }).catch(() => {});
ok('εκμάθηση προσώπου', await page.evaluate(() => window.__sv.memory.people.length) === 1, (await said()).slice(-1)[0]);

// ---- OCR ----
await page.evaluate(() => window.__setText('ΚΛΕΙΔΙΑ ΣΠΙΤΙ|HELLO WORLD'));
await page.waitForTimeout(500);
await page.evaluate(() => window.__said.length = 0);
await page.evaluate(() => window.__sv.handleUtterance(['διάβασε']));
await page.waitForFunction(() => !window.__sv.st.busy && window.__said.length > 1, null, { timeout: 90000 }).catch(() => {});
s = await said();
ok('OCR διαβάζει κείμενο', s.some(x => /HELLO|WORLD|ΚΛΕΙΔΙΑ|ΣΠΙΤΙ/i.test(x)), s.join(' | '));

// ---- Πυξίδα / σάρωση ----
await page.evaluate(() => window.__setImg('tennis'));
await page.evaluate(() => { window.dispatchEvent(Object.assign(new Event('deviceorientation'), { alpha: 0, beta: 90, gamma: 0, absolute: true })); });
await page.waitForTimeout(300);
ok('πυξίδα διαβάζεται', await page.evaluate(() => window.__sv.sensors.headingNow()) !== null, String(await page.evaluate(() => window.__sv.sensors.headingNow())));
await page.evaluate(() => window.__sv.handleUtterance(['κάνε σάρωση']));
ok('σάρωση ξεκινά', await page.evaluate(() => window.__sv.scan.active));
for (let a = 0; a < 360; a += 20) { // προσομοίωση στροφής 360°
  await page.evaluate((al) => window.dispatchEvent(Object.assign(new Event('deviceorientation'), { alpha: 360 - al, beta: 90, gamma: 0, absolute: true })), a);
  await page.waitForTimeout(450);
}
await page.waitForFunction(() => !window.__sv.scan.active, null, { timeout: 15000 }).catch(() => {});
s = await said();
ok('σάρωση ολοκληρώνεται με περίληψη', s.some(x => /Ολοκληρώθηκε η σάρωση/.test(x)), s.slice(-1)[0]);

// ---- Μνήμη επιμένει (IndexedDB) ----
await page.waitForTimeout(500);
const persisted = await page.evaluate(async () => { await window.__sv.memory.flush(); const { Memory } = await import('/js/memory.js'); const m = new Memory(); await m.load(); return { items: m.items.length, people: m.people.length }; });
ok('IndexedDB αποθηκεύει αντικείμενα/πρόσωπα', persisted.items === 1 && persisted.people === 1, JSON.stringify(persisted));

// ---- Service worker ----
await page.waitForTimeout(1500);
const sw = await page.evaluate(async () => { const r = await navigator.serviceWorker?.getRegistration(); const keys = await caches.keys(); const n = keys.length ? (await (await caches.open(keys[0])).keys()).length : 0; return { reg: !!r, caches: keys, n }; });
ok('service worker + cache', sw.reg && sw.caches.length > 0, JSON.stringify(sw));

await page.screenshot({ path: '/tmp/probe/shot-app.png' });
const realErrors = errors.filter(e => !/favicon|net::ERR_|Failed to load resource/.test(e));
ok('χωρίς σφάλματα JS', realErrors.length === 0, realErrors.slice(0, 4).join(' ; '));
await browser.close();
const failed = results.filter(r => !r[1]).length;
console.log(`\n${results.length - failed}/${results.length} επιτυχίες`);
process.exit(failed ? 1 : 0);
