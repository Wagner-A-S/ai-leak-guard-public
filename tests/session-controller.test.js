import test from 'node:test';
import assert from 'node:assert/strict';
import { RedactionSession } from '../src/core/redaction-session.js';
import { DraftController } from '../src/core/draft-controller.js';
import { DEFAULT_POLICY } from '../src/core/policy.js';
const policy = structuredClone(DEFAULT_POLICY);
const reviewed = () => {
  const c = new DraftController();
  c.setPolicy(policy);
  assert.ok(c.acceptReview(c.ticket(), { blocked: false, text: 'sanitized draft' }));
  return c;
};
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
};
test('fresh private sessions cannot restore old placeholders to new private values', () => {
  const old = new RedactionSession('session-aaaaaaaa');
  const token = old.scan('alice@example.com', policy).text;
  old.dispose();
  assert.throws(() => old.restore(token), /ended/);
  const fresh = new RedactionSession('session-bbbbbbbb');
  const newToken = fresh.scan('bob@example.com', policy).text;
  assert.notEqual(token, newToken);
  assert.equal(fresh.restore(token), token);
  assert.equal(fresh.restore(newToken), 'bob@example.com');
});
test('editing or clearing while policy lookup is pending cancels before dispatch', async () => {
  const c = reviewed(),
    gate = deferred();
  let calls = 0;
  const sending = c.send({
    readPolicy: () => gate.promise,
    resolveTarget: async () => ({ url: 'https://chatgpt.com' }),
    dispatch: async () => {
      calls++;
      return { ok: true };
    },
  });
  c.invalidate();
  gate.resolve(policy);
  await assert.rejects(sending, /changed/);
  assert.equal(calls, 0);
  assert.equal(c.reviewedText, null);
});
test('editing while browser tab lookup is pending cancels before dispatch', async () => {
  const c = reviewed(),
    gate = deferred();
  let calls = 0;
  const sending = c.send({
    readPolicy: async () => policy,
    resolveTarget: () => gate.promise,
    dispatch: async () => {
      calls++;
      return { ok: true };
    },
  });
  await new Promise((r) => setImmediate(r));
  c.invalidate();
  gate.resolve({ url: 'https://chatgpt.com' });
  await assert.rejects(sending, /changed/);
  assert.equal(calls, 0);
});
test('policy changes between target lookup and final dispatch require review again', async () => {
  const c = reviewed();
  let reads = 0,
    calls = 0;
  await assert.rejects(
    c.send({
      readPolicy: async () => (++reads === 1 ? policy : { ...policy, blockTerms: ['new policy'] }),
      resolveTarget: async () => ({ url: 'https://chatgpt.com' }),
      dispatch: async () => {
        calls++;
        return { ok: true };
      },
    }),
    /Policy changed/,
  );
  assert.equal(calls, 0);
});
test('policy access failures clear the old authorization and block review', async () => {
  const c = reviewed();
  await assert.rejects(
    c.send({
      readPolicy: async () => {
        throw new Error('managed unavailable');
      },
      resolveTarget: async () => ({}),
      dispatch: async () => ({ ok: true }),
    }),
    /managed unavailable/,
  );
  assert.equal(c.policy, null);
  assert.equal(c.acceptReview(c.ticket(), { text: 'old' }), false);
});
test('concurrent sends are rejected and a successful review can send only once', async () => {
  const c = reviewed(),
    gate = deferred(),
    deps = {
      readPolicy: async () => policy,
      resolveTarget: async () => ({ url: 'https://chatgpt.com' }),
      dispatch: () => gate.promise,
    };
  const first = c.send(deps);
  await assert.rejects(c.send(deps), /progress/);
  gate.resolve({ ok: true });
  await first;
  await assert.rejects(c.send(deps), /Check/);
});
test('unconfigured target navigation cannot receive a reviewed prompt', async () => {
  const c = reviewed();
  let sent = false;
  await assert.rejects(
    c.send({
      readPolicy: async () => policy,
      resolveTarget: async () => ({ url: 'https://other.example' }),
      dispatch: async () => {
        sent = true;
        return { ok: true };
      },
    }),
    /not configured/,
  );
  assert.equal(sent, false);
});
