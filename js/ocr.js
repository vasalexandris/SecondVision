// Ανάγνωση κειμένου (Tesseract.js, ελληνικά + αγγλικά, τοπικά). Φορτώνεται μόνο όταν ζητηθεί «διάβασε».
const BASE = new URL('../vendor/tesseract/', import.meta.url).href;
let workerPromise = null;

function loadScript(src) {
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src; s.onload = res; s.onerror = () => rej(new Error('script ' + src));
    document.head.appendChild(s);
  });
}

async function getWorker() {
  if (workerPromise) return workerPromise;
  workerPromise = (async () => {
    if (!window.Tesseract) await loadScript(BASE + 'tesseract.min.js');
    return window.Tesseract.createWorker('ell+eng', 1, {
      workerPath: BASE + 'worker.min.js',
      corePath: BASE,
      langPath: BASE,
      gzip: true,
      workerBlobURL: false
    });
  })();
  workerPromise.catch(() => { workerPromise = null; });
  return workerPromise;
}

/** Προεπεξεργασία: κλιμάκωση + γκρι + αυξημένη αντίθεση. */
function prepare(video) {
  const w = video.videoWidth, h = video.videoHeight;
  const scale = Math.min(2, 1600 / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.round(w * scale); c.height = Math.round(h * scale);
  const ctx = c.getContext('2d');
  ctx.filter = 'grayscale(1) contrast(1.4)';
  ctx.drawImage(video, 0, 0, c.width, c.height);
  return c;
}

export async function readText(video) {
  const worker = await getWorker();
  const { data } = await worker.recognize(prepare(video));
  // Τα v6+ επιστρέφουν απλό κείμενο· κρατάμε γραμμές με αρκετά γράμματα
  const lines = String(data.text || '').split('\n').map(l => l.trim()).filter(l => /[\p{L}\p{N}]{2,}/u.test(l));
  const text = lines.join('. ').replace(/\s+/g, ' ').trim();
  return { text, confidence: data.confidence };
}
