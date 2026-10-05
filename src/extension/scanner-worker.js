import { RedactionSession } from '../core/redaction-session.js';
const createSession = () => new RedactionSession(crypto.randomUUID().replaceAll('-', ''));
let session = createSession();
self.onmessage = ({ data }) => {
  try {
    if (data.type === 'scan') {
      const result = session.scan(data.text, data.policy);
      // Send classification metadata, not original values or the restoration map.
      const findings = result.findings.map(({ value, ...finding }) => finding);
      self.postMessage({ id: data.id, result: { ...result, findings } });
    } else if (data.type === 'restore')
      self.postMessage({ id: data.id, text: session.restore(data.text) });
    else throw new Error('Unsupported scanner operation.');
  } catch (error) {
    self.postMessage({ id: data.id, error: error.message });
  }
};
