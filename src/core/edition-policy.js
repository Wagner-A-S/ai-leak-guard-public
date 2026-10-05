import { EDITION } from './edition.js';
import { DEFAULT_SITES } from './providers.js';
import { validatePolicy } from './policy.js';

const curatedHosts = new Set(DEFAULT_SITES.map(({ host }) => host));

// Keep generic policy validation reusable for scanner previews and fixtures.
// Browser storage must additionally enforce immutable edition capabilities.
export function validateEditionPolicy(policy) {
  validatePolicy(policy);
  if (!EDITION.customSites) {
    for (const site of policy.sites) {
      if (!curatedHosts.has(site.host))
        throw new Error(
          'AI Leak Guard Public supports curated provider sites only. Install AI Leak Guard Corporate to configure custom sites. Protection is blocked.',
        );
      if (Object.hasOwn(site, 'labels'))
        throw new Error(
          'AI Leak Guard Public does not support custom site labels. Install AI Leak Guard Corporate to configure site labels. Protection is blocked.',
        );
    }
  }
  return policy;
}
