// Απλός tracker βάσει IoU: σταθερά IDs ανά αντικείμενο, ιστορικό απόστασης και ταχύτητα προσέγγισης.
const iou = (a, b) => {
  const x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w), y2 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  return inter / (a.w * a.h + b.w * b.h - inter || 1);
};

export class Tracker {
  tracks = [];
  #id = 1;
  constructor({ maxAgeMs = 1500, minHits = 2, iouMin = 0.25 } = {}) { this.maxAge = maxAgeMs; this.minHits = minHits; this.iouMin = iouMin; }

  /** dets: [{cls, score, bbox, dist, angle, ...}] */
  update(dets, now = performance.now()) {
    const used = new Set();
    for (const tr of this.tracks) {
      let best = null, bi = -1;
      dets.forEach((d, i) => {
        if (used.has(i) || d.cls !== tr.cls) return;
        const v = iou(tr.bbox, d.bbox);
        if (v > this.iouMin && (!best || v > best)) { best = v; bi = i; }
      });
      if (bi >= 0) {
        used.add(bi);
        const d = dets[bi];
        tr.bbox = d.bbox; tr.score = d.score; tr.angle = d.angle; tr.az = d.az;
        tr.hits++; tr.lastSeen = now;
        if (d.dist != null) {
          tr.dist = tr.dist == null ? d.dist : tr.dist * 0.6 + d.dist * 0.4; // εξομάλυνση
          tr.hist.push({ t: now, d: tr.dist });
          if (tr.hist.length > 12) tr.hist.shift();
        }
        tr.visible = true;
      } else tr.visible = false;
    }
    dets.forEach((d, i) => {
      if (used.has(i)) return;
      this.tracks.push({
        id: this.#id++, cls: d.cls, bbox: d.bbox, score: d.score, angle: d.angle, az: d.az,
        dist: d.dist, hist: d.dist != null ? [{ t: now, d: d.dist }] : [], hits: 1, firstSeen: now, lastSeen: now,
        visible: true, announced: 0, name: null, flags: {}
      });
    });
    this.tracks = this.tracks.filter(t => now - t.lastSeen < this.maxAge);
    return this.stable();
  }

  stable() { return this.tracks.filter(t => t.visible && t.hits >= this.minHits); }

  /** Ταχύτητα προσέγγισης σε m/s (θετική = πλησιάζει). */
  static approachSpeed(tr) {
    const h = tr.hist;
    if (h.length < 4) return 0;
    const a = h[0], b = h[h.length - 1];
    const dt = (b.t - a.t) / 1000;
    return dt > 0.4 ? (a.d - b.d) / dt : 0;
  }
}
