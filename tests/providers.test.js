import test from 'node:test';
import assert from 'node:assert/strict';
import { PROVIDERS, DEFAULT_SITES, providerForHost } from '../src/core/providers.js';
import { DEFAULT_POLICY, validatePolicy } from '../src/core/policy.js';
import { EDITION } from '../src/core/edition.js';

test('catalog provides exactly 30 curated services with explicit host/source/validation scope', () => {
  assert.equal(PROVIDERS.length, 30);
  assert.equal(PROVIDERS.length, EDITION.providerCount);
  assert.equal(new Set(PROVIDERS.map((provider) => provider.id)).size, PROVIDERS.length);
  assert.equal(new Set(DEFAULT_SITES.map((site) => site.host)).size, DEFAULT_SITES.length);
  validatePolicy(DEFAULT_POLICY);
  for (const provider of PROVIDERS) {
    assert.equal(provider.validation, 'controlled-fixture-only');
    assert.ok(provider.hosts.length > 0);
    assert.equal(new URL(provider.source).protocol, 'https:');
    for (const host of provider.hosts) assert.equal(providerForHost(host), provider);
  }
  assert.equal(providerForHost('chatgpt.com.attacker.example'), undefined);
  assert.equal(providerForHost('ai.example.com'), undefined);
});
