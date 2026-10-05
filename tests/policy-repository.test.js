import test from 'node:test';
import assert from 'node:assert/strict';
import { createPolicyRepository } from '../src/platform/policy-repository.js';
import { DEFAULT_POLICY } from '../src/core/policy.js';
const local = {
  async get() {
    return { policy: DEFAULT_POLICY };
  },
  async set() {},
};
test('malformed installed managed policy never falls back to local', async () => {
  const repo = createPolicyRepository({
    managed: {
      async get() {
        return { policy: 'bad-json' };
      },
    },
    local,
  });
  await assert.rejects(repo.get());
});
test('unsupported managed capability permits development local settings', async () => {
  const repo = createPolicyRepository({ local });
  assert.equal((await repo.get()).locked, false);
  const missing = createPolicyRepository({
    local,
    managed: {
      async get() {
        throw new Error('Managed storage manifest not found');
      },
    },
  });
  assert.equal((await missing.get()).locked, false);
});
test('managed access and corruption failures block local fallback', async () => {
  const repo = createPolicyRepository({
    local,
    managed: {
      async get() {
        throw new Error('storage.managed access denied');
      },
    },
  });
  await assert.rejects(repo.get(), /blocked/);
});
test('unsupported managed policy cannot be overwritten through the public repository', async () => {
  let writes = 0;
  const repo = createPolicyRepository({
    managed: {
      async get() {
        return { policy: JSON.stringify(DEFAULT_POLICY) };
      },
    },
    local: {
      ...local,
      async set() {
        writes++;
      },
    },
  });
  await assert.rejects(repo.save(DEFAULT_POLICY), /managed/);
  assert.equal(writes, 0);
});

function legacyPolicy(overrides = {}) {
  return {
    ...structuredClone(DEFAULT_POLICY),
    sites: [
      {
        host: 'chatgpt.com',
        composer: '#old-editor',
        send: 'button[data-action="send"]',
        response: '.old-answer',
        ...overrides,
      },
    ],
  };
}
test('local legacy migration preserves curated hosts and every detector setting', async () => {
  const original = legacyPolicy();
  original.redactEmails = false;
  original.sensitiveTerms = ['Synthetic Account'];
  let saved = original,
    writes = 0;
  const repo = createPolicyRepository({
    local: {
      async get() {
        return { policy: saved };
      },
      async set(value) {
        saved = value.policy;
        writes++;
      },
    },
  });
  const result = await repo.get();
  assert.equal(result.locked, false);
  assert.deepEqual(result.policy.sites, [{ host: 'chatgpt.com' }]);
  assert.equal(result.policy.redactEmails, false);
  assert.deepEqual(result.policy.sensitiveTerms, original.sensitiveTerms);
  assert.equal(writes, 1);
  assert.ok(Object.hasOwn(original.sites[0], 'composer'), 'migration must not mutate its input');
  await repo.get();
  assert.equal(writes, 1, 'a successfully migrated policy needs no second write');
});
test('managed legacy policies are rejected and perform no local storage reads or writes', async () => {
  let reads = 0,
    writes = 0;
  const repo = createPolicyRepository({
    managed: {
      async get() {
        return { policy: JSON.stringify(legacyPolicy()) };
      },
    },
    local: {
      async get() {
        reads++;
        return {};
      },
      async set() {
        writes++;
      },
    },
  });
  await assert.rejects(
    repo.get(),
    /does not support company-managed policies.*Protection is blocked/,
  );
  assert.equal(reads, 0);
  assert.equal(writes, 0);
});
test('malformed labels and unknown fields remain blocked during migration', async () => {
  for (const invalid of [
    legacyPolicy({ labels: { send: 'Send' } }),
    legacyPolicy({ unknown: true }),
  ]) {
    let writes = 0;
    const localRepo = createPolicyRepository({
      local: {
        async get() {
          return { policy: invalid };
        },
        async set() {
          writes++;
        },
      },
    });
    await assert.rejects(localRepo.get());
    assert.equal(writes, 0);
    const managedRepo = createPolicyRepository({
      managed: {
        async get() {
          return { policy: JSON.stringify(invalid) };
        },
      },
      local,
    });
    await assert.rejects(managedRepo.get());
  }
});
test('a failed local migration write blocks activation instead of returning defaults', async () => {
  const repo = createPolicyRepository({
    local: {
      async get() {
        return { policy: legacyPolicy() };
      },
      async set() {
        throw new Error('Local policy storage is unavailable');
      },
    },
  });
  await assert.rejects(repo.get(), /unavailable/);
});
test('new saves reject CSS selector fields and do not silently migrate submissions', async () => {
  let writes = 0;
  const repo = createPolicyRepository({
    local: {
      ...local,
      async set() {
        writes++;
      },
    },
  });
  await assert.rejects(repo.save(legacyPolicy()), /Unknown site field/);
  assert.equal(writes, 0);
});
test('only absent local settings use defaults; malformed installed settings are blocked', async () => {
  const absent = createPolicyRepository({
    local: {
      async get() {
        return {};
      },
    },
  });
  assert.deepEqual((await absent.get()).policy, DEFAULT_POLICY);
  for (const value of [null, undefined, 'bad-policy', []]) {
    const repo = createPolicyRepository({
      local: {
        async get() {
          return { policy: value };
        },
      },
    });
    await assert.rejects(repo.get());
  }
});
