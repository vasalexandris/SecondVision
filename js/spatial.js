// Γεωμετρία χώρου: κατεύθυνση κάμερας, εκτίμηση απόστασης, φράσεις καθοδήγησης. Καθαρές συναρτήσεις.
import { classInfo } from './lang-el.js';

const D2R = Math.PI / 180, R2D = 180 / Math.PI;
export const normAngle = a => { a = ((a + 180) % 360 + 360) % 360 - 180; return a === -180 ? 180 : a; }; // (-180,180]
export const normHeading = a => ((a % 360) + 360) % 360;

/**
 * Κατεύθυνση (azimuth από το βορρά, 0-360) και κλίση (pitch, + προς τα πάνω) προς την οποία δείχνει η ΠΙΣΩ κάμερα,
 * από τα W3C Euler angles (alpha, beta, gamma) της συσκευής. Δουλεύει με το κινητό όρθιο (κολιέ/καπέλο).
 */
export function cameraDirection(alpha, beta, gamma) {
  const a = alpha * D2R, b = beta * D2R, g = gamma * D2R;
  const cA = Math.cos(a), sA = Math.sin(a), cB = Math.cos(b), sB = Math.sin(b), cG = Math.cos(g), sG = Math.sin(g);
  // Τρίτη στήλη του R = Rz(α)Rx(β)Ry(γ) είναι ο άξονας +Z της συσκευής στον κόσμο (Ανατολή, Βορράς, Πάνω)
  const zx = cG * sA * sB + cA * sG, zy = sA * sG - cA * cG * sB, zz = cB * cG;
  const x = -zx, y = -zy, z = -zz; // η πίσω κάμερα κοιτάει προς -Z
  const horiz = Math.hypot(x, y);
  return { heading: horiz < 0.2 ? null : normHeading(Math.atan2(x, y) * R2D), pitch: Math.atan2(z, horiz) * R2D };
}

/** Οριζόντιο FOV (μοίρες) από το FOV της μεγάλης πλευράς του αισθητήρα και τις διαστάσεις του καρέ. */
export function horizontalFov(fovLongDeg, w, h) {
  if (w >= h) return fovLongDeg;
  return 2 * Math.atan(Math.tan(fovLongDeg * D2R / 2) * (w / h)) * R2D;
}

/** Γωνία (μοίρες, + δεξιά) του κέντρου ενός bbox σε σχέση με τον άξονα της κάμερας. */
export function bboxAngle(bbox, frameW, hfov) {
  const cx = bbox.x + bbox.w / 2;
  const nx = cx / frameW - 0.5;
  return Math.atan(2 * nx * Math.tan(hfov * D2R / 2)) * R2D;
}

/** Εκτίμηση απόστασης (m) με το μοντέλο pinhole και τυπικά μεγέθη αντικειμένων. */
export function estimateDistance(cls, bbox, frameW, frameH, hfov, realSize) {
  const info = realSize || classInfo(cls);
  const f = (frameW / 2) / Math.tan(hfov * D2R / 2); // εστιακή απόσταση σε pixel
  const m = 0.03;
  const clippedX = bbox.x < frameW * m || bbox.x + bbox.w > frameW * (1 - m);
  const clippedY = bbox.y < frameH * m || bbox.y + bbox.h > frameH * (1 - m);
  const est = [];
  if (!clippedY && info.h && bbox.h > 0) est.push(info.h * f / bbox.h);
  if (!clippedX && info.w && bbox.w > 0) est.push(info.w * f / bbox.w);
  if (!est.length) { // το αντικείμενο κόβεται: κάτω όριο απόστασης από τη μεγαλύτερη διάσταση
    const dim = Math.max(info.h || 0, info.w || 0) || 0.4;
    est.push(dim * f / Math.max(bbox.w, bbox.h) * 0.8);
  }
  // Γεωμετρικός μέσος: πιο σταθερός όταν οι εκτιμήσεις διαφέρουν
  const d = Math.exp(est.reduce((s, x) => s + Math.log(x), 0) / est.length);
  return Math.min(30, Math.max(0.15, d));
}

export function describeDistance(d) {
  if (d == null) return '';
  if (d < 0.5) return 'πολύ κοντά';
  if (d < 1) return 'κοντά, λιγότερο από ένα μέτρο';
  if (d < 10) {
    const r = Math.round(d * 2) / 2; // βήμα μισού μέτρου
    const txt = String(r).replace('.', ',');
    if (r === 1) return 'σε ένα μέτρο';
    return `σε περίπου ${txt} μέτρα`;
  }
  return `μακριά, περίπου ${Math.round(d / 5) * 5} μέτρα`;
}

/** Θέση σε ώρα ρολογιού από σχετική γωνία (0 = ευθεία μπροστά, + δεξιά). */
export function clockPosition(rel) {
  const h = Math.round(normAngle(rel) / 30);
  return ((h % 12) + 12) % 12 || 12;
}

/** Φράση σχετικής θέσης: «μπροστά δεξιά», «πίσω σας» κλπ. */
export function describeRelative(rel) {
  const a = normAngle(rel), abs = Math.abs(a), side = a < 0 ? 'αριστερά' : 'δεξιά';
  if (abs < 15) return 'ευθεία μπροστά';
  if (abs < 60) return `μπροστά ${side}`;
  if (abs < 120) return `${side} σας`;
  if (abs < 165) return `πίσω ${side}`;
  return 'πίσω σας';
}

/** Οδηγία στροφής: «γυρίστε δεξιά 40 μοίρες». */
export function turnInstruction(rel) {
  const a = normAngle(rel), abs = Math.abs(a);
  if (abs < 8) return 'ευθεία μπροστά';
  if (abs > 165) return 'γυρίστε πίσω σας';
  const deg = Math.max(10, Math.round(abs / 10) * 10);
  return `γυρίστε ${a < 0 ? 'αριστερά' : 'δεξιά'} ${deg} μοίρες`;
}

export const COMPASS8 = ['βόρεια', 'βορειοανατολικά', 'ανατολικά', 'νοτιοανατολικά', 'νότια', 'νοτιοδυτικά', 'δυτικά', 'βορειοδυτικά'];
export const compassName = h => COMPASS8[Math.round(normHeading(h) / 45) % 8];

/** Απόσταση (m) και αζιμούθιο (0-360) μεταξύ δύο σημείων GPS. */
export function geoVector(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const p1 = lat1 * D2R, p2 = lat2 * D2R, dp = (lat2 - lat1) * D2R, dl = (lon2 - lon1) * D2R;
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  const dist = 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
  const y = Math.sin(dl) * Math.cos(p2), x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return { distance: dist, bearing: normHeading(Math.atan2(y, x) * R2D) };
}

export function describeLongDistance(m) {
  if (m < 15) return 'λίγα μέτρα';
  if (m < 1000) return `${Math.round(m / 10) * 10} μέτρα`;
  return `${(m / 1000).toFixed(1).replace('.', ',')} χιλιόμετρα`;
}

export function describeAge(ms) {
  const s = Math.round(ms / 1000);
  if (s < 10) return 'μόλις τώρα';
  if (s < 60) return `πριν ${s} δευτερόλεπτα`;
  const m = Math.round(s / 60);
  if (m < 60) return m === 1 ? 'πριν ένα λεπτό' : `πριν ${m} λεπτά`;
  const h = Math.round(m / 60);
  if (h < 24) return h === 1 ? 'πριν μία ώρα' : `πριν ${h} ώρες`;
  const d = Math.round(h / 24);
  return d === 1 ? 'χθες' : `πριν ${d} ημέρες`;
}

/** Ρυθμός μπιπ (Hz) και τόνος ανάλογα με το πόσο κοντά στον στόχο είναι η κατεύθυνση. */
export function guidanceTone(relAngle) {
  const a = Math.abs(normAngle(relAngle));
  const closeness = Math.max(0, 1 - a / 90); // 1 όταν κοιτάμε τον στόχο
  return { closeness, rate: 1.2 + closeness * 6, freq: 330 + closeness * 550, pan: Math.max(-1, Math.min(1, normAngle(relAngle) / 60)) };
}
