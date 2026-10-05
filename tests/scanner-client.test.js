import test from 'node:test';
import assert from 'node:assert/strict';
import { ScannerClient } from '../src/platform/scanner-client.js';
const fake = () => ({
  postMessage(m) {
    this.message = m;
  },
  terminate() {
    this.stopped = true;
  },
});
test('worker RPC sends no vault and reset rejects stale operations', async () => {
  const workers = [],
    client = new ScannerClient(() => {
      const worker = fake();
      workers.push(worker);
      return worker;
    });
  const old = client.scan('private', {});
  assert.deepEqual(Object.keys(workers[0].message).sort(), ['id', 'policy', 'text', 'type']);
  client.reset();
  await assert.rejects(old, /cleared/);
  const next = client.scan('new', {});
  workers[0].onmessage({ data: { id: workers[0].message.id, text: 'stale' } });
  workers[1].onmessage({ data: { id: workers[1].message.id, result: { text: 'new' } } });
  assert.equal((await next).result.text, 'new');
  client.dispose();
});
test('timeouts fail closed and future requests reject instead of hanging', async () => {
  const worker = fake(),
    client = new ScannerClient(() => worker, 10);
  await assert.rejects(client.scan('text', {}), /timed out/);
  assert.ok(worker.stopped);
  assert.ok(client.failed);
  await assert.rejects(client.restore('token'), /unavailable/);
  client.dispose();
});
test('worker failures reject outstanding work without leaking message contents', async () => {
  const worker = fake(),
    client = new ScannerClient(() => worker);
  const pending = client.scan('private', {});
  worker.onerror({ message: 'private' });
  await assert.rejects(pending, /scanner failed/);
  client.dispose();
});
