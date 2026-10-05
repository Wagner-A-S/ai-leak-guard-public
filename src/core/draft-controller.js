import { MAX_SCAN_LENGTH } from './limits.js';
const fingerprint = (policy) => JSON.stringify(policy);
// Review/send authorization is independent of DOM, storage, and browser APIs.
export class DraftController {
  #epoch = 0;
  #policy = null;
  #review = null;
  #sending = false;
  get policy() {
    return this.#policy;
  }
  get sending() {
    return this.#sending;
  }
  get reviewedText() {
    return this.#review?.text ?? null;
  }
  invalidate() {
    this.#epoch++;
    this.#review = null;
  }
  setPolicy(policy) {
    this.invalidate();
    this.#policy = policy ? structuredClone(policy) : null;
  }
  ticket() {
    return { epoch: this.#epoch, policy: fingerprint(this.#policy) };
  }
  current(ticket) {
    return (
      !!this.#policy && ticket.epoch === this.#epoch && ticket.policy === fingerprint(this.#policy)
    );
  }
  acceptReview(ticket, result) {
    if (!this.current(ticket) || result.blocked) return false;
    if (typeof result.text !== 'string' || !result.text.trim()) return false;
    if (result.text.length > MAX_SCAN_LENGTH)
      throw new Error(
        'Redaction expanded this message beyond the sending limit. Split it into smaller parts.',
      );
    this.#review = { text: result.text, ticket };
    return true;
  }
  async send({ readPolicy, resolveTarget, dispatch }) {
    if (this.#sending) throw new Error('A send is already in progress.');
    if (!this.#review) throw new Error('Check & redact this draft before sending.');
    const review = this.#review;
    this.#sending = true;
    const check = () => {
      if (!this.current(review.ticket))
        throw new Error('Draft or policy changed. Check & redact again.');
    };
    const verifyPolicy = async () => {
      let policy;
      try {
        policy = await readPolicy();
      } catch (error) {
        this.setPolicy(null);
        throw error;
      }
      check();
      if (fingerprint(policy) !== review.ticket.policy) {
        this.setPolicy(policy);
        throw new Error('Policy changed. Check & redact again.');
      }
    };
    try {
      await verifyPolicy();
      check();
      const target = await resolveTarget();
      check();
      const host = new URL(target.url).hostname;
      if (!this.#policy.sites.some((site) => site.host === host))
        throw new Error('This provider is not configured in the current policy.');
      await verifyPolicy();
      check();
      const result = await dispatch(review.text);
      if (!result || result.error)
        throw new Error(result?.error || 'No protection adapter replied. Reload the provider tab.');
      check();
      this.invalidate();
      return result;
    } catch (error) {
      this.invalidate();
      throw error;
    } finally {
      this.#sending = false;
    }
  }
}
