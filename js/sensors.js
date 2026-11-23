// Αισθητήρες συσκευής: πυξίδα/προσανατολισμός, GPS, wake lock, μπαταρία.
import { cameraDirection, normHeading, normAngle } from './spatial.js';

const D2R = Math.PI / 180, R2D = 180 / Math.PI;

export class Sensors {
  pose = { heading: null, pitch: 0, absolute: false, t: 0 };
  position = null; // {lat, lon, acc, t}
  #vec = null;      // εξομαλυμένο μοναδιαίο διάνυσμα heading
  #iosOffset = null;
  #wake = null;
  #geoId = null;
  hasOrientation = false;

  async start() {
    await this.#startOrientation();
    this.#startGeo();
    this.#startWake();
  }

  async #startOrientation() {
    const handler = (e) => {
      if (e.alpha == null || e.beta == null) return;
      const cam = cameraDirection(e.alpha, e.beta, e.gamma ?? 0);
      let heading = cam.heading;
      let absolute = e.absolute === true || e.type === 'deviceorientationabsolute';
      if (typeof e.webkitCompassHeading === 'number' && heading != null) {
        // iOS: το alpha είναι σχετικό· βαθμονομούμε με τη μαγνητική πυξίδα όταν το κινητό είναι όρθιο
        if (Math.abs(cam.pitch) < 35) {
          const off = normAngle(e.webkitCompassHeading - heading);
          this.#iosOffset = this.#iosOffset == null ? off : this.#iosOffset + 0.1 * normAngle(off - this.#iosOffset);
        }
        if (this.#iosOffset != null) { heading = normHeading(heading + this.#iosOffset); absolute = true; }
      }
      this.pose.pitch = cam.pitch;
      this.pose.absolute = absolute;
      this.pose.t = performance.now();
      if (heading == null) return; // το κινητό είναι οριζόντιο — κρατάμε την τελευταία τιμή
      const v = { x: Math.sin(heading * D2R), y: Math.cos(heading * D2R) };
      this.#vec = this.#vec ? { x: this.#vec.x + 0.3 * (v.x - this.#vec.x), y: this.#vec.y + 0.3 * (v.y - this.#vec.y) } : v;
      this.pose.heading = normHeading(Math.atan2(this.#vec.x, this.#vec.y) * R2D);
      this.hasOrientation = true;
    };
    if ('ondeviceorientationabsolute' in window) window.addEventListener('deviceorientationabsolute', handler, true);
    window.addEventListener('deviceorientation', (e) => { if (!('ondeviceorientationabsolute' in window)) handler(e); }, true);
    // iOS (και νεότερα Chrome): χρειάζεται άδεια μέσα σε χειρονομία χρήστη. Οι listeners υπάρχουν ήδη,
    // οπότε αν η άδεια δοθεί αργότερα ή απορριφθεί, απλώς δεν θα φτάνουν γεγονότα.
    try {
      if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
        await Promise.race([DeviceOrientationEvent.requestPermission(), new Promise(r => setTimeout(r, 4000))]);
      }
    } catch { /* αγνόησε */ }
  }

  #startGeo() {
    if (!('geolocation' in navigator)) return;
    try {
      this.#geoId = navigator.geolocation.watchPosition(
        p => { this.position = { lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy, t: Date.now() }; },
        () => { /* χωρίς GPS: οι λειτουργίες τόπου απλώς μένουν ανενεργές */ },
        { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 }
      );
    } catch { /* αγνόησε */ }
  }

  async #startWake() {
    const acquire = async () => {
      try { if ('wakeLock' in navigator) this.#wake = await navigator.wakeLock.request('screen'); } catch { /* αγνόησε */ }
    };
    await acquire();
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') acquire(); });
  }

  async battery() {
    try {
      if (!navigator.getBattery) return null;
      const b = await navigator.getBattery();
      return { level: Math.round(b.level * 100), charging: b.charging };
    } catch { return null; }
  }

  /** Φρέσκια τοποθεσία (ή η τελευταία γνωστή). */
  freshPosition(maxAgeMs = 60000) {
    return this.position && Date.now() - this.position.t < maxAgeMs ? this.position : null;
  }

  /** Σκανάρει αν το heading είναι έγκυρο (πρόσφατο). */
  headingNow() {
    return this.hasOrientation && performance.now() - this.pose.t < 1500 ? this.pose.heading : null;
  }
}
