// Minimal in-memory Firestore for tests — just the API surface database.js
// uses, with the same semantics where it matters (update() on a missing doc
// throws, undefined fields are dropped, queries only see direct children).
// A live smoke test (scripts/firestoreSmokeTest.js) covers the real service.

const crypto = require('crypto');

const clone = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

class DocSnapshot {
  constructor(ref, data) { this.ref = ref; this.id = ref.id; this.exists = data !== undefined; this._data = data; }
  data() { return clone(this._data); }
}

class QuerySnapshot {
  constructor(docs) { this.docs = docs; this.size = docs.length; this.empty = docs.length === 0; }
  forEach(fn) { this.docs.forEach(fn); }
}

class DocRef {
  constructor(store, path) { this._store = store; this.path = path; this.id = path.split('/').pop(); }
  collection(name) { return new Query(this._store, `${this.path}/${name}`); }
  async get() { return new DocSnapshot(this, clone(this._store.get(this.path))); }
  async set(data, opts = {}) {
    const prev = opts.merge ? this._store.get(this.path) || {} : {};
    this._store.set(this.path, clone({ ...prev, ...data }));
  }
  async update(data) {
    if (!this._store.has(this.path)) throw Object.assign(new Error(`No document to update: ${this.path}`), { code: 5 });
    this._store.set(this.path, clone({ ...this._store.get(this.path), ...data }));
  }
  async delete() { this._store.delete(this.path); }
}

class Query {
  constructor(store, path, filters = [], order = null, max = null) {
    this._store = store; this.path = path; this._filters = filters; this._order = order; this._max = max;
  }
  doc(id = crypto.randomUUID().replace(/-/g, '').slice(0, 20)) { return new DocRef(this._store, `${this.path}/${id}`); }
  async add(data) { const ref = this.doc(); await ref.set(data); return ref; }
  where(field, op, value) {
    if (op !== '==') throw new Error(`fakeFirestore: unsupported operator ${op}`);
    return new Query(this._store, this.path, [...this._filters, [field, value]], this._order, this._max);
  }
  orderBy(field, dir = 'asc') { return new Query(this._store, this.path, this._filters, [field, dir], this._max); }
  limit(n) { return new Query(this._store, this.path, this._filters, this._order, n); }
  _matching() {
    const depth = this.path.split('/').length + 1;
    let docs = [...this._store.entries()]
      .filter(([p]) => p.startsWith(this.path + '/') && p.split('/').length === depth)
      .map(([p, data]) => ({ ref: new DocRef(this._store, p), data }))
      .filter(({ data }) => this._filters.every(([f, v]) => data[f] === v));
    if (this._order) {
      const [f, dir] = this._order;
      // Like Firestore, docs missing the order field are excluded.
      docs = docs.filter(d => d.data[f] !== undefined)
        .sort((a, b) => (a.data[f] < b.data[f] ? -1 : a.data[f] > b.data[f] ? 1 : 0) * (dir === 'desc' ? -1 : 1));
    }
    if (this._max != null) docs = docs.slice(0, this._max);
    return docs;
  }
  async get() { return new QuerySnapshot(this._matching().map(({ ref, data }) => new DocSnapshot(ref, clone(data)))); }
  count() { return { get: async () => ({ data: () => ({ count: this._matching().length }) }) }; }
}

class FakeFirestore {
  constructor() { this._store = new Map(); }
  settings() {}
  collection(name) { return new Query(this._store, name); }
  batch() {
    const ops = [];
    return {
      update: (ref, data) => ops.push(() => ref.update(data)),
      set: (ref, data, opts) => ops.push(() => ref.set(data, opts)),
      delete: ref => ops.push(() => ref.delete()),
      commit: async () => { for (const op of ops) await op(); },
    };
  }
  async recursiveDelete(ref) {
    for (const p of [...this._store.keys()]) if (p === ref.path || p.startsWith(ref.path + '/')) this._store.delete(p);
  }
  // Test helper: every stored document path.
  paths() { return [...this._store.keys()]; }
}

module.exports = { FakeFirestore };
