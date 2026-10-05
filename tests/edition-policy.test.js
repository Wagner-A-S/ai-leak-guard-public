import test from 'node:test';
import assert from 'node:assert/strict';
import { EDITION } from '../src/core/edition.js';
import { DEFAULT_POLICY, validatePolicy } from '../src/core/policy.js';
import { validateEditionPolicy } from '../src/core/edition-policy.js';
import { createPolicyRepository } from '../src/platform/policy-repository.js';

const configured = (sites) => ({ ...structuredClone(DEFAULT_POLICY), sites });

test('edition metadata is immutable and identifies this package', () => {
  assert.deepEqual(EDITION, {
    slug: 'ai-leak-guard-public',
    title: 'AI Leak Guard Public',
    managedPolicies: false,
    customSites: false,
    providerCount: 30,
  });
  assert.ok(Object.isFrozen(EDITION));
  assert.throws(() => {
    EDITION.customSites = !EDITION.customSites;
  }, TypeError);
});

test('edition policy accepts personal detector settings and a curated host subset', () => {
  const policy = configured([{ host: 'chatgpt.com' }, { host: 'claude.ai' }]);
  policy.defaultCountry = 'DE';
  policy.redactNetwork = true;
  policy.enabledRuleIds = ['email.standard'];
  policy.sensitiveTerms = ['Synthetic customer'];
  policy.blockTerms = ['Synthetic private project'];
  assert.equal(validateEditionPolicy(policy), policy);
});

test('generic policy validation remains independent from edition restrictions', () => {
  const policy = configured([{ host: 'ai.example.com', labels: { send: ['Send'] } }]);
  assert.equal(validatePolicy(policy), policy);
  if (EDITION.customSites) assert.equal(validateEditionPolicy(policy), policy);
  else assert.throws(() => validateEditionPolicy(policy), /curated provider sites only/);
});

test('both stored and submitted browser policies enforce edition host and label capabilities', async () => {
  for (const site of [
    { host: 'ai.example.com' },
    { host: 'chatgpt.com.attacker.example' },
    { host: 'chatgpt.com', labels: { send: ['Custom submit label'] } },
  ]) {
    const policy = configured([site]);
    let writes = 0;
    const storedRepository = createPolicyRepository({
      local: {
        async get() {
          return { policy };
        },
        async set() {
          writes++;
        },
      },
    });
    const submittedRepository = createPolicyRepository({
      local: {
        async get() {
          return { policy: DEFAULT_POLICY };
        },
        async set() {
          writes++;
        },
      },
    });
    if (EDITION.customSites) {
      assert.deepEqual((await storedRepository.get()).policy, policy);
      await submittedRepository.save(policy);
      assert.equal(writes, 1);
    } else {
      await assert.rejects(storedRepository.get(), /Protection is blocked/);
      await assert.rejects(submittedRepository.save(policy), /Protection is blocked/);
      assert.equal(writes, 0);
    }
  }
});

test('an installed managed policy is either enforced as locked or clearly rejected without local fallback', async () => {
  let localReads = 0;
  const policy = configured([{ host: 'chatgpt.com' }]);
  const repository = createPolicyRepository({
    managed: {
      async get() {
        return { policy: JSON.stringify(policy) };
      },
    },
    local: {
      async get() {
        localReads++;
        return { policy: DEFAULT_POLICY };
      },
      async set() {},
    },
  });
  if (EDITION.managedPolicies) {
    const state = await repository.get();
    assert.equal(state.locked, true);
    assert.deepEqual(state.policy, policy);
  } else {
    await assert.rejects(
      repository.get(),
      /does not support company-managed policies.*Protection is blocked/,
    );
  }
  assert.equal(localReads, 0);
});
