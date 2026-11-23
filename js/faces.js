// Αναγνώριση προσώπων (face-api.js, τοπικά). Φορτώνεται μόνο όταν χρειαστεί.
const BASE = new URL('../vendor/face-api/', import.meta.url).href;
let loading = null;

function loadScript(src) {
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src; s.onload = res; s.onerror = () => rej(new Error('script ' + src));
    document.head.appendChild(s);
  });
}

export async function loadFaces() {
  if (loading) return loading;
  loading = (async () => {
    if (!window.faceapi) await loadScript(BASE + 'face-api.js');
    const f = window.faceapi;
    await f.nets.tinyFaceDetector.loadFromUri(BASE + 'model');
    await f.nets.faceLandmark68TinyNet.loadFromUri(BASE + 'model');
    await f.nets.faceRecognitionNet.loadFromUri(BASE + 'model');
    return f;
  })();
  loading.catch(() => { loading = null; });
  return loading;
}

export const facesLoaded = () => !!(window.faceapi && window.faceapi.nets.faceRecognitionNet.isLoaded);

/** Βρίσκει πρόσωπα στο input (video/canvas). Επιστρέφει [{box:{x,y,w,h}, descriptor:Float32Array}]. */
export async function detectFaces(input) {
  const f = await loadFaces();
  const res = await f.detectAllFaces(input, new f.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 }))
    .withFaceLandmarks(true).withFaceDescriptors();
  return res.map(r => ({
    box: { x: r.detection.box.x, y: r.detection.box.y, w: r.detection.box.width, h: r.detection.box.height },
    descriptor: r.descriptor
  }));
}

export function faceDistance(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) { const d = a[i] - b[i]; s += d * d; }
  return Math.sqrt(s);
}

/** Ταίριασμα με αποθηκευμένα πρόσωπα. Όριο 0.5 = αυστηρό ώστε να αποφεύγονται λάθος ονόματα. */
export function matchPerson(descriptor, people, threshold = 0.5) {
  let best = null;
  for (const p of people) {
    for (const d of p.descriptors) {
      const dist = faceDistance(descriptor, d);
      if (!best || dist < best.dist) best = { person: p, dist };
    }
  }
  return best && best.dist <= threshold ? best : null;
}
