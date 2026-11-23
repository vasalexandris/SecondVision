// Ηχητικά σήματα (WebAudio): μπιπ καθοδήγησης με στερεοφωνική θέση, ειδοποιήσεις κινδύνου, επιβεβαιώσεις.
let ctx = null;

export function unlockAudio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

export function beep({ freq = 600, dur = 0.08, pan = 0, gain = 0.25, type = 'sine', when = 0 } = {}) {
  if (!ctx) return;
  const t0 = ctx.currentTime + when;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type; osc.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  let node = g;
  if (ctx.createStereoPanner) {
    const p = ctx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan));
    g.connect(p); node = p;
  }
  osc.connect(g); node.connect(ctx.destination);
  osc.start(t0); osc.stop(t0 + dur + 0.02);
}

export const chime = {
  ready: () => { beep({ freq: 523, dur: 0.1 }); beep({ freq: 784, dur: 0.14, when: 0.12 }); },
  listening: () => beep({ freq: 880, dur: 0.07, gain: 0.3 }),
  done: () => { beep({ freq: 660, dur: 0.07 }); beep({ freq: 440, dur: 0.1, when: 0.09 }); },
  found: () => { [523, 659, 784, 1046].forEach((f, i) => beep({ freq: f, dur: 0.12, when: i * 0.1, gain: 0.3 })); },
  error: () => { beep({ freq: 200, dur: 0.2, type: 'square', gain: 0.18 }); },
  danger: () => { for (let i = 0; i < 3; i++) beep({ freq: 980, dur: 0.1, when: i * 0.14, type: 'square', gain: 0.35 }); },
  learn: () => beep({ freq: 1200, dur: 0.04, gain: 0.2 })
};

/** Συνεχές «ραντάρ»: καλεί getTone() και παίζει μπιπ με ρυθμό/τόνο/πλαινή θέση ανάλογα με την κατεύθυνση. */
export class GuideBeeper {
  #timer = null;
  #getTone = null;
  start(getTone) {
    this.stop(); this.#getTone = getTone;
    const tick = () => {
      const tone = this.#getTone && this.#getTone();
      if (tone) beep({ freq: tone.freq, pan: tone.pan, dur: 0.07, gain: 0.22 });
      this.#timer = setTimeout(tick, tone ? 1000 / Math.max(0.8, tone.rate) : 400);
    };
    tick();
  }
  stop() { clearTimeout(this.#timer); this.#timer = null; this.#getTone = null; }
  get active() { return this.#timer !== null; }
}

export function vibrate(pattern) {
  try { if (navigator.vibrate) navigator.vibrate(pattern); } catch { /* αγνόησε */ }
}
