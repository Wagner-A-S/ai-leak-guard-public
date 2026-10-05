// An RPC boundary with bounded waiting. Failed workers stay closed until reset.
export class ScannerClient {
  #worker;
  #factory;
  #pending = new Map();
  #nextId = 0;
  #failed = false;
  #timeout;
  constructor(factory, timeoutMs = 15000) {
    this.#factory = factory;
    this.#timeout = timeoutMs;
    this.#start();
  }
  get failed() {
    return this.#failed;
  }
  #start() {
    this.#worker = this.#factory();
    this.#failed = false;
    this.#worker.onmessage = ({ data }) => {
      const p = this.#pending.get(data.id);
      if (!p) return;
      this.#pending.delete(data.id);
      clearTimeout(p.timer);
      data.error ? p.reject(new Error(data.error)) : p.resolve(data);
    };
    this.#worker.onerror = () => this.#fail('Local scanner failed. Clear the session to restart.');
  }
  #fail(message) {
    this.#failed = true;
    this.#worker.terminate();
    for (const p of this.#pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error(message));
    }
    this.#pending.clear();
  }
  request(type, payload) {
    if (this.#failed)
      return Promise.reject(new Error('Local scanner unavailable. Clear the session to restart.'));
    const id = ++this.#nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => this.#fail('Local scan timed out. Split the text and clear the session to restart.'),
        this.#timeout,
      );
      this.#pending.set(id, { resolve, reject, timer });
      try {
        this.#worker.postMessage({ id, type, ...payload });
      } catch {
        this.#fail('Local scanner unavailable. Clear the session to restart.');
      }
    });
  }
  scan(text, policy) {
    return this.request('scan', { text, policy });
  }
  restore(text) {
    return this.request('restore', { text });
  }
  reset() {
    this.#fail('Private session cleared.');
    this.#start();
  }
  dispose() {
    this.#fail('Private session ended.');
  }
}
