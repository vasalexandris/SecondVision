// Δεύτερη Όραση — κεντρική λογική: βρόχος ανίχνευσης, φωνητικές εντολές, αναζήτηση 360°, μνήμη, κίνδυνοι.
import { settings, onSettingChange, resetSettings } from './settings.js';
import { Memory, uid } from './memory.js';
import { Sensors } from './sensors.js';
import { Camera } from './camera.js';
import { Voice, listenOnce, recognitionSupported, WakeListener } from './speech.js';
import { unlockAudio, chime, GuideBeeper, vibrate, beep } from './audio.js';
import { Detector, Embedder, frameLuma } from './vision.js';
import { Tracker } from './tracker.js';
import { loadFaces, detectFaces, matchPerson, facesLoaded } from './faces.js';
import { readText } from './ocr.js';
import { parseCommand, norm, resolveTarget } from './commands.js';
import { classInfo, classCandidates, pluralize, HAZARD_CLASSES, WALK_CATS, S } from './lang-el.js';
import * as G from './spatial.js';

const $ = id => document.getElementById(id);
const sleep = ms => new Promise(r => setTimeout(r, ms));

const video = $('video'), overlay = $('overlay'), octx = overlay.getContext('2d');
const voice = new Voice(), sensors = new Sensors(), memory = new Memory(), cam = new Camera(video);
const detector = new Detector(), embedder = new Embedder(), tracker = new Tracker(), beeper = new GuideBeeper();

// ---------------- Κατάσταση ----------------
const st = {
  running: false, paused: false, busy: false /* εκμάθηση/ακρόαση: σιγή ανακοινώσεων */, listening: false,
  luma: 0.5, lowLightSince: 0, brightSince: 0, torchManual: false, lastLowLightWarn: 0,
  fps: 0, frames: 0, lastFpsT: performance.now(), lastVideoTime: -1, lastLumaT: 0,
  lastAmbient: 0, lastCustomScan: 0, lastFaceT: 0, faceBusy: false, lastHazard: new Map(),
  lastSpoken: new Map(), tracks: [], hfov: 50, wake: null
};
const search = { active: false, target: null, t0: 0, bins: null, fix: null, foundSaid: false, lastSay: 0, reachedSaid: false, lostSaid: false };
const scan = { active: false, t0: 0, bins: null, seen: new Map(), halfSaid: false, auto: false };
const nav = { active: false, place: null, lastSay: 0 };

// ---------------- Βοηθητικά ----------------
const candidates = () => [...classCandidates(), ...memory.candidates()];

function say(text, opts = {}) {
  const { key, gain = 1, priority = 2 } = opts;
  voice.speak(text, { priority, gain, key });
  $('said').textContent = text;
  if (priority >= 2) addLog('🔊', text);
}

function addLog(icon, text) {
  const li = document.createElement('li');
  li.innerHTML = `<span>${icon}</span><span></span><time>${new Date().toLocaleTimeString('el-GR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time>`;
  li.children[1].textContent = text;
  const ul = $('log'); ul.prepend(li);
  while (ul.children.length > 40) ul.lastChild.remove();
}

const keyOf = tr => tr.cls.startsWith('custom:') ? tr.cls.slice(7) : (tr.personId || tr.cls);
function labelOf(tr) {
  if (tr.name) return tr.name;
  if (tr.cls.startsWith('custom:')) return memory.items.find(i => i.id === tr.cls.slice(7))?.name || 'αντικείμενο';
  return classInfo(tr.cls).el;
}
const gainOf = tr => settings.classGain[keyOf(tr)] ?? settings.classGain[tr.cls] ?? 1;
const mutedOf = tr => !!(settings.classMute[keyOf(tr)] || settings.classMute[tr.cls]);
const catOf = tr => tr.cls.startsWith('custom:') ? 'custom' : classInfo(tr.cls).cat;

function setStatus(text, kind = '') { const el = $('status'); el.textContent = text; el.dataset.kind = kind; }
function updateChips() {
  $('chipMode').textContent = settings.mode === 'walk' ? '🚶 Περπάτημα' : '🏠 Εξερεύνηση';
  const act = search.active ? `🔎 ${search.target.label}` : scan.active ? '🔄 Σάρωση 360°' : nav.active ? `🧭 ${nav.place.name}` : st.paused ? '⏸ Παύση' : '';
  $('chipAct').textContent = act; $('chipAct').hidden = !act;
  $('chipTorch').textContent = cam.torchOn ? '🔦 Φακός' : ''; $('chipTorch').hidden = !cam.torchOn;
}

// ---------------- Εκκίνηση ----------------
async function start() {
  $('btnStart').disabled = true;
  unlockAudio();
  voice.speak('Έναρξη. ' + S.loading, { priority: 2 }); // πρέπει να ξεκινήσει μέσα στο gesture
  try {
    await sensors.start();
    await cam.start({ facing: settings.facing, deviceId: settings.deviceId });
  } catch (e) {
    console.error(e);
    $('introErr').textContent = 'Σφάλμα κάμερας: ' + (e.message || e.name) + '. Δώστε άδεια κάμερας και δοκιμάστε ξανά.';
    voice.speak(S.noCamera, { priority: 2 });
    $('btnStart').disabled = false;
    return;
  }
  $('intro').hidden = true; $('app').hidden = false;
  setStatus('Φόρτωση μοντέλων…', 'loading');
  try {
    await memory.load();
    await Promise.all([detector.load(settings.model, settings.minScore), embedder.load().catch(e => console.warn('embedder', e))]);
  } catch (e) {
    console.error(e);
    setStatus('Σφάλμα φόρτωσης μοντέλων: ' + e.message, 'error');
    voice.speak('Σφάλμα φόρτωσης των μοντέλων.', { priority: 2 });
    return;
  }
  if (settings.handsFree) wakeListener.start();
  st.running = true;
  registerSW();
  setStatus('Έτοιμο', 'ready');
  chime.ready();
  say(S.welcome, { priority: 2 });
  updateChips();
  requestAnimationFrame(loop);
  setInterval(housekeeping, 1000);
}

// ---------------- Κύριος βρόχος ----------------
const MIN_FRAME_MS = 70; // ~14 fps ανώτατο — εξοικονόμηση μπαταρίας
let lastFrameT = 0;
function loop(now) {
  requestAnimationFrame(loop);
  if (!st.running || st.paused) return;
  if (now - lastFrameT < MIN_FRAME_MS) return;
  if (st.learningFaces || video.readyState < 2 || video.currentTime === st.lastVideoTime) return;
  st.lastVideoTime = video.currentTime;
  lastFrameT = now;
  try { processFrame(now); } catch (e) { console.error('frame', e); }
}

function processFrame(now) {
  const W = video.videoWidth, H = video.videoHeight;
  if (!W) return;
  if (overlay.width !== W || overlay.height !== H) { overlay.width = W; overlay.height = H; }
  st.hfov = G.horizontalFov(settings.fovLong, W, H);
  const heading = sensors.headingNow();

  const dets = detector.detect(video, now).filter(d => d.score >= settings.minScore).map(d => ({
    ...d,
    angle: G.bboxAngle(d.bbox, W, st.hfov),
    dist: G.estimateDistance(d.cls, d.bbox, W, H, st.hfov)
  }));
  for (const d of dets) d.az = heading != null ? G.normHeading(heading + d.angle) : null;

  // Νέα αντικείμενα (embeddings): πιο συχνά όταν ψάχνουμε κάτι τέτοιο
  const customTarget = search.active && search.target.kind === 'custom';
  const needCustom = memory.items.length && embedder.ready && !st.busy;
  if (needCustom && (customTarget || now - st.lastCustomScan > 700)) {
    st.lastCustomScan = now;
    if (embedder.snapshot(video)) {
      const items = customTarget ? memory.items.filter(i => i.id === search.target.id) : memory.items;
      const thr = customTarget ? 0.78 : 0.84; // πιο αυστηρό όταν δεν ψάχνουμε (λιγότερα ψευδώς θετικά)
      for (const h of embedder.scan(items, customTarget ? 5 : 3, thr)) {
        const angle = G.bboxAngle(h.bbox, W, st.hfov);
        dets.push({ cls: 'custom:' + h.id, score: h.sim, bbox: h.bbox, angle, dist: null, az: heading != null ? G.normHeading(heading + angle) : null });
      }
    }
  }

  const tracks = tracker.update(dets, now);
  st.tracks = tracks;

  // Αναγνώριση προσώπων (ασύγχρονα, χαμηλή συχνότητα)
  maybeRecognizeFaces(tracks, now);

  if (!st.busy) {
    updateHazards(tracks);
    updateSearch(tracks, heading, now);
    updateScan(tracks, heading, now);
    updateNav(heading, now);
    announceAmbient(tracks, now);
  }
  recordSightings(tracks, heading);
  draw(tracks);

  st.frames++;
  if (now - st.lastFpsT >= 1000) { st.fps = st.frames; st.frames = 0; st.lastFpsT = now; $('fps').textContent = st.fps + ' fps'; }
}

function housekeeping() {
  if (!st.running) return;
  // Αυτόματο φλας
  const l = frameLuma(video);
  if (l != null) {
    st.luma = st.luma * 0.6 + l * 0.4;
    const now = Date.now();
    if (cam.torchOn) {
      if (st.luma > 0.7) { st.brightSince ||= now; if (now - st.brightSince > 4000 && !st.torchManual) { cam.setTorch(false); st.brightSince = 0; updateChips(); } } else st.brightSince = 0;
    } else if (st.luma < 0.1) {
      st.lowLightSince ||= now;
      if (now - st.lowLightSince > 3000) {
        if (settings.autoTorch && !st.torchManual && cam.torchSupported) {
          cam.setTorch(true).then(() => { say('Χαμηλός φωτισμός. Άναψα το φακό.', { priority: 2 }); updateChips(); });
        } else if (now - st.lastLowLightWarn > 300000) {
          st.lastLowLightWarn = now; say('Χαμηλός φωτισμός. Η αναγνώριση μπορεί να είναι λιγότερο αξιόπιστη.', { priority: 2 });
        }
        st.lowLightSince = now + 1e9; // μία φορά ανά επεισόδιο
      }
    } else st.lowLightSince = 0;
  }
  if (!sensors.hasOrientation) $('chipCompass').textContent = '🧭 —'; else $('chipCompass').textContent = '🧭 ' + Math.round(sensors.pose.heading ?? 0) + '°';
  updateChips();
}

// ---------------- Πρόσωπα ----------------
function maybeRecognizeFaces(tracks, now) {
  if (!settings.faces || st.faceBusy || !memory.people.length) return;
  const persons = tracks.filter(t => t.cls === 'person');
  if (!persons.length) return;
  const interval = search.active && search.target.kind === 'person' ? 600 : 1500;
  if (now - st.lastFaceT < interval) return;
  st.lastFaceT = now; st.faceBusy = true;
  detectFaces(video).then(faces => {
    for (const f of faces) {
      const cx = f.box.x + f.box.w / 2, cy = f.box.y + f.box.h / 2;
      const tr = persons.find(t => cx > t.bbox.x && cx < t.bbox.x + t.bbox.w && cy > t.bbox.y && cy < t.bbox.y + t.bbox.h);
      if (!tr) continue;
      const m = matchPerson(f.descriptor, memory.people);
      if (m) { tr.name = m.person.name; tr.personId = m.person.id; tr.nameT = now; }
    }
  }).catch(e => console.warn('faces', e)).finally(() => { st.faceBusy = false; });
}

// ---------------- Κίνδυνοι ----------------
function updateHazards(tracks) {
  const now = Date.now();
  for (const tr of tracks) {
    if (tr.dist == null) continue;
    const speed = Tracker.approachSpeed(tr);
    const inPath = Math.abs(tr.angle) < st.hfov * 0.45;
    let msg = null, urgent = false;
    if (HAZARD_CLASSES.has(tr.cls)) {
      if (tr.dist < 3 || (speed > 1.2 && tr.dist < 10) || (tr.dist < 6 && inPath)) { msg = `Προσοχή! ${labelOf(tr)} ${speed > 1.2 ? 'πλησιάζει' : 'κοντά'}, ${G.describeRelative(tr.angle)}`; urgent = true; }
    } else if (tr.cls === 'person' || classInfo(tr.cls).cat === 'animal') {
      if (tr.dist < 0.9 && inPath && settings.mode === 'walk') { msg = `Προσοχή, ${labelOf(tr)} πολύ κοντά μπροστά`; urgent = true; }
    } else if (settings.mode === 'walk' && classInfo(tr.cls).cat === 'obstacle' && tr.dist < 1.4 && inPath) {
      msg = `Εμπόδιο: ${labelOf(tr)} ${G.describeDistance(tr.dist)}, ${G.describeRelative(tr.angle)}`;
    }
    if (!msg || mutedOf(tr) && !urgent) continue;
    const last = st.lastHazard.get(tr.id) || 0;
    if (now - last < (urgent ? 3500 : 5000)) continue;
    st.lastHazard.set(tr.id, now);
    voice.speak(msg, { priority: urgent ? 3 : 2, key: 'hazard' });
    $('said').textContent = msg; addLog('⚠️', msg);
    if (urgent) { chime.danger(); if (settings.haptics) vibrate([200, 80, 200]); }
  }
  if (st.lastHazard.size > 200) st.lastHazard.clear();
}

// ---------------- Ανακοινώσεις περιβάλλοντος ----------------
function announceAmbient(tracks, now) {
  if (!settings.voice || search.active || scan.active) return;
  if (now - st.lastAmbient < 900) return;
  st.lastAmbient = now;
  const t = Date.now();
  const groups = new Map();
  for (const tr of tracks) {
    if (tr.hits < 3 || mutedOf(tr) || tr.cls.startsWith('custom:') === false && tr.score < Math.max(settings.minScore, 0.5)) continue;
    const cat = catOf(tr);
    if (settings.mode === 'walk' && !WALK_CATS.has(cat) && cat !== 'custom') continue;
    if (settings.verbosity === 0 && !(cat === 'custom' || cat === 'person' || cat === 'vehicle' || cat === 'animal' || (cat === 'obstacle' && tr.dist != null && tr.dist < 2))) continue;
    const key = keyOf(tr) + (tr.name ? ':n' : '');
    const g = groups.get(key) || { key, tracks: [], label: labelOf(tr), cat, prio: 0 };
    g.tracks.push(tr);
    groups.set(key, g);
  }
  const pending = [];
  for (const g of groups.values()) {
    const rec = st.lastSpoken.get(g.key);
    const count = g.tracks.length;
    const fresh = !rec || t - rec.t > settings.voiceDelay * 1000 || count > rec.count;
    if (!fresh) continue;
    g.count = count;
    g.near = g.tracks.reduce((a, b) => ((b.dist ?? 99) < (a.dist ?? 99) ? b : a));
    g.prio = { vehicle: 5, person: 4, animal: 3, custom: 4, obstacle: 2, sign: 2 }[g.cat] || 1;
    pending.push(g);
  }
  if (!pending.length) return;
  pending.sort((a, b) => b.prio - a.prio || (a.near.dist ?? 99) - (b.near.dist ?? 99));
  const max = [1, 2, 4][settings.verbosity] ?? 2;
  for (const g of pending.slice(0, max)) {
    const info = classInfo(g.near.cls);
    const parts = [pluralize(g.label, info.plural, g.count)];
    if (g.count === 1) {
      const a = g.near.angle;
      parts.push(Math.abs(a) < st.hfov * 0.18 ? 'μπροστά' : a < 0 ? 'αριστερά' : 'δεξιά');
      if (g.near.dist != null && (settings.verbosity === 2 || g.near.dist < 3)) parts.push(G.describeDistance(g.near.dist));
    }
    voice.speak(parts.join(', '), { priority: 0, gain: gainOf(g.near), key: 'amb:' + g.key });
    st.lastSpoken.set(g.key, { t, count: g.count });
    addLog(info.emoji, parts.join(', '));
  }
}

// ---------------- Μνήμη θέσεων ----------------
function nearestPlace(pos, maxM = 60) {
  if (!pos) return null;
  let best = null;
  for (const p of memory.places) {
    const v = G.geoVector(pos.lat, pos.lon, p.lat, p.lon);
    if (v.distance < maxM && (!best || v.distance < best.dist)) best = { place: p, dist: v.distance };
  }
  return best?.place || null;
}

function recordSightings(tracks, heading) {
  const now = Date.now();
  for (const tr of tracks) {
    if (tr.hits < (tr.cls.startsWith('custom:') ? 2 : 4) || (tr.flags.rec && now - tr.flags.rec < 4000)) continue;
    if (tr.cls === 'person' && !tr.name) continue; // ανώνυμους ανθρώπους δεν τους αποθηκεύουμε
    tr.flags.rec = now;
    const key = tr.cls.startsWith('custom:') ? tr.cls : tr.personId ? 'person:' + tr.personId : tr.cls;
    const pos = sensors.freshPosition();
    memory.noteSighting({
      key, id: keyOf(tr), label: labelOf(tr), kind: tr.cls.startsWith('custom:') ? 'custom' : tr.personId ? 'person' : 'class',
      t: now, az: sensors.pose.absolute && tr.az != null ? Math.round(tr.az) : null, dist: tr.dist != null ? +tr.dist.toFixed(2) : null,
      lat: pos?.lat ?? null, lon: pos?.lon ?? null, acc: pos?.acc ?? null, placeName: nearestPlace(pos)?.name ?? null
    });
  }
}

function sightingFor(target) {
  const keys = target.kind === 'custom' ? ['custom:' + target.id] : target.kind === 'person' ? ['person:' + target.id] : [target.id];
  for (const k of keys) { const s = memory.sightings.get(k); if (s) return s; }
  return null;
}

/** Φράση «πού το είδαμε τελευταία φορά» + πιθανή οπτική καθοδήγηση αν είμαστε στο ίδιο σημείο. */
function describeSighting(s) {
  const parts = [`Τελευταία φορά ${s.label} το είδα ${G.describeAge(Date.now() - s.t)}`];
  if (s.placeName) parts.push(`στο ${s.placeName}`);
  const here = sameSpot(s);
  const heading = sensors.headingNow();
  if (here && s.az != null && heading != null) {
    const rel = G.normAngle(s.az - heading);
    parts.push(`${G.describeRelative(rel)}${s.dist != null ? ', ' + G.describeDistance(s.dist) : ''}`);
  } else if (s.az != null && here) {
    parts.push(`προς τα ${G.compassName(s.az)}${s.dist != null ? ', ' + G.describeDistance(s.dist) : ''}`);
  } else if (!here && s.lat != null && !s.placeName) {
    parts.push('σε άλλο μέρος από εδώ');
  }
  return parts.join(', ') + '.';
}
function sameSpot(s) {
  const pos = sensors.freshPosition();
  if (!pos || s.lat == null) return s.lat == null; // χωρίς GPS δεν μπορούμε να αποκλείσουμε το ίδιο σημείο
  const v = G.geoVector(pos.lat, pos.lon, s.lat, s.lon);
  return v.distance < Math.max(25, (pos.acc || 0) + (s.acc || 0));
}

// ---------------- Αναζήτηση (το «βρες τα κλειδιά» με στροφή 360°) ----------------
const BIN = 15;
const makeBins = () => new Array(360 / BIN).fill(false);
function markBins(bins, heading, hfov) {
  if (heading == null) return;
  for (let a = -hfov / 2; a <= hfov / 2; a += BIN / 2) bins[Math.floor(G.normHeading(heading + a) / BIN)] = true;
}
const coverage = bins => bins.filter(Boolean).length / bins.length;

function matchesTarget(tr, target) {
  if (target.kind === 'custom') return tr.cls === 'custom:' + target.id;
  if (target.kind === 'person') return tr.cls === 'person' && tr.personId === target.id;
  return tr.cls === target.id;
}

async function startSearch(target) {
  stopActivities(true);
  search.active = true; search.target = target; search.t0 = performance.now(); search.bins = makeBins();
  search.fix = null; search.foundSaid = false; search.lastSay = 0; search.reachedSaid = false; search.lostSaid = false;
  settings.faces && target.kind === 'person' && loadFaces().catch(() => {});
  const intro = [];
  const s = sightingFor(target);
  if (s) {
    intro.push(describeSighting(s));
    // Αν είμαστε στο ίδιο σημείο, η μνήμη δίνει αρχική κατεύθυνση
    if (s.az != null && sameSpot(s) && sensors.pose.absolute) search.fix = { az: s.az, dist: s.dist, t: Date.now(), fromMemory: true, visible: false };
  }
  intro.push(search.fix ? 'Ξεκινάω την αναζήτηση.' : `Ψάχνω ${target.label}. Γυρίστε αργά γύρω σας.`);
  say(intro.join(' '), { priority: 2 });
  beeper.start(searchTone);
  updateChips();
}

function searchTone() {
  if (!search.active || !settings.beeps) return null;
  const heading = sensors.headingNow();
  const fix = search.fix;
  if (!fix) return null; // σάρωση χωρίς στόχο: σιωπή
  if (fix.visible && fix.angle != null) {
    const near = fix.dist != null ? Math.max(0, 1 - Math.min(fix.dist, 4) / 4) : 0.5;
    return { rate: 2 + near * 7, freq: 600 + near * 500, pan: Math.max(-1, Math.min(1, fix.angle / (st.hfov / 2))) };
  }
  if (heading != null && fix.az != null) return G.guidanceTone(G.normAngle(fix.az - heading));
  return null;
}

function updateSearch(tracks, heading, now) {
  if (!search.active) return;
  const nowMs = Date.now();
  markBins(search.bins, heading, st.hfov);
  const hits = tracks.filter(t => matchesTarget(t, search.target));
  if (hits.length) {
    const best = hits.reduce((a, b) => ((a.dist ?? 9) < (b.dist ?? 9) ? a : b));
    search.fix = { az: best.az, angle: best.angle, dist: best.dist, t: nowMs, visible: true, bbox: best.bbox };
    const areaFrac = best.bbox.w * best.bbox.h / (video.videoWidth * video.videoHeight);
    if (!search.foundSaid) {
      search.foundSaid = true; search.lostSaid = false;
      chime.found(); if (settings.haptics) vibrate([100, 60, 100]);
      say(`Βρέθηκε ${search.target.label}! ${G.describeRelative(best.angle)}${best.dist != null ? ', ' + G.describeDistance(best.dist) : ''}.`, { priority: 2 });
      search.lastSay = nowMs;
    } else if ((best.dist != null && best.dist < 0.7 || areaFrac > 0.3) && !search.reachedSaid) {
      search.reachedSaid = true;
      say('Το έχετε μπροστά σας. Απλώστε το χέρι.', { priority: 2 });
      search.lastSay = nowMs;
    } else if (nowMs - search.lastSay > 4000 && !search.reachedSaid) {
      const side = Math.abs(best.angle) < st.hfov * 0.15 ? 'ευθεία μπροστά' : best.angle < 0 ? 'λίγο αριστερά' : 'λίγο δεξιά';
      say(`${side}${best.dist != null ? ', ' + G.describeDistance(best.dist) : ''}`, { priority: 1, key: 'guide' });
      search.lastSay = nowMs;
    }
    return;
  }
  const fix = search.fix;
  if (fix) fix.visible = false;
  if (fix && heading != null && fix.az != null && nowMs - fix.t < 60000) {
    const rel = G.normAngle(fix.az - heading);
    if (nowMs - search.lastSay > 3500) {
      search.lastSay = nowMs;
      if (Math.abs(rel) < 12) say(fix.fromMemory ? 'Εκεί κοντά. Κοιτάξτε και ψάξτε με το χέρι.' : 'Ευθεία μπροστά.', { priority: 1, key: 'guide' });
      else say(G.turnInstruction(rel), { priority: 1, key: 'guide' });
    }
    return;
  }
  if (fix && !search.lostSaid && nowMs - fix.t > 5000) { // το χάσαμε και δεν έχουμε πυξίδα/έχει λήξει
    search.lostSaid = true; search.foundSaid = false; search.reachedSaid = false;
    say(`Έχασα το ${search.target.label}. Συνεχίστε να γυρίζετε αργά.`, { priority: 1 });
  }
  // Πλήρης κύκλος χωρίς αποτέλεσμα
  const elapsed = (performance.now() - search.t0) / 1000;
  if (heading != null && coverage(search.bins) >= 0.92 && elapsed > 6) return endSearchNotFound('Ολοκληρώθηκε πλήρης κύκλος.');
  if (elapsed > 90) endSearchNotFound('Πέρασε αρκετή ώρα.');
}

function endSearchNotFound(prefix) {
  const target = search.target;
  stopActivities(true);
  chime.error();
  say(`${prefix} Δεν βρήκα ${target.label}. Δοκιμάστε από άλλο σημείο, πλησιάστε πιο κοντά ή σκύψτε και πείτε ξανά βρες.`, { priority: 2 });
}

// ---------------- Σάρωση 360° ----------------
function startScan() {
  stopActivities(true);
  scan.active = true; scan.t0 = performance.now(); scan.bins = makeBins(); scan.seen = new Map(); scan.halfSaid = false;
  const hasCompass = sensors.headingNow() != null;
  scan.auto = !hasCompass;
  say(hasCompass ? 'Σάρωση 360 μοιρών. Γυρίστε αργά γύρω σας, όπως έχετε.' : 'Δεν έχω πυξίδα. Γυρίστε αργά γύρω σας· θα σας πω σε 20 δευτερόλεπτα.', { priority: 2 });
  updateChips();
}

function updateScan(tracks, heading, now) {
  if (!scan.active) return;
  markBins(scan.bins, heading, st.hfov);
  for (const tr of tracks) {
    if (tr.hits < 3 || mutedOf(tr) || tr.score < 0.5) continue;
    if (tr.cls === 'person' && !tr.name && tr.score < 0.6) continue;
    const az = tr.az ?? 0;
    const key = keyOf(tr) + ':' + (tr.az != null ? Math.round(az / 30) : 0);
    const e = scan.seen.get(key) || { label: labelOf(tr), cls: tr.cls, az: tr.az, dist: tr.dist, plural: classInfo(tr.cls).plural, n: 0 };
    e.n++; e.az = tr.az; e.dist = tr.dist ?? e.dist;
    scan.seen.set(key, e);
  }
  const cov = coverage(scan.bins), el = (performance.now() - scan.t0) / 1000;
  if (!scan.auto && !scan.halfSaid && cov > 0.5) { scan.halfSaid = true; say('Μισή στροφή.', { priority: 1, key: 'guide' }); }
  if ((!scan.auto && cov >= 0.92 && el > 5) || el > (scan.auto ? 20 : 75)) finishScan();
}

function finishScan() {
  const heading = sensors.headingNow();
  const entries = [...scan.seen.values()].filter(e => e.n >= 3);
  scan.active = false; updateChips();
  chime.done();
  if (!entries.length) return say('Ολοκληρώθηκε η σάρωση. Δεν αναγνώρισα αντικείμενα γύρω σας.', { priority: 2 });
  // Ομαδοποίηση ανά θέση ρολογιού
  const parts = entries.map(e => {
    const rel = heading != null && e.az != null ? G.normAngle(e.az - heading) : null;
    return { e, rel, clock: rel != null ? G.clockPosition(rel) : null };
  }).sort((a, b) => (a.rel ?? 0) - (b.rel ?? 0)).slice(0, 10);
  const text = parts.map(p => `${p.e.label}${p.clock ? ' στις ' + p.clock : ''}${p.e.dist != null && p.e.dist < 3 ? ', ' + G.describeDistance(p.e.dist) : ''}`).join('. ');
  say(`Ολοκληρώθηκε η σάρωση. ${heading != null ? 'Σε σχέση με εκεί που κοιτάτε τώρα: ' : ''}${text}.`, { priority: 2 });
}

// ---------------- Πλοήγηση σε τόπο (GPS) ----------------
function startNav(place) {
  stopActivities(true);
  nav.active = true; nav.place = place; nav.lastSay = 0;
  say(`Οδηγώ προς ${place.name}. Προσέξτε το περιβάλλον — θα σας ειδοποιώ και για εμπόδια.`, { priority: 2 });
  beeper.start(navTone);
  updateChips();
}
function navVector() {
  const pos = sensors.freshPosition(30000);
  if (!pos || !nav.place) return null;
  return G.geoVector(pos.lat, pos.lon, nav.place.lat, nav.place.lon);
}
function navTone() {
  if (!nav.active || !settings.beeps) return null;
  const v = navVector(), h = sensors.headingNow();
  return v && h != null ? G.guidanceTone(G.normAngle(v.bearing - h)) : null;
}
function updateNav(heading, now) {
  if (!nav.active) return;
  const t = Date.now();
  if (t - nav.lastSay < 5000) return;
  nav.lastSay = t;
  const v = navVector();
  if (!v) return say('Δεν έχω σήμα GPS.', { priority: 1, key: 'nav' });
  if (v.distance < 12) { const n = nav.place.name; stopActivities(true); chime.found(); return say(`Φτάσατε στο ${n}.`, { priority: 2 }); }
  if (heading != null) say(`${G.turnInstruction(G.normAngle(v.bearing - heading))}. ${G.describeLongDistance(v.distance)}.`, { priority: 1, key: 'nav' });
  else say(`${nav.place.name}: προς τα ${G.compassName(v.bearing)}, ${G.describeLongDistance(v.distance)}.`, { priority: 1, key: 'nav' });
}

function stopActivities(silent = false) {
  const was = search.active || scan.active || nav.active;
  search.active = false; scan.active = false; nav.active = false;
  beeper.stop();
  updateChips();
  return was;
}

// ---------------- Εκμάθηση ----------------
async function askText(question, timeoutMs = 8000) {
  say(question, { priority: 2 });
  await waitSilence();
  try {
    chime.listening();
    const alts = await listenOnce({ timeoutMs });
    return (alts && alts[0]) ? alts[0].replace(/[.,;!?]+$/g, '').trim() : '';
  } catch { return ''; }
}
async function waitSilence() {
  const start = Date.now();
  await sleep(150);
  while (voice.speaking && Date.now() - start < 15000) await sleep(100);
}

async function confirm(question) {
  const a = await askText(question + ' Πείτε ναι ή όχι.', 6000);
  return /^(ναι|σωστα|εντασει|οκ|ok|φυσικα|βεβαιως)/.test(norm(a));
}

const cleanName = n => (n || '').replace(/^(το|τα|ο|η|οι|τον|την|τη)\s+/i, '').trim();

async function learnObject(name) {
  if (!embedder.ready) return say('Η εκμάθηση νέων αντικειμένων δεν είναι διαθέσιμη σε αυτή τη συσκευή.', { priority: 2 });
  stopActivities(true);
  st.busy = true;
  try {
    name = cleanName(name) || cleanName(await askText('Πώς θέλετε να το ονομάσουμε;'));
    if (!name) return say('Δεν άκουσα όνομα. Πείτε ξανά, μάθε αυτό ως, και το όνομα.', { priority: 2 });
    say(`Κρατήστε το αντικείμενο μπροστά στην κάμερα, στο κέντρο, πολύ κοντά. Ξεκινάω σε 3, 2, 1.`, { priority: 2 });
    await waitSilence(); await sleep(300);
    const samples = [];
    for (let i = 0; i < 8; i++) {
      if (embedder.snapshot(video, 480)) samples.push(...embedder.embedCenterSamples().map(e => Float32Array.from(e)));
      chime.learn(); if (settings.haptics) vibrate(30);
      await sleep(350);
    }
    if (samples.length < 12) return say('Δεν κατάφερα να καταγράψω εικόνα. Δοκιμάστε ξανά.', { priority: 2 });
    // Έλεγχος σταθερότητας: αν τα δείγματα διαφέρουν πολύ, το αντικείμενο μάλλον κινήθηκε
    const first = samples[1], last = samples[samples.length - 2];
    let sim = 0; for (let i = 0; i < first.length; i++) sim += first[i] * last[i];
    const existing = memory.items.find(i => norm(i.name) === norm(name));
    const item = existing || { id: uid(), name, embeddings: [], created: Date.now() };
    item.embeddings = item.embeddings.concat(samples).slice(-60);
    await memory.saveItem(item);
    chime.found();
    say(`Έμαθα ${name}.${sim < 0.6 ? ' Προσοχή, το αντικείμενο φαίνεται να κινήθηκε· ίσως χρειαστεί να το ξαναμάθετε.' : ''} Για να το ψάξετε πείτε: βρες ${name}. Για καλύτερη αναγνώριση, επαναλάβετε δείχνοντας άλλη πλευρά.`, { priority: 2 });
  } finally { st.busy = false; }
}

async function learnPerson(name, existing) {
  if (!settings.faces) return say('Η αναγνώριση προσώπων είναι απενεργοποιημένη στις ρυθμίσεις.', { priority: 2 });
  stopActivities(true);
  st.busy = true;
  try {
    name = (name || '').trim() || (await askText('Πώς λέγεται το άτομο;')).trim();
    if (!name) return say('Δεν άκουσα όνομα. Δοκιμάστε ξανά.', { priority: 2 });
    say('Φόρτωση αναγνώρισης προσώπων.', { priority: 2 });
    await loadFaces();
    say(`Ζητήστε από το άτομο να κοιτάξει την κάμερα. Μαθαίνω το πρόσωπο του ${name}.`, { priority: 2 });
    await waitSilence();
    const descs = [];
    const t0 = Date.now();
    st.learningFaces = true;
    while (descs.length < 5 && Date.now() - t0 < 40000) {
      const faces = await detectFaces(video);
      if (faces.length) {
        const f = faces.reduce((a, b) => (b.box.w * b.box.h > a.box.w * a.box.h ? b : a));
        descs.push(Float32Array.from(f.descriptor)); chime.learn();
      }
      await sleep(400);
    }
    if (descs.length < 3) return say('Δεν είδα καθαρά πρόσωπο. Πλησιάστε και βεβαιωθείτε ότι υπάρχει φως, μετά δοκιμάστε ξανά.', { priority: 2 });
    const person = existing ? memory.people.find(p => p.id === existing.id) : memory.people.find(p => norm(p.name) === norm(name));
    const p = person || { id: uid(), name, descriptors: [], created: Date.now() };
    p.descriptors = p.descriptors.concat(descs).slice(-30);
    await memory.savePerson(p);
    chime.found();
    say(`Έμαθα ${name}. Η εικόνα αποθηκεύεται μόνο στη συσκευή σας. Θα τον αναφέρω με το όνομά του όταν τον βλέπω.`, { priority: 2 });
  } catch (e) {
    console.error(e); say('Δεν μπόρεσα να φορτώσω την αναγνώριση προσώπων.', { priority: 2 });
  } finally { st.busy = false; st.learningFaces = false; }
}

async function savePlace(name) {
  const pos = sensors.freshPosition(120000);
  if (!pos) return say('Δεν έχω ακόμη σήμα GPS. Βγείτε σε ανοιχτό χώρο και ξαναπροσπαθήστε.', { priority: 2 });
  st.busy = true;
  try {
    name = cleanName(name) || cleanName(await askText('Πώς θέλετε να ονομάσουμε αυτό το μέρος;'));
    if (!name) return say('Δεν άκουσα όνομα.', { priority: 2 });
    const ex = memory.places.find(p => norm(p.name) === norm(name));
    await memory.savePlace({ id: ex?.id || uid(), name, lat: pos.lat, lon: pos.lon, created: Date.now() });
    chime.done();
    say(`Αποθήκευσα το μέρος ${name}.`, { priority: 2 });
  } finally { st.busy = false; }
}

// ---------------- Διάβασμα κειμένου ----------------
async function doRead() {
  if (st.busy) return;
  stopActivities(true);
  st.busy = true;
  try {
    say('Κρατήστε σταθερά το κείμενο μπροστά στην κάμερα. Διαβάζω.', { priority: 2 });
    if (st.luma < 0.2 && cam.torchSupported && !cam.torchOn) await cam.setTorch(true);
    await sleep(900);
    const { text } = await readText(video);
    if (!text || text.length < 3) { chime.error(); return say('Δεν βρήκα κείμενο. Πλησιάστε, κρατήστε σταθερά και βεβαιωθείτε ότι υπάρχει φως.', { priority: 2 }); }
    chime.done();
    $('said').textContent = text; addLog('📖', text);
    for (const chunk of text.match(/[^.]{1,180}(\.|$)/g) || [text]) voice.speak(chunk.trim(), { priority: 2, key: null });
  } catch (e) {
    console.error(e); say('Δεν μπόρεσα να διαβάσω το κείμενο.', { priority: 2 });
  } finally { st.busy = false; }
}

// ---------------- Περιγραφή σκηνής ----------------
function describeScene() {
  const tracks = st.tracks.filter(t => t.hits >= 2 && !mutedOf(t));
  const parts = [];
  if (st.luma < 0.1) parts.push('Χαμηλός φωτισμός.');
  if (!tracks.length) { parts.push(S.nothingSeen); return say(parts.join(' '), { priority: 2 }); }
  const groups = new Map();
  for (const t of tracks) { const k = keyOf(t) + (t.name ? ':n' : ''); (groups.get(k) || groups.set(k, []).get(k)).push(t); }
  const items = [...groups.values()].map(g => ({ g, near: g.reduce((a, b) => ((b.dist ?? 99) < (a.dist ?? 99) ? b : a)) }))
    .sort((a, b) => (a.near.dist ?? 99) - (b.near.dist ?? 99)).slice(0, 8);
  const sentences = items.map(({ g, near }) => {
    const info = classInfo(near.cls);
    const label = pluralize(labelOf(near), info.plural, g.length);
    if (g.length > 1) return label;
    const side = Math.abs(near.angle) < st.hfov * 0.18 ? 'μπροστά' : near.angle < 0 ? 'αριστερά' : 'δεξιά';
    return `${label}, ${side}${near.dist != null && near.dist < 6 ? ', ' + G.describeDistance(near.dist) : ''}`;
  });
  parts.push('Βλέπω: ' + sentences.join('. ') + '.');
  say(parts.join(' '), { priority: 2 });
}

// ---------------- Εκτέλεση εντολών ----------------
async function execute(cmd) {
  const t = cmd.target;
  switch (cmd.intent) {
    case 'NONE': return;
    case 'HELP': return helpSpeak();
    case 'REPEAT': return say(voice.last || 'Δεν έχω κάτι να επαναλάβω.', { priority: 2 });
    case 'STOP': { const was = stopActivities(); voice.stop(); chime.done(); return was ? say('Εντάξει, σταμάτησα.', { priority: 2 }) : undefined; }
    case 'PAUSE': st.paused = true; stopActivities(true); updateChips(); return say(S.paused, { priority: 2 });
    case 'RESUME': st.paused = false; updateChips(); return say(S.resumed, { priority: 2 });
    case 'DESCRIBE': return describeScene();
    case 'SCAN': return startScan();
    case 'READ_TEXT': return doRead();
    case 'FIND': return startSearch(t);
    case 'WHERE': {
      const s = sightingFor(t);
      return say(s ? describeSighting(s) + ` Για να το ψάξω πείτε: βρες ${t.label}.` : `Δεν έχω δει ακόμη ${t.label}. Πείτε βρες ${t.label} για να το ψάξω.`, { priority: 2 });
    }
    case 'LEARN_OBJECT': return learnObject(cmd.name);
    case 'LEARN_PERSON': return learnPerson(cmd.name, cmd.existing);
    case 'SAVE_PLACE': return savePlace(cmd.name);
    case 'NAVIGATE': return startNav(t);
    case 'PLACE_INFO': {
      const pos = sensors.freshPosition(60000);
      const p = memory.places.find(x => x.id === t.id);
      if (!pos || !p) return say('Δεν έχω σήμα GPS.', { priority: 2 });
      const v = G.geoVector(pos.lat, pos.lon, p.lat, p.lon), h = sensors.headingNow();
      return say(`${p.name}: ${G.describeLongDistance(v.distance)}, ${h != null ? G.turnInstruction(G.normAngle(v.bearing - h)) : 'προς τα ' + G.compassName(v.bearing)}. Για καθοδήγηση πείτε οδήγησέ με στο ${p.name}.`, { priority: 2 });
    }
    case 'WHERE_AM_I': {
      const pos = sensors.freshPosition(120000);
      if (!pos) return say('Δεν έχω σήμα GPS αυτή τη στιγμή.', { priority: 2 });
      const pl = nearestPlace(pos, 150);
      return say(pl ? `Βρίσκεστε κοντά στο ${pl.name}, ${G.describeLongDistance(G.geoVector(pos.lat, pos.lon, pl.lat, pl.lon).distance)}.`
        : `Βρίσκεστε σε μέρος που δεν έχετε αποθηκεύσει. Ακρίβεια GPS ${Math.round(pos.acc)} μέτρα. Μπορείτε να πείτε θυμήσου αυτό το μέρος ως, και ένα όνομα.`, { priority: 2 });
    }
    case 'FORGET': {
      await memory.forget(t.kind, t.id);
      delete settings.classMute[t.id];
      return say(`Ξέχασα ${t.label}.`, { priority: 2 });
    }
    case 'FORGET_ALL': {
      const p = norm(cmd.phrase || '');
      const kinds = /προσωπ|ανθρωπ/.test(p) ? ['person'] : /αντικειμεν/.test(p) ? ['custom'] : /μερ|τοπ/.test(p) ? ['place'] : ['person', 'custom', 'place'];
      const names = { person: 'πρόσωπα', custom: 'αντικείμενα', place: 'μέρη' };
      if (await confirm(`Να διαγράψω όλα τα αποθηκευμένα ${kinds.map(k => names[k]).join(' και ')};`)) {
        for (const k of kinds) await memory.forgetAll(k);
        return say('Διαγράφηκαν.', { priority: 2 });
      }
      return say('Εντάξει, δεν διέγραψα τίποτα.', { priority: 2 });
    }
    case 'MUTE_OBJECT': settings.classMute = { ...settings.classMute, [t.id]: true }; return say(`Εντάξει, δεν θα λέω ${t.label}.`, { priority: 2 });
    case 'UNMUTE_OBJECT': { const m = { ...settings.classMute }; delete m[t.id]; settings.classMute = m; return say(`Εντάξει, θα λέω ξανά ${t.label}.`, { priority: 2 }); }
    case 'VOLUME_OBJECT': {
      const cur = settings.classGain[t.id] ?? 1;
      const next = Math.min(2, Math.max(0.2, cmd.dir === 'up' ? cur * 1.4 : cur / 1.4));
      settings.classGain = { ...settings.classGain, [t.id]: +next.toFixed(2) };
      voice.speak(`${t.label}, ${cmd.dir === 'up' ? 'πιο δυνατά' : 'πιο σιγά'}`, { priority: 2, gain: next });
      return;
    }
    case 'MUTE_ALL': settings.voice = false; syncUI(); return say('Σίγαση ανακοινώσεων. Οι κίνδυνοι και οι απαντήσεις μου θα ακούγονται. Πείτε μίλα για να ξαναρχίσω.', { priority: 2 });
    case 'UNMUTE_ALL': settings.voice = true; syncUI(); return say('Θα ανακοινώνω ξανά τα αντικείμενα.', { priority: 2 });
    case 'VOLUME_UP': settings.volume = Math.min(1, settings.volume + 0.15); syncUI(); return say(`Ένταση ${Math.round(settings.volume * 10)} στα δέκα.`, { priority: 2 });
    case 'VOLUME_DOWN': settings.volume = Math.max(0.1, settings.volume - 0.15); syncUI(); return say(`Ένταση ${Math.round(settings.volume * 10)} στα δέκα.`, { priority: 2 });
    case 'VOLUME_SET': settings.volume = Math.min(1, Math.max(0.1, cmd.value / 10)); syncUI(); return say(`Ένταση ${cmd.value}.`, { priority: 2 });
    case 'RATE_UP': settings.rate = Math.min(1.8, settings.rate + 0.15); syncUI(); return say('Μιλάω πιο γρήγορα.', { priority: 2 });
    case 'RATE_DOWN': settings.rate = Math.max(0.6, settings.rate - 0.15); syncUI(); return say('Μιλάω πιο αργά.', { priority: 2 });
    case 'VERBOSITY':
      settings.verbosity = Math.min(2, Math.max(0, settings.verbosity + (cmd.dir === 'more' ? 1 : -1))); syncUI();
      return say(['Ελάχιστες πληροφορίες.', 'Κανονικές πληροφορίες.', 'Αναλυτικές πληροφορίες.'][settings.verbosity], { priority: 2 });
    case 'MODE': settings.mode = cmd.value; syncUI(); updateChips(); return say(cmd.value === 'walk' ? 'Λειτουργία περπατήματος: θα σας λέω μόνο για εμπόδια, ανθρώπους και οχήματα.' : 'Λειτουργία εξερεύνησης.', { priority: 2 });
    case 'TORCH': {
      st.torchManual = true;
      if (!cam.torchSupported) return say('Ο φακός δεν υποστηρίζεται σε αυτή τη συσκευή ή κάμερα.', { priority: 2 });
      await cam.setTorch(cmd.value); updateChips();
      return say(cmd.value ? 'Φακός αναμμένος.' : 'Φακός σβηστός.', { priority: 2 });
    }
    case 'TORCH_AUTO': settings.autoTorch = cmd.value; st.torchManual = !cmd.value; syncUI(); return say(cmd.value ? 'Αυτόματος φακός ενεργός.' : 'Αυτόματος φακός ανενεργός.', { priority: 2 });
    case 'SCREEN': return setBlackout(!cmd.value);
    case 'BATTERY': { const b = await sensors.battery(); return say(b ? `Μπαταρία ${b.level} τοις εκατό${b.charging ? ', φορτίζει' : ''}.` : 'Δεν μπορώ να διαβάσω τη μπαταρία σε αυτή τη συσκευή.', { priority: 2 }); }
    case 'TIME': return say('Η ώρα είναι ' + new Date().toLocaleTimeString('el-GR', { hour: 'numeric', minute: '2-digit' }) + '.', { priority: 2 });
    case 'UNKNOWN_OBJECT': return say(`Δεν ξέρω τι είναι «${cmd.phrase}». Αν είναι κάτι δικό σας, κρατήστε το μπροστά στην κάμερα και πείτε: μάθε αυτό ως ${cmd.phrase}.`, { priority: 2 });
    default: chime.error(); return say(S.notUnderstood, { priority: 2 });
  }
}

function helpSpeak() { for (const s of S.help.split('. ')) voice.speak(s.trim() + '.', { priority: 2 }); }

async function handleUtterance(alts) {
  if (!alts || !alts.length) { chime.error(); return say('Δεν άκουσα τίποτα.', { priority: 2 }); }
  $('heard').textContent = '🎤 ' + alts[0];
  addLog('🎤', alts[0]);
  const ctx = { candidates: candidates() };
  const parsed = alts.map(a => parseCommand(a, ctx));
  const good = parsed.find(c => !['UNKNOWN', 'UNKNOWN_OBJECT', 'NONE'].includes(c.intent)) || parsed[0];
  try { await execute(good); } catch (e) { console.error(e); say('Παρουσιάστηκε σφάλμα.', { priority: 2 }); }
}

// ---------------- Είσοδος φωνής ----------------
async function talk() {
  if (!st.running) return;
  unlockAudio();
  if (st.listening) return;
  if (!recognitionSupported) return say('Η φωνητική αναγνώριση δεν υποστηρίζεται σε αυτόν τον browser. Χρησιμοποιήστε τα κουμπιά.', { priority: 2 });
  voice.stop();
  st.listening = true; st.busy = true; wakeListener.pause(true);
  $('btnTalk').classList.add('listening'); $('btnTalk').setAttribute('aria-pressed', 'true');
  chime.listening(); if (settings.haptics) vibrate(40);
  setStatus('Σας ακούω…', 'listening');
  try {
    const alts = await listenOnce({ timeoutMs: 8000 });
    st.busy = false; st.listening = false;
    await handleUtterance(alts);
  } catch (e) {
    st.busy = false; st.listening = false;
    chime.error();
    say(e.message === 'not-allowed' ? 'Δεν έχω άδεια μικροφώνου.' : e.message === 'network' ? 'Η φωνητική αναγνώριση χρειάζεται σύνδεση στο διαδίκτυο σε αυτή τη συσκευή. Χρησιμοποιήστε τα κουμπιά.' : 'Δεν σας άκουσα. Δοκιμάστε ξανά.', { priority: 2 });
  } finally {
    st.busy = false; st.listening = false;
    $('btnTalk').classList.remove('listening'); $('btnTalk').setAttribute('aria-pressed', 'false');
    setStatus('Έτοιμο', 'ready');
    if (settings.handsFree) wakeListener.pause(false);
  }
}

// Λέξη-κλειδί (hands-free): «Όραση, βρες τα κλειδιά»
const wakeListener = new WakeListener(async (alts) => {
  if (st.busy || st.listening || voice.speaking) return;
  const stripped = alts.map(a => {
    const words = a.split(/\s+/);
    return norm(words[0]).match(/^(οραση|βοηθε|ματια|ορασι)/) ? words.slice(1).join(' ') : null;
  }).filter(Boolean);
  if (stripped.length) { chime.listening(); await handleUtterance(stripped); }
});
voice.onSpeakingChange = (sp) => { if (settings.handsFree) wakeListener.pause(sp); };

// ---------------- Σχεδίαση ----------------
function draw(tracks) {
  octx.clearRect(0, 0, overlay.width, overlay.height);
  if (!settings.showVideo) return;
  const W = overlay.width, lw = Math.max(2, W / 320);
  octx.font = `bold ${Math.max(14, W / 40)}px Manrope, sans-serif`;
  tracks.forEach((tr) => {
    const { x, y, w, h } = tr.bbox;
    const hue = (tr.id * 47) % 360, color = `hsl(${hue},85%,60%)`;
    const isTarget = search.active && matchesTarget(tr, search.target);
    octx.lineWidth = isTarget ? lw * 2.5 : lw;
    octx.strokeStyle = isTarget ? '#ffe14d' : color;
    octx.strokeRect(x, y, w, h);
    const label = `${labelOf(tr)}${tr.dist != null ? ' · ' + tr.dist.toFixed(1) + 'm' : ''}`;
    const tw = octx.measureText(label).width + 12, th = Math.max(22, W / 34), ty = y > th + 4 ? y - th - 2 : y + h + 2;
    octx.fillStyle = isTarget ? '#ffe14d' : color; octx.fillRect(x, ty, tw, th);
    octx.fillStyle = '#000'; octx.fillText(label, x + 6, ty + th * 0.72);
  });
}

// ---------------- Μαύρη οθόνη (εξοικονόμηση μπαταρίας OLED) ----------------
function setBlackout(on) {
  $('blackout').hidden = !on;
  say(on ? 'Μαύρη οθόνη. Πατήστε μία φορά για να μιλήσετε, δύο φορές για να ανοίξει η οθόνη.' : 'Οθόνη ενεργή.', { priority: 2 });
}

// ---------------- UI: ρυθμίσεις και μνήμη ----------------
function syncUI() {
  $('setVolume').value = settings.volume * 10; $('setRate').value = settings.rate * 10;
  $('setVoice').checked = settings.voice; $('setBeeps').checked = settings.beeps; $('setHaptics').checked = settings.haptics;
  $('setTorch').checked = settings.autoTorch; $('setHands').checked = settings.handsFree; $('setVideo').checked = settings.showVideo;
  $('setFaces').checked = settings.faces; $('setVerbosity').value = settings.verbosity; $('setMode').value = settings.mode;
  $('setDelay').value = settings.voiceDelay; $('setScore').value = Math.round(settings.minScore * 100); $('setModel').value = settings.model;
  $('setFov').value = settings.fovLong;
  $('delayOut').textContent = settings.voiceDelay + ' δ'; $('scoreOut').textContent = Math.round(settings.minScore * 100) + '%';
  $('fovOut').textContent = settings.fovLong + '°'; $('volOut').textContent = Math.round(settings.volume * 10); $('rateOut').textContent = settings.rate.toFixed(1) + '×';
  document.body.classList.toggle('hide-video', !settings.showVideo);
}

function renderMemory() {
  const mk = (arr, kind, icon, extra) => arr.map(x => `<li><span>${icon}</span><span>${escapeHtml(x.name)}${extra ? ' <small>' + extra(x) + '</small>' : ''}</span><button data-forget="${kind}:${x.id}" aria-label="Διαγραφή ${escapeHtml(x.name)}">🗑</button></li>`).join('');
  $('memList').innerHTML =
    mk(memory.items, 'custom', '📦', x => `${x.embeddings.length} δείγματα`) +
    mk(memory.people, 'person', '🧑', x => `${x.descriptors.length} δείγματα`) +
    mk(memory.places, 'place', '📍') || '<li class="muted">Δεν υπάρχουν αποθηκευμένα στοιχεία ακόμα.</li>';
  const muted = Object.keys(settings.classMute).filter(k => settings.classMute[k]).map(k => {
    const c = candidates().find(c => c.id === k); return c ? c.label : k;
  });
  $('mutedList').textContent = muted.length ? muted.join(', ') : '—';
}
const escapeHtml = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

async function warmOfflineCache() {
  const urls = ['models/efficientdet_lite2.tflite', 'face-api/face-api.js', 'face-api/model/tiny_face_detector_model-weights_manifest.json', 'face-api/model/tiny_face_detector_model.bin',
    'face-api/model/face_landmark_68_tiny_model-weights_manifest.json', 'face-api/model/face_landmark_68_tiny_model.bin',
    'face-api/model/face_recognition_model-weights_manifest.json', 'face-api/model/face_recognition_model.bin',
    'tesseract/tesseract.min.js', 'tesseract/worker.min.js', 'tesseract/tesseract-core-relaxedsimd-lstm.wasm.js', 'tesseract/tesseract-core-simd-lstm.wasm.js', 'tesseract/tesseract-core-lstm.wasm.js',
    'tesseract/ell.traineddata.gz', 'tesseract/eng.traineddata.gz'].map(u => new URL('../vendor/' + u, import.meta.url).href);
  const out = $('offlineOut'); let done = 0;
  for (const u of urls) { try { await fetch(u); } catch { /* συνέχισε */ } out.textContent = `Προφόρτωση ${++done}/${urls.length}…`; }
  out.textContent = 'Έτοιμο — όλα τα μοντέλα είναι αποθηκευμένα για χρήση χωρίς internet.';
  say('Όλα τα μοντέλα αποθηκεύτηκαν για χρήση χωρίς internet.', { priority: 2 });
}

function bindUI() {
  $('btnStart').onclick = start;
  $('btnTalk').onclick = talk;
  $('qDescribe').onclick = () => execute({ intent: 'DESCRIBE' });
  $('qScan').onclick = () => execute({ intent: 'SCAN' });
  $('qRead').onclick = () => execute({ intent: 'READ_TEXT' });
  $('qTorch').onclick = () => execute({ intent: 'TORCH', value: !cam.torchOn });
  $('qStop').onclick = () => execute({ intent: 'STOP' });
  $('qPause').onclick = () => execute({ intent: st.paused ? 'RESUME' : 'PAUSE' });
  $('qBlack').onclick = () => setBlackout(true);
  $('qHelp').onclick = () => execute({ intent: 'HELP' });
  $('btnSettings').onclick = () => { renderMemory(); $('panel').showModal(); };
  $('btnClosePanel').onclick = () => $('panel').close();
  $('btnTypeFind').onclick = () => {
    const q = $('typeFind').value.trim(); if (!q) return;
    handleUtterance([/^(βρες|ψαξε|ψάξε)/i.test(q) ? q : 'βρες ' + q]); $('panel').close();
  };
  $('btnLearnObj').onclick = () => { const n = $('learnName').value.trim(); $('panel').close(); learnObject(n); };
  $('btnLearnPerson').onclick = () => { const n = $('learnName').value.trim(); $('panel').close(); learnPerson(n); };
  $('btnSavePlace').onclick = () => { const n = $('learnName').value.trim(); $('panel').close(); savePlace(n); };
  $('btnResetSettings').onclick = () => { resetSettings(); syncUI(); say('Οι ρυθμίσεις επανήλθαν.', { priority: 2 }); };
  $('btnWarm').onclick = warmOfflineCache;
  $('memList').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-forget]'); if (!b) return;
    const [kind, id] = b.dataset.forget.split(':'); await memory.forget(kind, id); renderMemory();
  });
  $('btnUnmuteAll').onclick = () => { settings.classMute = {}; settings.classGain = {}; renderMemory(); };

  const bind = (id, key, conv = v => v, ev = 'input') => $(id).addEventListener(ev, e => {
    settings[key] = conv(e.target.type === 'checkbox' ? e.target.checked : e.target.value); syncUI();
  });
  bind('setVolume', 'volume', v => v / 10); bind('setRate', 'rate', v => v / 10);
  bind('setVoice', 'voice'); bind('setBeeps', 'beeps'); bind('setHaptics', 'haptics'); bind('setTorch', 'autoTorch'); bind('setVideo', 'showVideo');
  bind('setFaces', 'faces'); bind('setVerbosity', 'verbosity', Number, 'change'); bind('setMode', 'mode', v => v, 'change');
  bind('setDelay', 'voiceDelay', Number); bind('setScore', 'minScore', v => v / 100); bind('setFov', 'fovLong', Number);
  $('setHands').addEventListener('change', e => {
    settings.handsFree = e.target.checked;
    if (settings.handsFree) { wakeListener.start(); say('Συνεχής ακρόαση. Ξεκινήστε την εντολή με τη λέξη όραση.', { priority: 2 }); } else wakeListener.stop();
  });
  $('setModel').addEventListener('change', async e => {
    settings.model = e.target.value; setStatus('Αλλαγή μοντέλου…', 'loading');
    try { await detector.load(settings.model, settings.minScore); setStatus('Έτοιμο', 'ready'); say(settings.model === 'lite2' ? 'Ακριβές μοντέλο.' : 'Γρήγορο μοντέλο.', { priority: 2 }); }
    catch (err) { setStatus('Σφάλμα μοντέλου', 'error'); }
  });
  onSettingChange((k) => { if (k === 'minScore') detector.setMinScore(settings.minScore); });
  $('setCamera').addEventListener('change', async e => {
    settings.deviceId = e.target.value;
    await cam.start({ facing: settings.facing, deviceId: settings.deviceId }).catch(() => say(S.noCamera, { priority: 2 }));
  });
  $('setFacing').addEventListener('change', async e => {
    settings.facing = e.target.value; settings.deviceId = '';
    await cam.start({ facing: settings.facing }).catch(() => say(S.noCamera, { priority: 2 }));
  });

  // Μαύρη οθόνη: ένα πάτημα = ομιλία, δύο = ξύπνημα
  let lastTap = 0;
  $('blackout').addEventListener('click', () => {
    const t = Date.now();
    if (t - lastTap < 400) { $('blackout').hidden = true; say('Οθόνη ενεργή.', { priority: 2 }); }
    else setTimeout(() => { if (Date.now() - lastTap >= 380 && !$('blackout').hidden) talk(); }, 400);
    lastTap = t;
  });
  $('stage').addEventListener('dblclick', () => execute({ intent: st.paused ? 'RESUME' : 'PAUSE' }));
  // Συντομεύσεις πληκτρολογίου (βοηθός / πληκτρολόγιο Bluetooth)
  window.addEventListener('keydown', (e) => {
    if (e.target.matches('input, select, textarea')) return;
    if (e.code === 'Space') { e.preventDefault(); talk(); } else if (e.key === 'Escape') execute({ intent: 'STOP' });
  });
  Camera.listDevices().then(list => {
    $('setCamera').innerHTML = '<option value="">Αυτόματη</option>' + list.map(d => `<option value="${d.id}">${escapeHtml(d.label)}</option>`).join('');
  });
  navigator.mediaDevices?.addEventListener?.('devicechange', () => Camera.listDevices().then(list => {
    $('setCamera').innerHTML = '<option value="">Αυτόματη</option>' + list.map(d => `<option value="${d.id}">${escapeHtml(d.label)}</option>`).join('');
  }));
  syncUI();
}

function registerSW() {
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('./sw.js').catch(e => console.warn('SW', e));
}

// Για αυτοματοποιημένες δοκιμές
window.__sv = { st, search, scan, nav, memory, detector, embedder, sensors, voice, parseCommand, execute, handleUtterance, learnObject, startSearch, startScan, describeScene };

bindUI();
if (!recognitionSupported) $('introWarn').textContent = 'Ο browser δεν υποστηρίζει φωνητικές εντολές — θα χρησιμοποιήσετε τα κουμπιά. Προτείνεται Chrome σε Android.';
