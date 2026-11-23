// Μόνιμη μνήμη (IndexedDB): νέα αντικείμενα, πρόσωπα, τόποι και πού/πότε είδαμε κάτι τελευταία φορά.
// Όλα μένουν στη συσκευή. Αν η IndexedDB δεν είναι διαθέσιμη, δουλεύει προσωρινά στη RAM.

const DB_NAME = 'secondvision';
const STORES = ['items', 'people', 'places', 'sightings'];
const KEYPATH = { items: 'id', people: 'id', places: 'id', sightings: 'key' };

let dbPromise = null;
const ram = { items: new Map(), people: new Map(), places: new Map(), sightings: new Map() };

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    if (!('indexedDB' in globalThis)) return resolve(null);
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: KEYPATH[s] });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
  return dbPromise;
}

function tx(db, store, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const r = fn(t.objectStore(store));
    t.oncomplete = () => resolve(r && 'result' in r ? r.result : undefined);
    t.onerror = () => reject(t.error);
  });
}

export async function getAll(store) {
  const db = await open();
  if (!db) return [...ram[store].values()];
  return tx(db, store, 'readonly', s => s.getAll());
}
export async function put(store, obj) {
  const db = await open();
  ram[store].set(obj[KEYPATH[store]], obj);
  if (db) await tx(db, store, 'readwrite', s => s.put(obj));
}
export async function remove(store, key) {
  const db = await open();
  ram[store].delete(key);
  if (db) await tx(db, store, 'readwrite', s => s.delete(key));
}
export async function clear(store) {
  const db = await open();
  ram[store].clear();
  if (db) await tx(db, store, 'readwrite', s => s.clear());
}

export const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);

/** Φορτώνει τα πάντα στη RAM για γρήγορη πρόσβαση στο loop. */
export class Memory {
  items = [];    // {id, name, embeddings: Float32Array[]}
  people = [];   // {id, name, descriptors: Float32Array[]}
  places = [];   // {id, name, lat, lon}
  sightings = new Map(); // key -> {key,label,kind,t,az,dist,lat,lon,placeName}
  dirty = new Set();
  #timer = null;

  async load() {
    [this.items, this.people, this.places] = await Promise.all([getAll('items'), getAll('people'), getAll('places')]);
    for (const s of await getAll('sightings')) this.sightings.set(s.key, s);
  }

  async saveItem(item) {
    const i = this.items.findIndex(x => x.id === item.id);
    if (i >= 0) this.items[i] = item; else this.items.push(item);
    await put('items', item);
  }
  async savePerson(p) {
    const i = this.people.findIndex(x => x.id === p.id);
    if (i >= 0) this.people[i] = p; else this.people.push(p);
    await put('people', p);
  }
  async savePlace(p) {
    const i = this.places.findIndex(x => x.id === p.id);
    if (i >= 0) this.places[i] = p; else this.places.push(p);
    await put('places', p);
  }
  async forget(kind, id) {
    const store = { custom: 'items', person: 'people', place: 'places' }[kind];
    if (!store) return;
    this[store] = this[store].filter(x => x.id !== id);
    await remove(store, id);
    for (const [k, s] of [...this.sightings]) if (s.id === id) { this.sightings.delete(k); await remove('sightings', k); }
  }
  async forgetAll(kind) {
    const store = { custom: 'items', person: 'people', place: 'places' }[kind];
    this[store] = [];
    await clear(store);
  }

  /** Καταγραφή τελευταίας θέσης όπου είδαμε κάτι. Αποθηκεύεται ασύγχρονα (debounce). */
  noteSighting(s) {
    this.sightings.set(s.key, s);
    this.dirty.add(s.key);
    if (!this.#timer) this.#timer = setTimeout(() => this.flush(), 5000);
  }
  async flush() {
    clearTimeout(this.#timer); this.#timer = null;
    const keys = [...this.dirty]; this.dirty.clear();
    for (const k of keys) { const s = this.sightings.get(k); if (s) await put('sightings', s); }
  }

  /** Υποψήφιοι στόχοι για φωνητικές εντολές. */
  candidates() {
    return [
      ...this.items.map(i => ({ id: i.id, kind: 'custom', label: i.name, names: [i.name] })),
      ...this.people.map(p => ({ id: p.id, kind: 'person', label: p.name, names: [p.name] })),
      ...this.places.map(p => ({ id: p.id, kind: 'place', label: p.name, names: [p.name] }))
    ];
  }
}
