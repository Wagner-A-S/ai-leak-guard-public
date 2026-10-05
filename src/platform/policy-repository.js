import { api } from './webextension.js';
import { DEFAULT_POLICY } from '../core/policy.js';
import { validateEditionPolicy } from '../core/edition-policy.js';
import { EDITION } from '../core/edition.js';
// Only exact known absence errors can fall back. Access/corruption errors block.
const absentManaged =
  /^(?:Managed storage manifest not found|No managed storage manifest found|Managed storage is not available|Managed storage is not supported)\.?$/i;

const legacySelectorKeys = ['composer', 'send', 'response'];
function migrateStoredPolicy(policy) {
  if (!policy || typeof policy !== 'object' || !Array.isArray(policy.sites))
    return { policy, migrated: false };
  let migrated = false;
  const sites = policy.sites.map((site) => {
    if (!site || typeof site !== 'object' || Array.isArray(site)) return site;
    if (!legacySelectorKeys.some((key) => Object.hasOwn(site, key))) return site;
    const next = { ...site };
    for (const key of legacySelectorKeys) delete next[key];
    migrated = true;
    return next;
  });
  // Keep unknown keys and malformed values visible to strict validation. Only
  // the obsolete CSS selector fields are discarded, never policy protections.
  return { policy: migrated ? { ...policy, sites } : policy, migrated };
}

export function createPolicyRepository(storage) {
  return {
    async get() {
      let managed = {};
      if (storage.managed?.get)
        try {
          managed = await storage.managed.get('policy');
        } catch (error) {
          if (!absentManaged.test(error.message))
            throw new Error('Managed policy unavailable. Protection is blocked.');
        }
      if (Object.hasOwn(managed, 'policy')) {
        if (!EDITION.managedPolicies)
          throw new Error(
            'AI Leak Guard Public does not support company-managed policies. Install AI Leak Guard Corporate. Protection is blocked.',
          );
        const { policy } = migrateStoredPolicy(JSON.parse(managed.policy));
        // Managed legacy policies migrate in memory and stay locked. Browser
        // discovery uses hosts and literal labels; CSS is never retained/run.
        return { policy: validateEditionPolicy(policy), locked: true };
      }
      const local = await storage.local.get('policy');
      const { policy, migrated } = migrateStoredPolicy(
        Object.hasOwn(local, 'policy') ? local.policy : structuredClone(DEFAULT_POLICY),
      );
      validateEditionPolicy(policy);
      // Persist local migration only after complete validation. Any read/write
      // failure still rejects activation rather than falling back to defaults.
      if (migrated) await storage.local.set({ policy });
      return {
        policy,
        locked: false,
      };
    },
    async save(policy) {
      const state = await this.get();
      if (state.locked) throw new Error('Enterprise policy is managed and cannot be edited here.');
      validateEditionPolicy(policy);
      await storage.local.set({ policy });
    },
  };
}
const repository = createPolicyRepository(api.storage);
export const getPolicy = () => repository.get();
export const savePolicy = (policy) => repository.save(policy);
