// Αναλυτής φωνητικών εντολών στα ελληνικά. Καθαρές συναρτήσεις — δοκιμάζονται με `node --test`.

export function norm(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/ς/g, 'σ')
    .replace(/[^a-zα-ω0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const FILLER = new Set(['το', 'τα', 'τον', 'την', 'τη', 'τους', 'τις', 'ο', 'η', 'οι', 'ενα', 'μια', 'μου', 'μας',
  'ενος', 'στο', 'στη', 'στην', 'απο', 'ως', 'σαν', 'αυτο', 'αυτα', 'σε', 'της', 'του', 'των', 'να', 'μοιρες', 'μου', 'μηπως',
  'και', 'μονο', 'παλι', 'ξανα', 'πιο', 'παρα', 'πολυ']);

const NUMBERS = {
  ενα: 1, εναν: 1, μια: 1, δυο: 2, τρια: 3, τρεις: 3, τεσσερα: 4, τεσσερις: 4, πεντε: 5, εξι: 6, εφτα: 7, επτα: 7,
  οκτω: 8, οχτω: 8, εννια: 9, εννεα: 9, δεκα: 10, μηδεν: 0
};

export function parseNumber(normText) {
  const m = normText.match(/\b(\d{1,3})\b/);
  if (m) return parseInt(m[1], 10);
  for (const w of normText.split(' ')) if (w in NUMBERS) return NUMBERS[w];
  return null;
}

function lev(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

function wordMatch(a, b) {
  if (a === b) return 1;
  const minLen = Math.min(a.length, b.length);
  if (minLen < 3) return 0;
  let p = 0;
  while (p < minLen && a[p] === b[p]) p++;
  // Κοινό θέμα (ελληνικές καταλήξεις αλλάζουν: κλειδί/κλειδιά, σκύλος/σκύλο)
  if (p >= Math.max(3, minLen - 2) && p >= Math.max(a.length, b.length) - 4) return 0.9;
  if (minLen >= 5 && lev(a, b) <= 1) return 0.85;
  if (minLen >= 7 && lev(a, b) <= 2) return 0.75;
  return 0;
}

function contentWords(normText) {
  return normText.split(' ').filter(w => w && !FILLER.has(w));
}

/** Βρίσκει ποιο από τα candidates αναφέρει η φράση. candidates: [{id, kind, label, names[]}] */
export function resolveTarget(phrase, candidates, minScore = 0.75) {
  const words = contentWords(norm(phrase));
  if (!words.length) return null;
  const joined = words.join(' ');
  let best = null;
  for (const c of candidates) {
    for (const rawName of c.names) {
      const nameWords = contentWords(norm(rawName));
      if (!nameWords.length) continue;
      const nameJoined = nameWords.join(' ');
      let score = 0;
      if (nameJoined === joined) score = 1;
      else if ((' ' + joined + ' ').includes(' ' + nameJoined + ' ')) score = 0.97;
      else {
        let matched = 0;
        for (const nw of nameWords) {
          let bw = 0;
          for (const pw of words) bw = Math.max(bw, wordMatch(pw, nw));
          matched += bw;
        }
        score = (matched / nameWords.length) * (nameWords.length === 1 ? 1 : 0.95);
        // η φράση δεν πρέπει να έχει πολλές επιπλέον άσχετες λέξεις
        if (words.length > nameWords.length + 1) score *= 0.85;
      }
      if (!best || score > best.score) best = { ...c, score, matchedName: rawName };
    }
  }
  return best && best.score >= minScore ? best : null;
}

// Τα regex γράφονται με «ς»· η εισαγωγή κανονικοποιείται σε «σ», άρα μετατρέπουμε και το pattern.
const sig = re => new RegExp(re.source.replace(/ς/g, 'σ'), re.flags);

const mk = arr => new Set(arr.map(norm));
const NAME_SKIP = {
  person: mk(['αυτος', 'αυτη', 'αυτον', 'αυτην', 'ειναι', 'ο', 'η', 'κος', 'κ', 'κυρια', 'κυριος', 'θυμησου', 'μαθε',
    'γνωρισε', 'αποθηκευσε', 'τον', 'την', 'ανθρωπο', 'ανθρωπος', 'μπροστα', 'μου', 'ως', 'σαν', 'με', 'ονομα', 'το', 'προσωπο', 'αυτο']),
  object: mk(['μαθε', 'θυμησου', 'απομνημονευσε', 'αποθηκευσε', 'καταχωρησε', 'εκπαιδευσε', 'αυτο', 'αυτα', 'το', 'τα',
    'αντικειμενο', 'ως', 'σαν', 'με', 'ονομα', 'για', 'ειναι', 'τη', 'την', 'τον', 'η', 'ο', 'οι']),
  place: mk(['θυμησου', 'αποθηκευσε', 'σημειωσε', 'καταχωρησε', 'αυτο', 'αυτη', 'το', 'τη', 'την', 'μερος', 'θεση',
    'εδω', 'ως', 'σαν', 'με', 'ονομα', 'ειναι', 'η', 'ο'])
};

// Κοινές λέξεις που αγνοούνται όταν ψάχνουμε αντικείμενο μέσα σε εντολή έντασης
const VOL_WORDS = mk(['πες', 'λεγε', 'ανακοινωνε', 'αναφερε', 'το', 'τα', 'τον', 'την', 'τους', 'τις', 'τη', 'μου', 'πιο',
  'δυνατοτερα', 'δυνατα', 'δυναμωσε', 'ανεβασε', 'ενταση', 'σιγοτερα', 'σιγα', 'χαμηλωσε', 'χαμηλα', 'χαμηλοτερα', 'κατεβασε',
  'ηχο', 'φωνη', 'της', 'του', 'των', 'στο', 'στα', 'σε']);

// Συγκεκριμένη σειρά: οι πιο ειδικές εντολές πρώτα.
export function parseCommand(text, ctx = {}) {
  const original = String(text || '').trim();
  const t = norm(original);
  const candidates = ctx.candidates || [];
  const people = candidates.filter(c => c.kind === 'person');
  const places = candidates.filter(c => c.kind === 'place');
  const objects = candidates.filter(c => c.kind === 'class' || c.kind === 'custom');
  const tokens = original.split(/\s+/).filter(Boolean);
  const normTokens = tokens.map(norm);
  if (!t) return { intent: 'NONE' };

  const has = (re) => sig(re).test(t);
  const match = (re) => t.match(sig(re));
  // Όνομα = ό,τι μένει αφού αφαιρεθούν οι αρχικές λέξεις της εντολής (διατηρεί αρχική γραφή/κεφαλαία)
  const nameAfterSkip = (skip) => {
    let i = 0;
    while (i < normTokens.length && skip.has(normTokens[i])) i++;
    return tokens.slice(i).join(' ').replace(/[.,;!?]+$/g, '').trim();
  };

  // ---- Άμεσες / ειδικές ----
  if (has(/(^| )(βοηθεια|οδηγιες χρησης|τι μπορεις|ποιες ειναι οι εντολες|εντολες)( |$)/)) return { intent: 'HELP' };
  if (has(/^(επαναλαβε|ξαναπες|τι ειπες|πες το ξανα|ξαναλεγε)/)) return { intent: 'REPEAT' };
  // Μέσο μεταφοράς: σταματά τις προειδοποιήσεις οχημάτων
  if (has(/(δεν ειμαι πια|βγηκα|κατεβηκα|βγαινω|κατεβαινω|τελειωσα).*(αυτοκινητο|αμαξι|λεωφορειο|τρενο|ταξι|μεταφορα|οχημα)/) ||
      has(/^(κανονικη λειτουργια|εξερευνηση)$/)) return { intent: 'MODE', value: 'explore', leaveVehicle: true };
  if (has(/(ειμαι|βρισκομαι|μπηκα|καθομαι|ταξιδευω).*(μεσα σε|σε|στο|στη|στον) (ενα )?(αυτοκινητο|αμαξι|λεωφορειο|τρενο|ταξι|οχημα|μεταφορικο)/)) return { intent: 'MODE', value: 'car' };
  // «Τι είναι αυτό;» — αναγνώριση αντικειμένου/προϊόντος με αναζήτηση
  if (has(/^(τι|ποιο|ποια|ποιος) (.+ )?(ειναι|λεγεται) (αυτο|αυτος|αυτη|αυτα)( |$)/) || has(/(αναγνωρισε|ψαξε στο (ιντερνετ|διαδικτυο)|ψαξε online) ?(αυτο)?/) ||
      has(/^τι (αντικειμενο|προιον|πραγμα|φαγητο|ποτο|φαρμακο|μπουκαλι|κουτι|πακετο)/)) {
    const m0 = match(/^τι (.+?) ειναι αυτο/);
    const hint = m0 ? resolveTarget(m0[1], objects) : null;
    return { intent: 'IDENTIFY', target: hint };
  }
  if (has(/(^| )(μπαταρια)( |$)/)) return { intent: 'BATTERY' };
  if (has(/(τι ωρα|ποια ωρα|ωρα ειναι)/)) return { intent: 'TIME' };
  if (has(/(που (βρισκομαι|ειμαι)|ποια τοποθεσια)/)) return { intent: 'WHERE_AM_I' };
  if (has(/^(διαβασε|διαβαζε|τι γραφει|διαβασμα)/)) return { intent: 'READ_TEXT' };
  if (has(/(σαρωση|σαρωσε|κανε (μια )?στροφη|γυρισε γυρω|δες γυρω|κυκλο 360|360)/)) return { intent: 'SCAN' };
  if (has(/(τι (βλεπεις|υπαρχει|βλεπω|εχει|ειναι μπροστα|εχει γυρω)|περιγραψε|περιγραφη)/)) return { intent: 'DESCRIBE' };

  // ---- Φακός / οθόνη ----
  if (has(/(μην|σταματα|σβησε|κλεισε|απενεργοποιησε).*(αυτοματο|αυτοματα).*(φακο|φως|φλας|αναβεις)/) ||
      has(/(απενεργοποιησε|κλεισε|σβησε) .*αυτοματο (φακο|φως|φλας)/)) return { intent: 'TORCH_AUTO', value: false };
  if (has(/αυτοματο (φακος|φακο|φως|φλας)/)) return { intent: 'TORCH_AUTO', value: true };
  if (has(/(ανοιξε|αναψε|ενεργοποιησε|βαλε).*(φακο|φως|φλας)/)) return { intent: 'TORCH', value: true };
  if (has(/(σβησε|κλεισε|απενεργοποιησε|σβηστο).*(φακο|φως|φλας)/)) return { intent: 'TORCH', value: false };
  if (has(/(μαυρη οθονη|σβησε την οθονη|οθονη ηρεμιας|κλεισε την οθονη)/)) return { intent: 'SCREEN', value: false };
  if (has(/(ανοιξε την οθονη|αναψε την οθονη|ξυπνα την οθονη)/)) return { intent: 'SCREEN', value: true };

  // ---- Σίγαση ανά αντικείμενο ----
  let m = match(/^(?:μην|μη)(?: μου)? (?:λες|ανακοινωνεις|αναφερεις|ειπωνεις) (.+)$/) ||
          match(/^σταματα να(?: μου)? (?:λες|ανακοινωνεις|αναφερεις) (.+)$/) ||
          match(/^(?:αγνοησε|σιγαση) (.+)$/);
  if (m) {
    const target = resolveTarget(m[1], objects.concat(people));
    if (target) return { intent: 'MUTE_OBJECT', target };
    if (/^(τιποτα|τιποτε|ολα)/.test(m[1])) return { intent: 'MUTE_ALL' };
    return { intent: 'UNKNOWN_OBJECT', phrase: m[1] };
  }
  if (has(/^(μην|μη) (μου )?μιλ(ας|α)/) || has(/^(σιγαση|σιωπη|ησυχια|βουβος|κανε ησυχια)$/)) return { intent: 'MUTE_ALL' };
  if (has(/^(μιλα ξανα|ξαναμιλα|ενεργοποιησε τη φωνη|ανοιξε τη φωνη|φωνη ενεργη|μιλα)$/)) return { intent: 'UNMUTE_ALL' };

  // ---- Ένταση (γενική ή ανά αντικείμενο) ----
  const loud = has(/(δυνατοτερα|δυνατα|δυναμωσε|ανεβασε|ενταση)/);
  const soft = has(/(σιγοτερα|σιγα|χαμηλωσε|χαμηλα|χαμηλοτερα|κατεβασε)/);
  if ((loud || soft) && !has(/(^| )μιλα(ς)?( |$)/)) {
    const restWords = normTokens.filter(w => !VOL_WORDS.has(w));
    const num = parseNumber(t);
    const objWords = restWords.filter(w => !(w in NUMBERS) && !/^\d+$/.test(w));
    if (objWords.length) {
      const target = resolveTarget(objWords.join(' '), objects.concat(people));
      if (target) return { intent: 'VOLUME_OBJECT', target, dir: loud && !soft ? 'up' : 'down' };
    }
    if (num !== null && has(/(ενταση|ηχο|ηχου)/)) return { intent: 'VOLUME_SET', value: Math.min(10, Math.max(0, num)) };
    return { intent: loud && !soft ? 'VOLUME_UP' : 'VOLUME_DOWN' };
  }
  if (has(/(πιο γρηγορα|γρηγοροτερα)/)) return { intent: 'RATE_UP' };
  if (has(/(πιο αργα|αργοτερα)/)) return { intent: 'RATE_DOWN' };
  if (has(/(λιγοτερα|πιο λιγα|συντομα|ελαχιστα)/)) return { intent: 'VERBOSITY', dir: 'less' };
  if (has(/(περισσοτερα|αναλυτικα|λεπτομερειες|πιο πολλα)/)) return { intent: 'VERBOSITY', dir: 'more' };
  if (has(/(περπατημα|περπατω|βολτα|στο δρομο)/)) return { intent: 'MODE', value: 'walk' };
  if (has(/(εξερευνηση|μεσα στο σπιτι|στο δωματιο|κανονικη λειτουργια)/)) return { intent: 'MODE', value: 'explore' };

  // ---- Τέλος / ακύρωση ----
  if (has(/^(σταματα|σταματησε|στοπ|τελος|ακυρο|ακυρωση|φτανει|σταμα)( |$)/)) return { intent: 'STOP' };
  if (has(/^(παυση|περιμενε|κανε παυση)/)) return { intent: 'PAUSE' };
  if (has(/^(συνεχισε|συνεχιζουμε|ξεκινα|ξαναρχισε|συνεχεια)/)) return { intent: 'RESUME' };

  // ---- Τόπος (πριν από πρόσωπο/αντικείμενο: «αυτό είναι το σπίτι») ----
  if (has(/^(θυμησου|αποθηκευσε|σημειωσε|καταχωρησε) (αυτο το μερος|αυτη τη θεση|αυτη την θεση|το μερος|εδω)/) ||
      has(/^(εδω ειναι|αυτο ειναι) (το|η|ο) (σπιτι|γραφειο|δουλεια|σταση|εισοδος|μερος)/)) {
    return { intent: 'SAVE_PLACE', name: nameAfterSkip(NAME_SKIP.place) };
  }
  // ---- Πρόσωπα ----
  if (has(/^(αυτος|αυτη|αυτον|αυτην) ειναι .+/) ||
      has(/^(θυμησου|μαθε|γνωρισε|αποθηκευσε) (τον|την|αυτον|αυτην|αυτο το προσωπο|τον ανθρωπο)( |$)/) ||
      has(/^ο ανθρωπος μπροστα μου ειναι/)) {
    const name = nameAfterSkip(NAME_SKIP.person);
    const existing = name ? resolveTarget(name, people, 0.9) : null;
    return { intent: 'LEARN_PERSON', name, existing };
  }
  // ---- Νέο αντικείμενο ----
  if (has(/^(μαθε|θυμησου|απομνημονευσε|αποθηκευσε|καταχωρησε|εκπαιδευσε) (το αντικειμενο |αυτο|αυτα)/) ||
      has(/^(αυτο|αυτα) ειναι .+/) ||
      has(/^(μαθε|θυμησου|απομνημονευσε) (το|τα|τη|την|τον) .+/)) {
    return { intent: 'LEARN_OBJECT', name: nameAfterSkip(NAME_SKIP.object) };
  }
  // ---- Διαγραφή ----
  m = match(/^(?:ξεχασε|διεγραψε|διαγραψε|αφαιρεσε) (.+)$/);
  if (m) {
    if (/^ολα|^ολους|^ολες/.test(m[1])) return { intent: 'FORGET_ALL', phrase: m[1] };
    const target = resolveTarget(m[1], candidates.filter(c => c.kind !== 'class'));
    if (target) return { intent: 'FORGET', target };
    return { intent: 'UNKNOWN_OBJECT', phrase: m[1] };
  }

  // ---- Πλοήγηση σε τόπο ----
  m = match(/^(?:οδηγησε με|οδηγησε μας|παμε|πηγαινε με|οδηγιες για|ποια ειναι η διαδρομη για|ποια ειναι η διαδρομη προς)(?: στο| στη| στην| προς| για)? (.+)$/);
  if (m) {
    const place = resolveTarget(m[1], places, 0.7);
    if (place) return { intent: 'NAVIGATE', target: place };
    return { intent: 'UNKNOWN_OBJECT', phrase: m[1] };
  }

  // ---- Πού είναι / Πού άφησα (μνήμη) ----
  m = match(/^(?:που (?:ειναι|ηταν|αφησα|εβαλα|ειδα|βρισκονται|βρισκεται)|ποτε ειδες|που ειδες|που ειδαμε)(?: το| τα| τον| την| τη| τους| τις)? (.+)$/);
  if (m) {
    const place = resolveTarget(m[1], places, 0.8);
    if (place) return { intent: 'PLACE_INFO', target: place };
    const target = resolveTarget(m[1], candidates.filter(c => c.kind !== 'place'));
    if (target) return { intent: 'WHERE', target };
    return { intent: 'UNKNOWN_OBJECT', phrase: m[1] };
  }

  // ---- Αναζήτηση ----
  m = match(/^(?:βρες μου|βρες|ψαξε μου|ψαξε|ψαχνω να βρω|ψαχνω|αναζητησε|δειξε μου|θελω να βρω|θελω|βοηθησε με να βρω)(?: το| τα| τον| την| τη| τους| τις| ενα| μια)? (.+)$/);
  if (m) {
    const target = resolveTarget(m[1], candidates.filter(c => c.kind !== 'place'));
    if (target) return { intent: 'FIND', target };
    return { intent: 'UNKNOWN_OBJECT', phrase: m[1] };
  }

  // ---- Ξανά-ενεργοποίηση αντικειμένου: «λέγε ξανά τις καρέκλες» ----
  m = match(/^(?:λεγε|πες|ανακοινωνε|αναφερε)(?: ξανα)?(?: το| τα| τον| την| τη| τους| τις)? (.+)$/);
  if (m) {
    const target = resolveTarget(m[1], objects.concat(people));
    if (target) return { intent: 'UNMUTE_OBJECT', target };
  }

  // Μόνο το όνομα ενός αντικειμένου → αναζήτηση
  const bare = resolveTarget(t, candidates.filter(c => c.kind !== 'place'), 0.9);
  if (bare && contentWords(t).length <= 3) return { intent: 'FIND', target: bare };

  return { intent: 'UNKNOWN', text: original };
}
