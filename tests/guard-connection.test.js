import test from 'node:test';
import assert from 'node:assert/strict';
import { connectGuard, importBlockedDraft } from '../src/platform/guard-connection.js';
import { EXTENSION_VERSION } from '../src/core/build-info.js';
import { MAX_SCAN_LENGTH } from '../src/core/limits.js';
import { readFile } from 'node:fs/promises';

const healthy = {
  ok: true,
  version: EXTENSION_VERSION,
  host: 'chatgpt.com',
  ready: true,
  configured: true,
  failed: false,
};
const handoffId = '12345678-1234-1234-1234-123456789abc';

test('guard health identifies the installed version rather than assuming configured means protected', async () => {
  let request;
  const api = {
    runtime: {
      async sendMessage(message) {
        request = message;
        return healthy;
      },
    },
  };
  assert.deepEqual(await connectGuard(api, 17), healthy);
  assert.deepEqual(request, { type: 'guard-status', tabId: 17 });
  const metadata = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(metadata.version, EXTENSION_VERSION);
});

test('absent, stale, unconfigured, loading and failed guards cannot authorize sending', async () => {
  for (const reply of [
    undefined,
    { error: 'Site access withheld.' },
    { ...healthy, version: '0.3.0' },
    { ...healthy, configured: false },
    { ...healthy, ready: false },
    { ...healthy, failed: true },
    { ...healthy, host: '' },
  ]) {
    await assert.rejects(connectGuard({ runtime: { sendMessage: async () => reply } }, 17));
  }
  await assert.rejects(connectGuard({}, -1), /provider tab/);
  await assert.rejects(connectGuard({}, NaN), /provider tab/);
});

test('an unresponsive health probe expires without authorizing sending', async () => {
  await assert.rejects(
    connectGuard({ runtime: { sendMessage: () => new Promise(() => {}) } }, 17, { timeoutMs: 10 }),
    /did not respond/,
  );
});

test('the original blocked draft travels directly from the page guard and preserves multiline Unicode', async () => {
  const text = 'Name: Мария Тестова\nAddress: Примерная улица 11\nEmail: demo@example.com';
  let request;
  const api = {
    tabs: {
      async sendMessage(...args) {
        request = args;
        return { text };
      },
    },
  };
  assert.equal(await importBlockedDraft(api, 17, handoffId), text);
  assert.deepEqual(request, [17, { type: 'take-draft', handoffId }, { frameId: 0 }]);
  assert.ok(!JSON.stringify(request).includes(text));
});

test('invalid or expired draft transfers leave the workspace unmodified', async () => {
  await assert.rejects(importBlockedDraft({}, 17, 'not-a-transfer'), /invalid/);
  await assert.rejects(importBlockedDraft({}, null, handoffId), /invalid/);
  for (const reply of [
    undefined,
    { error: 'This draft transfer expired.' },
    { text: 123 },
    { text: 'x'.repeat(MAX_SCAN_LENGTH + 1) },
  ])
    await assert.rejects(
      importBlockedDraft({ tabs: { sendMessage: async () => reply } }, 17, handoffId),
    );
});

test('truthy readiness values and malformed provider identities cannot authorize a connection', async () => {
  for (const reply of [
    { ...healthy, ok: 'true' },
    { ...healthy, ready: 1 },
    { ...healthy, configured: {} },
    { ...healthy, failed: undefined },
    ...[
      'ChatGPT.com',
      'chatgpt.com/private',
      'chatgpt.com:443',
      'user@chatgpt.com',
      'chatgpt.com?draft=secret',
      'x'.repeat(254),
    ].map((host) => ({ ...healthy, host })),
  ])
    await assert.rejects(connectGuard({ runtime: { sendMessage: async () => reply } }, 17));
});

test('transport failures produce actionable messages without exposing internal error details', async () => {
  for (const sendMessage of [
    () => {
      throw new Error('Private Person browser-internal error');
    },
    async () => {
      throw new Error('Private Person browser-internal error');
    },
  ]) {
    await assert.rejects(connectGuard({ runtime: { sendMessage } }, 17), (error) => {
      assert.match(error.message, /site access.*reconnect/);
      assert.ok(!error.message.includes('Private Person'));
      return true;
    });
    await assert.rejects(importBlockedDraft({ tabs: { sendMessage } }, 17, handoffId), (error) => {
      assert.match(error.message, /workspace.*page again/);
      assert.ok(!error.message.includes('Private Person'));
      return true;
    });
  }
});

test('invalid deadlines reject before sending a message or consuming a one-use draft', async () => {
  let calls = 0;
  const api = {
    runtime: {
      sendMessage() {
        calls++;
      },
    },
    tabs: {
      sendMessage() {
        calls++;
      },
    },
  };
  for (const timeoutMs of [0, -1, Infinity, NaN, '8000', 60001]) {
    await assert.rejects(connectGuard(api, 17, { timeoutMs }), /deadline is invalid/);
    await assert.rejects(
      importBlockedDraft(api, 17, handoffId, { timeoutMs }),
      /deadline is invalid/,
    );
  }
  assert.equal(calls, 0);
});

test('late health and draft replies cannot reverse an expired connection', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const kind of ['health', 'draft']) {
    let reply;
    const operation = new Promise((resolve) => {
      reply = resolve;
    });
    const api = {
      runtime: { sendMessage: () => operation },
      tabs: { sendMessage: () => operation },
    };
    const pending =
      kind === 'health'
        ? connectGuard(api, 17, { timeoutMs: 100 })
        : importBlockedDraft(api, 17, handoffId, { timeoutMs: 100 });
    const rejected = assert.rejects(pending, /did not respond/);
    t.mock.timers.tick(100);
    await rejected;
    reply(kind === 'health' ? healthy : { text: 'Private Person' });
    await Promise.resolve();
    await assert.rejects(pending, /did not respond/);
  }
});
