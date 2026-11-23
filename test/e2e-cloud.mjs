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

const calls = [];
await page.addInitScript(() => localStorage.setItem('secondvision.settings.v1', JSON.stringify({ geminiKey: 'TESTKEY', geminiModel: 'gemini-3.8-flash' })));
await page.route('https://generativelanguage.googleapis.com/**', route => {
  const u = route.request().url(); const h = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
  if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: h });
  calls.push(u.split('/v1beta/')[1].split('?')[0]);
  if (u.includes('/models?')) return route.fulfill({ status: 200, headers: h, contentType: 'application/json', body: JSON.stringify({ models: [
    { name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] }, { name: 'models/gemini-3.1-flash', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] }] }) });
  if (u.includes('gemini-3.8-flash')) return route.fulfill({ status: 404, headers: h, body: '{}' });
  const body = JSON.parse(route.request().postData());
  const prompt = body.contents[0].parts.find(p => p.text).text; const hasImg = body.contents[0].parts.some(p => p.inline_data?.data?.length > 1000);
  const text = !hasImg ? 'ΧΩΡΙΣ ΕΙΚΟΝΑ' : /JSON/.test(prompt) ? JSON.stringify({ name: 'κλειδί', description: 'Μεταλλικό κλειδί κλειδαριάς. Φαίνεται παλιό.' }) : 'Μπροστά σας υπάρχει ένα κομοδίνο με φωτιστικό. Δεξιά είναι ένα κρεβάτι.';
  route.fulfill({ status: 200, headers: h, contentType: 'application/json', body: JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }) });
});
await page.goto(BASE);
await page.evaluate(() => window.__setImg('tennis'));
await page.click('#btnStart');
await page.waitForFunction(() => document.getElementById('status')?.dataset.kind === 'ready', null, { timeout: 120000 });
await page.evaluate(() => { const v = window.__sv.voice; const o = v.speak.bind(v); v.speak = (t, opts) => { window.__said.push(t); o(t, opts); }; });
const said = () => page.evaluate(() => window.__said.slice());
await page.waitForFunction(() => window.__sv.st.tracks.some(t => t.hits >= 2), null, { timeout: 30000 }).catch(() => {});

// Ταυτοποίηση + μάθηση
await page.evaluate(() => { window.__said.length = 0; window.__sv.st.testConfirm = true; });
await page.evaluate(() => window.__sv.identify(null));
let s = await said();
ok('Gemini: «τι είναι αυτό» δίνει όνομα και περιγραφή', s.some(x => /κλειδί\. Μεταλλικό κλειδί/.test(x) || /Μεταλλικό κλειδί/.test(x)), s.join(' | '));
ok('Gemini: το άγνωστο μοντέλο (404) αντικαθίσταται αυτόματα από τη λίστα', calls.some(c => c.includes('gemini-3.1-flash:generateContent')), calls.join(','));
ok('Gemini: δεν επιλέγονται μοντέλα embedding', !calls.some(c => c.includes('embedding')));
ok('Μάθηση: αποθηκεύεται το αντικείμενο που είπε το cloud', await page.evaluate(() => window.__sv.memory.items.some(i => i.name === 'κλειδί' && i.embeddings.length >= 3)));
ok('Μάθηση: ρωτά πριν αποθηκεύσει', s.some(x => /Θέλετε να το θυμάμαι ως κλειδί/.test(x)));
await page.evaluate(() => { window.__said.length = 0; window.__sv.st.testConfirm = false; });
await page.evaluate(() => window.__sv.identify(null));
ok('Μάθηση: με «όχι» δεν διπλοαποθηκεύει', await page.evaluate(() => window.__sv.memory.items.length) === 1);

// Αναλυτική περιγραφή
await page.evaluate(() => { window.__said.length = 0; return window.__sv.handleUtterance(['περιέγραψε αναλυτικά']); });
await page.waitForFunction(() => window.__said.some(x => /κομοδίνο/.test(x)), null, { timeout: 30000 }).catch(() => {});
s = await said();
ok('Αναλυτική περιγραφή από Gemini', s.some(x => /κομοδίνο/.test(x)), s.join(' | '));

// Χωρίς κλειδί → τοπική περιγραφή
await page.evaluate(() => { const st = JSON.parse(localStorage.getItem('secondvision.settings.v1')); });
await browser.close();
const failed = results.filter(r => !r[1]).length;
console.log(`\n${results.length - failed}/${results.length} επιτυχίες`);
process.exit(failed ? 1 : 0);
