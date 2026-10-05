import { redact, restore, restoreResponse } from './redaction.js';
// Originals never leave this object. A new session requires a new nonce.
export class RedactionSession {
  #vault = Object.create(null);
  #nonce;
  #disposed = false;
  constructor(nonce) {
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(nonce))
      throw new Error('Invalid private session identifier.');
    this.#nonce = nonce;
  }
  #check() {
    if (this.#disposed) throw new Error('Private session has ended.');
  }
  scan(text, policy) {
    this.#check();
    return redact(text, policy, this.#vault, this.#nonce);
  }
  restore(text) {
    this.#check();
    return restore(text, this.#vault);
  }
  restoreResponse(text) {
    this.#check();
    return restoreResponse(text, this.#vault);
  }
  dispose() {
    this.#vault = Object.create(null);
    this.#disposed = true;
  }
}
