// «Τι είναι αυτό;» — αναγνώριση προϊόντος/αντικειμένου με βοήθεια από το διαδίκτυο (μόνο όταν υπάρχει σύνδεση).
// Ιδιωτικότητα: η Wikipedia λαμβάνει ΜΟΝΟ λέξεις (είδος + κείμενο ετικέτας). Εικόνα στέλνεται ΜΟΝΟ αν ο χρήστης
// έχει βάλει ρητά δικό του κλειδί Claude API στις ρυθμίσεις.

const timeout = (ms) => { const c = new AbortController(); setTimeout(() => c.abort(), ms); return c.signal; };

/** Αναζήτηση στη Wikipedia (el, μετά en). Επιστρέφει {title, extract, lang} ή null. */
export async function wikiLookup(query, langs = ['el', 'en']) {
  const q = String(query || '').trim().slice(0, 120);
  if (!q) return null;
  for (const lang of langs) {
    try {
      const s = await fetch(`https://${lang}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(q)}&format=json&origin=*&srlimit=1`, { signal: timeout(6000) });
      const title = (await s.json())?.query?.search?.[0]?.title;
      if (!title) continue;
      const r = await fetch(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`, { signal: timeout(6000) });
      const j = await r.json();
      if (j?.extract) return { title: j.title || title, extract: firstSentences(j.extract, 2), lang };
    } catch { /* δοκίμασε την επόμενη γλώσσα */ }
  }
  return null;
}

export function firstSentences(text, n = 2) {
  const parts = String(text).replace(/\([^)]*\)/g, '').replace(/\s+/g, ' ').match(/[^.!;·]+[.!;·]?/g) || [text];
  return parts.slice(0, n).join(' ').trim().slice(0, 320);
}

/** Αποκοπή περιοχής του καρέ ως JPEG (base64 χωρίς prefix) και ως canvas. */
export function cropFrame(video, bbox, pad = 0.15, maxSide = 768) {
  const W = video.videoWidth, H = video.videoHeight;
  let x = 0, y = 0, w = W, h = H;
  if (bbox) {
    const px = bbox.w * pad, py = bbox.h * pad;
    x = Math.max(0, bbox.x - px); y = Math.max(0, bbox.y - py);
    w = Math.min(W - x, bbox.w + 2 * px); h = Math.min(H - y, bbox.h + 2 * py);
  }
  const s = Math.min(1, maxSide / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.round(w * s); c.height = Math.round(h * s);
  c.getContext('2d').drawImage(video, x, y, w, h, 0, 0, c.width, c.height);
  c.videoWidth = c.width; c.videoHeight = c.height; // ώστε να δουλεύει σαν «video» στο OCR
  return { canvas: c, base64: c.toDataURL('image/jpeg', 0.85).split(',')[1] };
}

/** Περιγραφή από Claude (προαιρετικό, με κλειδί του χρήστη). */
export async function askVision(apiKey, base64, hints = {}) {
  const prompt = hints._prompt || 'Βοηθάς έναν τυφλό χρήστη. Στην εικόνα, το αντικείμενο που κρατά ή δείχνει είναι συνήθως στο κέντρο. ' +
    'Πες σε 2 σύντομες προτάσεις στα ελληνικά τι είναι, με μάρκα/όνομα προϊόντος αν διαβάζεται, και ό,τι είναι χρήσιμο ' +
    '(π.χ. γεύση, περιεχόμενο, ημερομηνία λήξης, οδηγίες). Αν δεν είσαι σίγουρος, πες το καθαρά. Χωρίς εισαγωγές.' +
    (hints.label ? ` Ο τοπικός ανιχνευτής πιστεύει ότι είναι: ${hints.label}.` : '') +
    (hints.text ? ` Κείμενο που διαβάστηκε στην ετικέτα: «${hints.text}».` : '');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST', signal: timeout(20000),
    headers: {
      'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({
      model: 'claude-haiku-5-5', max_tokens: 300,
      messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: base64 } },
        { type: 'text', text: prompt }
      ] }]
    })
  });
  if (!res.ok) throw new Error('vision ' + res.status);
  const j = await res.json();
  return (j.content || []).filter(b => b.type === 'text').map(b => b.text).join(' ').trim();
}

// ---------------- Gemini (Google AI Studio) ----------------
const GEMINI = 'https://generativelanguage.googleapis.com/v1beta';
let geminiModelCache = null;

/** Σειρά προτίμησης: πρώτα σταθερά «flash» (γρήγορα, φθηνά, με δωρεάν όριο), μετά «flash-lite», τελευταία «pro»/preview (συχνά χωρίς δωρεάν όριο). */
export function rankModels(names) {
  const ver = n => parseFloat((n.match(/gemini-(\d+(?:\.\d+)?)/) || [0, 0])[1]);
  const tier = n => (/pro/.test(n) ? 4 : 0) + (/preview|exp|thinking/.test(n) ? 2 : 0) + (/flash/.test(n) ? 0 : 1) + (/lite|8b/.test(n) ? 0.5 : 0);
  return [...names].sort((a, b) => tier(a) - tier(b) || ver(b) - ver(a));
}

/** Λίστα μοντέλων που υποστηρίζουν generateContent, ταξινομημένη κατά προτίμηση. */
export async function listGeminiModels(key) {
  const res = await fetch(`${GEMINI}/models?pageSize=200`, { headers: { 'x-goog-api-key': key }, signal: timeout(10000) });
  if (!res.ok) { const e = new Error('models ' + res.status); e.status = res.status; throw e; }
  const j = await res.json();
  return rankModels((j.models || [])
    .filter(m => /gemini/i.test(m.name) && (m.supportedGenerationMethods || []).includes('generateContent') &&
      !/embedding|tts|image-generation|live|audio|robotics|computer-use|thinking-exp|vision-latest/i.test(m.name))
    .map(m => m.name.replace(/^models\//, '')));
}

async function geminiCall(key, model, parts, generationConfig) {
  const res = await fetch(`${GEMINI}/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST', signal: timeout(25000),
    headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: { temperature: 0.2, maxOutputTokens: 600, ...generationConfig } })
  });
  if (!res.ok) {
    let detail = ''; try { detail = (await res.json())?.error?.message || ''; } catch { /* αγνόησε */ }
    const e = new Error(`gemini ${res.status} ${detail}`.trim()); e.status = res.status; e.model = model; throw e;
  }
  const j = await res.json();
  return (j.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join(' ').trim();
}

// Σφάλματα που αφορούν ΜΟΝΟ το συγκεκριμένο μοντέλο (δεν υπάρχει / δεν έχει όριο / υπερφορτωμένο) → δοκιμάζουμε το επόμενο
const MODEL_ERRORS = [400, 404, 429, 500, 503];

/** Δοκιμάζει το επιλεγμένο μοντέλο· αν αποτύχει για λόγους μοντέλου, δοκιμάζει αυτόματα τα επόμενα της λίστας. */
export async function geminiGenerate(key, preferred, parts, generationConfig) {
  const tried = [];
  let lastErr;
  const attempt = async (m) => { tried.push(m); const t = await geminiCall(key, m, parts, generationConfig); geminiModelCache = m; return t; };
  const first = preferred || geminiModelCache;
  if (first) {
    try { return await attempt(first); } catch (e) { if (!MODEL_ERRORS.includes(e.status)) throw e; lastErr = e; }
  }
  const models = await listGeminiModels(key);
  for (const m of models.filter(m => !tried.includes(m)).slice(0, 4)) {
    try { return await attempt(m); } catch (e) { if (!MODEL_ERRORS.includes(e.status)) throw e; lastErr = e; }
  }
  throw lastErr || new Error('no gemini model');
}
export const lastGeminiModel = () => geminiModelCache;

/** Δοκιμή κλειδιού+μοντέλου με μικρό αίτημα. Επιστρέφει {ok, status, message}. */
export async function testGemini(key, model) {
  try {
    const t = await geminiCall(key, model, [{ text: 'Απάντησε μόνο με τη λέξη OK.' }], { maxOutputTokens: 20 });
    return { ok: true, status: 200, message: t.slice(0, 40) };
  } catch (e) { return { ok: false, status: e.status || 0, message: e.message }; }
}

const PROMPTS = {
  identify: (h) => 'Βοηθάς έναν τυφλό χρήστη. Το αντικείμενο που κρατά ή δείχνει είναι συνήθως στο κέντρο της εικόνας. ' +
    'Απάντησε ΜΟΝΟ με JSON της μορφής {"name":"σύντομο όνομα αντικειμένου στα ελληνικά, 1-3 λέξεις","description":"2 σύντομες προτάσεις στα ελληνικά: τι είναι, μάρκα/όνομα προϊόντος αν διαβάζεται, και ό,τι είναι χρήσιμο όπως γεύση, περιεχόμενο, ημερομηνία λήξης ή οδηγίες"}. ' +
    'Αν δεν είσαι σίγουρος, πες το στο description.' +
    (h.label ? ` Ο τοπικός ανιχνευτής πιστεύει ότι είναι: ${h.label}.` : '') + (h.text ? ` Κείμενο ετικέτας: «${h.text}».` : ''),
  read: () => 'Διάβασε ολόκληρο το κείμενο που φαίνεται στην εικόνα, με τη σειρά ανάγνωσης και ακριβώς όπως είναι γραμμένο (ελληνικά ή αγγλικά), χωρίς σχόλια ή μορφοποίηση. ' +
    'Αν είναι ετικέτα, μενού, φάρμακο ή έγγραφο, διάβασε πρώτα τα κύρια στοιχεία (όνομα, τιμή, ημερομηνία, δοσολογία). Αν δεν υπάρχει κείμενο, πες μόνο: Δεν βλέπω κείμενο.',
  scene: () => 'Βοηθάς έναν τυφλό χρήστη. Περιέγραψε στα ελληνικά τι υπάρχει μπροστά στην κάμερα, από αριστερά προς τα δεξιά και από κοντά προς μακριά. ' +
    'Ανάφερε τα σημαντικότερα αντικείμενα, ανθρώπους, κείμενα/πινακίδες και οτιδήποτε μπορεί να είναι εμπόδιο ή κίνδυνος. ' +
    'Μέγιστο 6 σύντομες προτάσεις, χωρίς εισαγωγή και χωρίς μορφοποίηση.'
};

/** Ενιαία είσοδος: ο πάροχος επιλέγεται από τα κλειδιά που έχει βάλει ο χρήστης. Επιστρέφει {name?, description}. */
export async function cloudAnalyze(cfg, base64, kind, hints = {}) {
  const prompt = PROMPTS[kind](hints);
  let raw;
  const viaClaude = () => askVision(cfg.cloudKey, base64, { ...hints, _prompt: prompt });
  if (cfg.geminiKey) {
    try {
      raw = await geminiGenerate(cfg.geminiKey, cfg.geminiModel, [{ inline_data: { mime_type: 'image/jpeg', data: base64 } }, { text: prompt }],
        kind === 'identify' ? { responseMimeType: 'application/json' } : kind === 'read' ? { maxOutputTokens: 2000 } : undefined);
    } catch (e) { if (!cfg.cloudKey) throw e; raw = await viaClaude(); } // αν έχει και κλειδί Claude, δοκιμάζεται ως εφεδρικό
  } else if (cfg.cloudKey) {
    raw = await viaClaude();
  } else throw new Error('no key');
  if (kind !== 'identify') return { description: raw };
  try {
    const j = JSON.parse(raw.replace(/^```(?:json)?|```$/g, '').trim());
    return { name: String(j.name || '').trim(), description: String(j.description || '').trim() };
  } catch { return { description: raw }; }
}
