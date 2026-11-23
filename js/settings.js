// Ρυθμίσεις χρήστη (αποθηκεύονται τοπικά στη συσκευή).
const KEY = 'secondvision.settings.v1';

export const defaults = {
  volume: 0.7,            // γενική ένταση φωνής 0..1
  rate: 1.0,              // ταχύτητα ομιλίας
  voice: true,            // φωνητικές ανακοινώσεις αντικειμένων
  verbosity: 1,           // 0 ελάχιστη, 1 κανονική, 2 αναλυτική
  mode: 'explore',        // explore | walk | car (επιβάτης: σίγαση προειδοποιήσεων οχημάτων)
  voiceDelay: 6,          // δευτερόλεπτα πριν ξαναπεί το ίδιο είδος
  minScore: 0.5,          // ελάχιστη βεβαιότητα ανίχνευσης
  model: 'lite0',         // lite0 (γρήγορο) | lite2 (ακριβές)
  fovLong: 66,            // οριζόντιο FOV μεγάλης πλευράς αισθητήρα (μοίρες)
  autoTorch: true,        // αυτόματο φλας σε χαμηλό φωτισμό
  beeps: true,            // ηχητικά σήματα καθοδήγησης
  haptics: true,          // δονήσεις
  handsFree: false,       // συνεχής ακρόαση με λέξη-κλειδί «όραση»
  showVideo: true,        // εμφάνιση εικόνας (για βοηθό με όραση)
  facing: 'environment',  // κάμερα: environment | user
  deviceId: '',           // συγκεκριμένη κάμερα (π.χ. εξωτερική)
  webLookup: true,        // «τι είναι αυτό»: αναζήτηση στη Wikipedia (στέλνει μόνο λέξεις)
  cloudKey: '',           // προαιρετικό κλειδί Claude API για περιγραφή από εικόνα (opt-in)
  faces: true,            // αναγνώριση προσώπων που έχουν αποθηκευτεί
  classMute: {},          // { cls|id: true }
  classGain: {}           // { cls|id: 0.3..2 }
};

let state = { ...defaults };
try {
  const raw = localStorage.getItem(KEY);
  if (raw) state = { ...defaults, ...JSON.parse(raw) };
} catch { /* ιδιωτική περιήγηση κλπ. */ }

const listeners = new Set();
export const settings = new Proxy(state, {
  set(obj, prop, value) {
    obj[prop] = value;
    persist();
    listeners.forEach(fn => fn(prop, value));
    return true;
  }
});
export function onSettingChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function persist() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* αγνόησε */ }
}
export function resetSettings() { Object.assign(state, JSON.parse(JSON.stringify(defaults))); persist(); }
