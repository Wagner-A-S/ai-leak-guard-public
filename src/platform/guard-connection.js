import { EXTENSION_VERSION } from '../core/build-info.js';
import { MAX_SCAN_LENGTH } from '../core/limits.js';

const validTab = (tabId) => Number.isInteger(tabId) && tabId >= 0;
const validHandoff = (id) =>
  typeof id === 'string' && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(id);

const validHost = (host) => {
  if (typeof host !== 'string' || !host || host.length > 253 || host !== host.toLowerCase())
    return false;
  try {
    const parsed = new URL(`https://${host}`);
    return (
      parsed.hostname === host &&
      parsed.host === host &&
      !parsed.username &&
      !parsed.password &&
      parsed.pathname === '/'
    );
  } catch {
    return false;
  }
};
async function withDeadline(operation, timeoutMs, failureMessage) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 60000)
    throw new Error('The guard response deadline is invalid.');
  let timer;
  try {
    return await Promise.race([
      Promise.resolve()
        .then(operation)
        .catch(() => {
          throw new Error(failureMessage);
        }),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('The page guard did not respond.')), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function connectGuard(api, tabId, { timeoutMs = 8000 } = {}) {
  if (!validTab(tabId)) throw new Error('Open the extension from a provider tab.');
  const result = await withDeadline(
    () => api.runtime.sendMessage({ type: 'guard-status', tabId }),
    timeoutMs,
    'The page guard could not connect. Check extension site access, then reconnect.',
  );
  if (result?.ok !== true || result.error)
    throw new Error(
      typeof result?.error === 'string'
        ? result.error
        : 'The page guard is unavailable. Check extension site access.',
    );
  if (result.version !== EXTENSION_VERSION)
    throw new Error('The provider tab has an older guard. Reload that tab, then reconnect.');
  if (result.ready !== true || result.failed !== false || result.configured !== true)
    throw new Error('This tab’s protection policy is not ready or the provider is not configured.');
  if (!validHost(result.host)) throw new Error('The page guard did not identify its provider.');
  return result;
}

export async function importBlockedDraft(api, tabId, handoffId, { timeoutMs = 8000 } = {}) {
  if (!validTab(tabId) || !validHandoff(handoffId))
    throw new Error(
      'The blocked draft transfer is invalid. Open the workspace from the page again.',
    );
  const result = await withDeadline(
    () => api.tabs.sendMessage(tabId, { type: 'take-draft', handoffId }, { frameId: 0 }),
    timeoutMs,
    'The blocked draft could not be retrieved. Open the workspace from the provider page again.',
  );
  if (result?.error)
    throw new Error(
      typeof result.error === 'string'
        ? result.error
        : 'The blocked draft transfer failed. Open it from the page again.',
    );
  if (typeof result?.text !== 'string' || result.text.length > MAX_SCAN_LENGTH)
    throw new Error('The page returned an invalid or oversized draft. Nothing was sent.');
  return result.text;
}
