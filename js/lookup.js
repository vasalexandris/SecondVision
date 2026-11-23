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
  const prompt = 'Βοηθάς έναν τυφλό χρήστη. Στην εικόνα, το αντικείμενο που κρατά ή δείχνει είναι συνήθως στο κέντρο. ' +
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
