// Όραση: ανίχνευση αντικειμένων (MediaPipe EfficientDet) και «μάθηση νέων αντικειμένων» με embeddings (MobileNetV3).
// Όλα τρέχουν τοπικά (WebAssembly/WebGL) από το vendor/ — δεν χρειάζεται internet.
import { FilesetResolver, ObjectDetector, ImageEmbedder } from '../vendor/mediapipe/vision_bundle.mjs';

const WASM = new URL('../vendor/mediapipe/wasm', import.meta.url).href;
const MODELS = {
  lite0: new URL('../vendor/models/efficientdet_lite0.tflite', import.meta.url).href,
  lite2: new URL('../vendor/models/efficientdet_lite2.tflite', import.meta.url).href
};
const EMBED_MODEL = new URL('../vendor/models/mobilenet_v3_small.tflite', import.meta.url).href;

let filesetPromise = null;
const fileset = () => (filesetPromise ||= FilesetResolver.forVisionTasks(WASM));

async function createWithFallback(factory) {
  try { return await factory('GPU'); } catch (e) { console.warn('GPU delegate απέτυχε, χρήση CPU', e); return factory('CPU'); }
}

export class Detector {
  #det = null; model = null; delegate = null;
  async load(model = 'lite0', minScore = 0.4) {
    if (this.#det && this.model === model) return;
    this.#det?.close?.(); this.#det = null;
    const fs = await fileset();
    this.#det = await createWithFallback(async (delegate) => {
      const d = await ObjectDetector.createFromOptions(fs, {
        baseOptions: { modelAssetPath: MODELS[model] || MODELS.lite0, delegate },
        runningMode: 'VIDEO', scoreThreshold: minScore, maxResults: 25
      });
      this.delegate = delegate; return d;
    });
    this.model = model;
  }
  /** Επιστρέφει [{cls, score, bbox:{x,y,w,h}}] σε pixel του καρέ. */
  detect(video, ts) {
    if (!this.#det) return [];
    const res = this.#det.detectForVideo(video, ts);
    const out = [];
    for (const d of res.detections) {
      const c = d.categories[0]; const b = d.boundingBox;
      if (!c || !b || !c.categoryName || c.categoryName === '???' ) continue;
      out.push({ cls: c.categoryName, score: c.score, bbox: { x: b.originX, y: b.originY, w: b.width, h: b.height } });
    }
    return out;
  }
  setMinScore(v) { this.#det?.setOptions({ scoreThreshold: v }); }
}

export class Embedder {
  #emb = null; #canvas = document.createElement('canvas'); #ctx = this.#canvas.getContext('2d', { willReadFrequently: false });
  #lastFrame = 0;
  tiles = [];
  #tileIdx = 0;
  frameW = 0; frameH = 0;

  async load() {
    if (this.#emb) return;
    const fs = await fileset();
    this.#emb = await createWithFallback(async (delegate) => ImageEmbedder.createFromOptions(fs, {
      baseOptions: { modelAssetPath: EMBED_MODEL, delegate }, runningMode: 'IMAGE', l2Normalize: true, quantize: false
    }));
  }
  get ready() { return !!this.#emb; }

  /** Αντιγράφει το τρέχον καρέ σε μικρότερο canvas (γρήγορο για πολλά crops). */
  snapshot(video, maxW = 480) {
    const w = video.videoWidth, h = video.videoHeight;
    if (!w || !h) return false;
    const s = Math.min(1, maxW / w);
    this.#canvas.width = Math.round(w * s); this.#canvas.height = Math.round(h * s);
    this.#ctx.drawImage(video, 0, 0, this.#canvas.width, this.#canvas.height);
    this.frameW = w; this.frameH = h;
    this.#lastFrame = performance.now();
    this.#buildTiles();
    return true;
  }

  /** Πολυκλιμακωτά πλακίδια: 1 ολόκληρο, 2x2, 3x3 και κεντρικό — καλύπτουν διαφορετικά μεγέθη αντικειμένου. */
  #buildTiles() {
    if (this.tiles.length) return;
    const t = [];
    const add = (l, tp, r, b) => t.push({ left: l, top: tp, right: r, bottom: b });
    add(0.2, 0.2, 0.8, 0.8); // κέντρο
    for (const [n, size] of [[2, 0.55], [3, 0.4], [4, 0.3]]) {
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
        const cx = n === 1 ? 0.5 : size / 2 + (1 - size) * (i / (n - 1));
        const cy = n === 1 ? 0.5 : size / 2 + (1 - size) * (j / (n - 1));
        add(cx - size / 2, cy - size / 2, cx + size / 2, cy + size / 2);
      }
    }
    this.tiles = t;
  }

  embed(roi) {
    const res = this.#emb.embed(this.#canvas, { regionOfInterest: roi });
    return res.embeddings[0].floatEmbedding;
  }

  /** Embeddings από ένα έτοιμο canvas (π.χ. αποκομμένο αντικείμενο) — για εκμάθηση από «τι είναι αυτό». */
  embedImage(canvas) {
    if (!this.#emb) return [];
    const out = [];
    for (const s of [1, 0.8, 0.6]) {
      const h = s / 2;
      out.push(Float32Array.from(this.#emb.embed(canvas, { regionOfInterest: { left: 0.5 - h, top: 0.5 - h, right: 0.5 + h, bottom: 0.5 + h } }).embeddings[0].floatEmbedding));
    }
    return out;
  }

  /** Embedding του κέντρου της εικόνας σε διάφορες κλίμακες — για εκμάθηση. */
  embedCenterSamples() {
    const out = [];
    for (const s of [0.35, 0.5, 0.65]) {
      const h = s / 2;
      out.push(this.embed({ left: 0.5 - h, top: 0.5 - h, right: 0.5 + h, bottom: 0.5 + h }));
    }
    return out;
  }

  /** Επεξεργάζεται `count` πλακίδια ανά κλήση. Επιστρέφει [{id, sim, box}] για αντικείμενα που ταιριάζουν. */
  scan(items, count = 4, threshold = 0.8) {
    if (!this.#emb || !items.length || !this.tiles.length) return [];
    const hits = [];
    for (let k = 0; k < count; k++) {
      const tile = this.tiles[this.#tileIdx++ % this.tiles.length];
      const e = this.embed(tile);
      for (const item of items) {
        let best = 0;
        for (const ref of item.embeddings) best = Math.max(best, dot(e, ref));
        if (best >= threshold) {
          hits.push({ id: item.id, sim: best, bbox: {
            x: tile.left * this.frameW, y: tile.top * this.frameH,
            w: (tile.right - tile.left) * this.frameW, h: (tile.bottom - tile.top) * this.frameH } });
        }
      }
    }
    return hits;
  }
}

export const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };

/** Μέση φωτεινότητα 0..1 του καρέ (για αυτόματο φλας). */
const lumaCanvas = document.createElement('canvas');
lumaCanvas.width = 32; lumaCanvas.height = 24;
const lumaCtx = lumaCanvas.getContext('2d', { willReadFrequently: true });
export function frameLuma(video) {
  if (!video.videoWidth) return null;
  lumaCtx.drawImage(video, 0, 0, 32, 24);
  const d = lumaCtx.getImageData(0, 0, 32, 24).data;
  let s = 0;
  for (let i = 0; i < d.length; i += 4) s += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
  return s / (d.length / 4) / 255;
}
