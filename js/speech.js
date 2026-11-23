// Φωνή: σύνθεση ομιλίας με προτεραιότητες + αναγνώριση φωνητικών εντολών (el-GR).
import { settings } from './settings.js';

// ---------------- Σύνθεση ομιλίας ----------------
// Προτεραιότητες: 0 περιβάλλον (μπορεί να χαθεί), 1 καθοδήγηση, 2 απάντηση σε εντολή, 3 κίνδυνος (διακόπτει όλα)
export class Voice {
  queue = [];
  current = null;
  last = '';
  onSpeakingChange = () => {};
  #voice = null;
  #voiceTried = 0;

  constructor() {
    if ('speechSynthesis' in window) {
      speechSynthesis.getVoices();
      speechSynthesis.onvoiceschanged = () => { this.#voice = null; };
    }
  }

  get supported() { return 'speechSynthesis' in window; }
  get speaking() { return !!this.current; }

  #pickVoice() {
    if (this.#voice) return this.#voice;
    const voices = speechSynthesis.getVoices().filter(v => v.lang && v.lang.toLowerCase().startsWith('el'));
    // προτιμάμε τοπική φωνή (δουλεύει χωρίς internet)
    this.#voice = voices.find(v => v.localService) || voices[0] || null;
    return this.#voice;
  }

  /** gain: πολλαπλασιαστής έντασης ανά αντικείμενο. key: για αποφυγή διπλών μηνυμάτων στην ουρά. */
  speak(text, { priority = 2, gain = 1, key = null, rate = 1 } = {}) {
    if (!this.supported || !text) return;
    if (priority >= 3) { this.queue = []; this.#cancelCurrent(); }
    else if (priority === 2) this.queue = this.queue.filter(q => q.priority >= 2);
    if (key) this.queue = this.queue.filter(q => q.key !== key);
    if (priority === 0 && this.queue.length >= 2) return; // μη συσσωρεύεις ανακοινώσεις περιβάλλοντος
    this.queue.push({ text, priority, gain, key, rate, t: Date.now() });
    this.queue.sort((a, b) => b.priority - a.priority);
    this.#next();
  }

  #cancelCurrent() {
    if (this.current) { this.current = null; try { speechSynthesis.cancel(); } catch { /* αγνόησε */ } }
  }

  stop() { this.queue = []; this.#cancelCurrent(); this.onSpeakingChange(false); }

  #next() {
    if (this.current || !this.queue.length) return;
    const item = this.queue.shift();
    if (item.priority === 0 && Date.now() - item.t > 4000) return this.#next(); // πεπαλαιωμένο
    const u = new SpeechSynthesisUtterance(item.text);
    u.lang = 'el-GR';
    u.rate = Math.min(2, Math.max(0.5, settings.rate * item.rate));
    u.volume = Math.min(1, Math.max(0, settings.volume * item.gain));
    const v = this.#pickVoice();
    if (v) u.voice = v;
    const done = () => {
      if (this.current !== u) return;
      this.current = null;
      if (!this.queue.length) this.onSpeakingChange(false);
      this.#next();
    };
    u.onend = done; u.onerror = done;
    this.current = u;
    this.last = item.text;
    this.onSpeakingChange(true);
    try { speechSynthesis.speak(u); } catch { done(); }
    // Ασφάλεια: κάποια κινητά δεν στέλνουν ποτέ onend
    setTimeout(() => { if (this.current === u && !speechSynthesis.speaking) done(); }, 1500 + item.text.length * 120);
  }
}

// ---------------- Αναγνώριση ομιλίας ----------------
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
export const recognitionSupported = !!SR;

/** Μία ακρόαση: επιστρέφει λίστα εναλλακτικών κειμένων (η πρώτη είναι η πιο πιθανή). */
export function listenOnce({ timeoutMs = 9000 } = {}) {
  return new Promise((resolve, reject) => {
    if (!SR) return reject(new Error('unsupported'));
    const rec = new SR();
    rec.lang = 'el-GR';
    rec.interimResults = false;
    rec.maxAlternatives = 4;
    rec.continuous = false;
    let got = null, finished = false;
    const finish = (val, err) => {
      if (finished) return; finished = true;
      clearTimeout(tm);
      try { rec.abort(); } catch { /* αγνόησε */ }
      err ? reject(err) : resolve(val);
    };
    const tm = setTimeout(() => finish(got || [], null), timeoutMs);
    rec.onresult = (e) => {
      const r = e.results[e.results.length - 1];
      got = Array.from(r).map(a => a.transcript.trim());
      finish(got);
    };
    rec.onerror = (e) => finish(null, new Error(e.error || 'error'));
    rec.onend = () => finish(got || []);
    try { rec.start(); } catch (e) { finish(null, e); }
  });
}

/** Συνεχής ακρόαση με λέξη-κλειδί (handsFree). Σταματά όσο μιλάει η συσκευή για να μην ακούει τον εαυτό της. */
export class WakeListener {
  #rec = null; #on = false; #paused = false;
  constructor(onUtterance, wakeWords = ['οραση', 'βοηθε', 'ματια']) {
    this.onUtterance = onUtterance; this.wakeWords = wakeWords;
  }
  get supported() { return !!SR; }
  start() { if (!SR || this.#on) return; this.#on = true; this.#spawn(); }
  stop() { this.#on = false; try { this.#rec?.abort(); } catch { /* αγνόησε */ } this.#rec = null; }
  pause(p) { this.#paused = p; if (p) { try { this.#rec?.abort(); } catch { /* αγνόησε */ } } else if (this.#on) this.#spawn(); }
  #spawn() {
    if (!this.#on || this.#paused) return;
    try { this.#rec?.abort(); } catch { /* αγνόησε */ }
    const rec = new SR();
    rec.lang = 'el-GR'; rec.continuous = true; rec.interimResults = false; rec.maxAlternatives = 3;
    rec.onresult = (e) => {
      const r = e.results[e.results.length - 1];
      this.onUtterance(Array.from(r).map(a => a.transcript.trim()));
    };
    rec.onend = () => { if (this.#on && !this.#paused) setTimeout(() => this.#spawn(), 300); };
    rec.onerror = (e) => { if (e.error === 'not-allowed' || e.error === 'service-not-allowed') this.#on = false; };
    this.#rec = rec;
    try { rec.start(); } catch { /* ήδη ενεργό */ }
  }
}
