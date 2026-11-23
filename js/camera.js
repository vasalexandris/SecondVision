// Κάμερα: άνοιγμα ροής, επιλογή συσκευής (π.χ. εξωτερική/Bluetooth κάμερα που εμφανίζεται ως webcam), φλας.
export class Camera {
  stream = null; track = null; torchOn = false;
  constructor(video) { this.video = video; }

  get torchSupported() {
    try { return !!(this.track && this.track.getCapabilities && this.track.getCapabilities().torch); } catch { return false; }
  }

  async start({ facing = 'environment', deviceId = '' } = {}) {
    this.stop();
    const base = { width: { ideal: 960 }, height: { ideal: 720 }, frameRate: { ideal: 30 } };
    const attempts = [
      deviceId ? { video: { ...base, deviceId: { exact: deviceId } } } : null,
      { video: { ...base, facingMode: { ideal: facing } } },
      { video: true }
    ].filter(Boolean);
    let lastErr;
    for (const c of attempts) {
      try { this.stream = await navigator.mediaDevices.getUserMedia({ ...c, audio: false }); break; } catch (e) { lastErr = e; }
    }
    if (!this.stream) throw lastErr || new Error('no camera');
    this.track = this.stream.getVideoTracks()[0];
    this.video.srcObject = this.stream;
    this.video.setAttribute('playsinline', ''); this.video.muted = true;
    await this.video.play();
    this.torchOn = false;
    return this;
  }

  async setTorch(on) {
    if (!this.torchSupported) return false;
    try { await this.track.applyConstraints({ advanced: [{ torch: !!on }] }); this.torchOn = !!on; return true; } catch { return false; }
  }

  stop() {
    this.stream?.getTracks().forEach(t => t.stop());
    this.stream = null; this.track = null; this.torchOn = false;
    this.video.srcObject = null;
  }

  static async listDevices() {
    try {
      const d = await navigator.mediaDevices.enumerateDevices();
      return d.filter(x => x.kind === 'videoinput').map((x, i) => ({ id: x.deviceId, label: x.label || `Κάμερα ${i + 1}` }));
    } catch { return []; }
  }
}
