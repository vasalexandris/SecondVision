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
  const w = video.videoWidth || video.width, h = video.videoHeight || video.height;
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
  // Κρατάμε μόνο γραμμές που μοιάζουν με πραγματικό κείμενο (αρκετά γράμματα, λέξεις ≥2 χαρακτήρων) — αποφεύγει «γράμμα γράμμα» θόρυβο
  const lines = String(data.text || '').split('\n').map(l => l.trim()).filter(l => {
    const letters = (l.match(/[\p{L}\p{N}]/gu) || []).length;
    const words = l.split(/\s+/).filter(w => (w.match(/[\p{L}\p{N}]/gu) || []).length >= 2);
    return letters >= 3 && letters / l.replace(/\s/g, '').length >= 0.6 && words.length >= 1 && words.length >= l.split(/\s+/).length / 2;
  });
  const text = (data.confidence < 55 ? '' : lines.join('. ')).replace(/\s+/g, ' ').trim();
  return { text, confidence: data.confidence };
}
