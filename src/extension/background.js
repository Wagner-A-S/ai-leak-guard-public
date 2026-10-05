import { getPolicy } from '../platform/policy-repository.js';
import { api } from '../platform/webextension.js';
import { EXTENSION_VERSION } from '../core/build-info.js';

async function restrictStorage() {
  for (const area of [api.storage.local, api.storage.session, api.storage.managed])
    if (typeof area?.setAccessLevel === 'function')
      await area.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
}
const startStorageProtection = () =>
  restrictStorage().then(
    () => true,
    () => false,
  );
let storageReady = startStorageProtection();
async function requireTrustedStorage() {
  for (;;) {
    const current = storageReady;
    if (!(await current)) throw new Error('Trusted storage initialization failed.');
    if (current === storageReady) return;
  }
}
async function trustedPolicy() {
  await requireTrustedStorage();
  const { policy } = await getPolicy();
  await requireTrustedStorage();
  return policy;
}
const validTabId = (id) => Number.isInteger(id) && id >= 0;
const uuid = (value) =>
  typeof value === 'string' && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value);
const hostOf = (url) => {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' ? parsed.hostname.toLowerCase() : null;
  } catch {
    return null;
  }
};
const configured = (policy, host) =>
  Boolean(host && policy.sites.some((site) => site.host === host));
const ACTIVATION_TIMEOUT_MS = 6000;
const PROBE_TIMEOUT_MS = 500;
let policyEpoch = 0;
const activations = new Map();
const unavailable = (error, configured = true) => ({ ok: false, ready: false, configured, error });
const changedPolicy = () => unavailable('Protection settings changed. Reconnect the provider tab.');
class DeadlineExpired extends Error {}
function deadline(milliseconds = ACTIVATION_TIMEOUT_MS) {
  const end = Date.now() + milliseconds;
  return {
    remaining: () => Math.max(0, end - Date.now()),
    async run(operation, limit = Infinity) {
      const wait = Math.min(limit, end - Date.now());
      if (wait <= 0) throw new DeadlineExpired();
      let timer;
      try {
        return await Promise.race([
          Promise.resolve().then(operation),
          new Promise((_, reject) => {
            timer = setTimeout(() => reject(new DeadlineExpired()), wait);
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
async function probe(tabId, budget) {
  try {
    return await budget.run(
      () => api.tabs.sendMessage(tabId, { type: 'guard-status' }, { frameId: 0 }),
      PROBE_TIMEOUT_MS,
    );
  } catch {
    return null;
  }
}
async function invalidateTab(tabId, budget = deadline(PROBE_TIMEOUT_MS)) {
  try {
    await budget.run(
      () => api.tabs.sendMessage(tabId, { type: 'policy-invalidated' }),
      PROBE_TIMEOUT_MS,
    );
  } catch {} // No content script may exist yet; configured tabs are repaired below.
}
function editorView(editor) {
  if (!editor || typeof editor !== 'object' || Array.isArray(editor)) return undefined;
  const allowed = {
    composer: ['ready', 'missing', 'ambiguous'],
    send: ['ready', 'disabled', 'missing', 'ambiguous'],
    attachments: ['selected', 'none'],
  };
  return Object.fromEntries(
    Object.entries(allowed).map(([key, values]) => [
      key,
      values.includes(editor[key]) ? editor[key] : 'unknown',
    ]),
  );
}
async function activateGuard(tabId) {
  const budget = deadline();
  const epoch = policyEpoch;
  const result = (status) => ({ status, epoch });
  try {
    const policy = await budget.run(trustedPolicy);
    const tab = await budget.run(() => api.tabs.get(tabId));
    const host = hostOf(tab.url);
    if (!configured(policy, host))
      return result(unavailable('This HTTPS provider is not configured.', false));
    if (epoch !== policyEpoch) return result(changedPolicy());
    let status = await probe(tabId, budget);
    if (!status || status.version !== EXTENSION_VERSION) {
      if (!api.scripting?.executeScript)
        return result(
          unavailable('Browser guard activation is unavailable. Reopen the provider tab.'),
        );
      try {
        await budget.run(() =>
          api.scripting.executeScript({
            target: { tabId, allFrames: true },
            files: ['content.bundle.js'],
          }),
        );
      } catch (error) {
        if (error instanceof DeadlineExpired) throw error;
        return result(
          unavailable(
            'Browser permission prevented guard activation. Allow site access and try again.',
          ),
        );
      }
    } else if (!status.configured || status.failed) await invalidateTab(tabId, budget);
    while (budget.remaining()) {
      if (epoch !== policyEpoch) return result(changedPolicy());
      if (
        status?.ok === true &&
        status.version === EXTENSION_VERSION &&
        status.ready === true &&
        status.configured === true &&
        status.failed === false &&
        status.host === host
      ) {
        // A live listener alone is insufficient: verify settings and navigation
        // again after the asynchronous probe, immediately before authorizing UI.
        const freshPolicy = await budget.run(trustedPolicy);
        const freshTab = await budget.run(() => api.tabs.get(tabId));
        if (epoch !== policyEpoch || JSON.stringify(freshPolicy) !== JSON.stringify(policy)) {
          await invalidateTab(tabId, budget);
          return result(changedPolicy());
        }
        if (freshTab.url !== tab.url || freshTab.pendingUrl)
          return result(
            unavailable('The provider tab navigated. Wait for it to finish, then reconnect.'),
          );
        const editor = editorView(status.editor);
        return result({
          ok: true,
          version: EXTENSION_VERSION,
          ready: true,
          configured: true,
          failed: false,
          host,
          ...(editor ? { editor } : {}),
        });
      }
      await budget.run(() => delay(100));
      status = await probe(tabId, budget);
    }
  } catch (error) {
    if (!(error instanceof DeadlineExpired))
      return result(
        unavailable(
          'Protection settings or the provider tab are unavailable. Reconnect and check site access.',
        ),
      );
  }
  return result(
    unavailable(
      'The page guard did not become ready in time. Check extension site access, then reconnect.',
    ),
  );
}
function ensureGuard(tabId) {
  // Share work across startup, toolbar and simultaneous workspace requests.
  // No healthy result is cached; the next request always checks live settings.
  const current = activations.get(tabId);
  if (current) return current;
  const operation = activateGuard(tabId).finally(() => {
    if (activations.get(tabId) === operation) activations.delete(tabId);
  });
  activations.set(tabId, operation);
  return operation;
}
async function activateOpenTabs(invalidate = false) {
  const budget = deadline();
  const tabs = await budget.run(() => api.tabs.query({ url: 'https://*/*' }));
  const targets = tabs.filter((tab) => validTabId(tab.id) && hostOf(tab.url));
  // Invalidate before reading settings: a failed or stalled managed-policy read
  // must not leave existing content guards using the previous configuration.
  if (invalidate)
    await budget.run(() => Promise.allSettled(targets.map((tab) => invalidateTab(tab.id, budget))));
  let policy;
  try {
    policy = await budget.run(trustedPolicy);
  } catch {}
  if (policy)
    await budget.run(() =>
      Promise.allSettled(
        targets
          .filter((tab) => configured(policy, hostOf(tab.url)))
          .map((tab) => ensureGuard(tab.id)),
      ),
    );
}
const activate = () => {
  policyEpoch++;
  storageReady = startStorageProtection();
  return activateOpenTabs().catch(() => {});
};
api.runtime.onInstalled.addListener(activate);
api.runtime.onStartup?.addListener(activate);
api.storage.onChanged.addListener((changes, area) => {
  if ((area === 'local' || area === 'managed') && Object.hasOwn(changes, 'policy')) {
    policyEpoch++;
    return activateOpenTabs(true).catch(() => {});
  }
});

async function focusWorkspace(tabId) {
  if (
    typeof api.runtime.sendMessage !== 'function' ||
    typeof api.tabs.update !== 'function' ||
    typeof api.windows?.update !== 'function'
  )
    return false;
  try {
    // Extension pages answer live, so worker restarts do not lose their private
    // session. Discovery carries browser identities only, never draft or vault data.
    const existing = await deadline(PROBE_TIMEOUT_MS).run(() =>
      api.runtime.sendMessage({ type: 'locate-workspace', tabId }),
    );
    if (
      existing?.tabId !== tabId ||
      !validTabId(existing.workspaceTabId) ||
      existing.workspaceTabId === tabId ||
      !validTabId(existing.windowId)
    )
      return false;
    const budget = deadline(ACTIVATION_TIMEOUT_MS);
    await budget.run(() => api.tabs.update(existing.workspaceTabId, { active: true }));
    await budget.run(() => api.windows.update(existing.windowId, { focused: true }));
    return true;
  } catch {
    return false; // Closed pages and unavailable APIs fall back to a fresh workspace.
  }
}
async function openWorkspace(tab, handoffId, reuse = false) {
  if (!validTabId(tab?.id)) return;
  // Repair pre-existing tabs before opening the UI; the UI verifies health again.
  try {
    await ensureGuard(tab.id);
  } catch {}
  if (reuse && (await focusWorkspace(tab.id))) return;
  const query = new URLSearchParams({ tab: String(tab.id) });
  if (handoffId) query.set('draft', handoffId.toLowerCase());
  const url = api.runtime.getURL(`src/ui/workspace.html?${query}`);
  try {
    if (!api.windows?.create) throw new Error('Separate extension windows are unavailable.');
    await api.windows.create({ url, type: 'popup', width: 1180, height: 850 });
  } catch {
    await api.tabs.create({ url });
  }
}
const toolbarWorkspaces = new Map();
api.action.onClicked.addListener((tab) => {
  if (!validTabId(tab?.id)) return;
  const current = toolbarWorkspaces.get(tab.id);
  if (current) return current;
  const operation = openWorkspace(tab, undefined, true).finally(() => {
    if (toolbarWorkspaces.get(tab.id) === operation) toolbarWorkspaces.delete(tab.id);
  });
  toolbarWorkspaces.set(tab.id, operation);
  return operation;
});
function requestingHost(sender) {
  return sender?.id === api.runtime.id && validTabId(sender.tab?.id) ? hostOf(sender.url) : null;
}
function trustedWorkspace(sender) {
  if (sender?.id !== api.runtime.id || typeof sender.url !== 'string') return false;
  try {
    const url = new URL(sender.url);
    url.search = '';
    url.hash = '';
    return url.href === api.runtime.getURL('src/ui/workspace.html');
  } catch {
    return false;
  }
}
function contentPolicy(policy, host) {
  const site = policy.sites.find((entry) => entry.host === host);
  return {
    sites: site ? [{ host: site.host, ...(site.labels ? { labels: site.labels } : {}) }] : [],
  };
}
const respond = (reply, result) => {
  try {
    reply(result);
  } catch {}
};
api.runtime.onMessage.addListener((message, sender, reply) => {
  if (message?.type === 'guard-status') {
    if (!trustedWorkspace(sender) || !validTabId(message.tabId)) {
      respond(reply, { error: 'Only the private workspace can check a provider guard.' });
      return;
    }
    void (async () => {
      try {
        const result = await ensureGuard(message.tabId);
        respond(reply, result.epoch === policyEpoch ? result.status : changedPolicy());
      } catch {
        respond(reply, {
          ok: false,
          ready: false,
          error: 'Protection policy or provider tab unavailable.',
        });
      }
    })();
    return true;
  }
  if (message?.type === 'open-workspace') {
    const host = requestingHost(sender);
    if (
      !host ||
      (message.handoffId !== undefined &&
        (!uuid(message.handoffId) || (sender.frameId !== undefined && sender.frameId !== 0)))
    ) {
      respond(reply, { error: 'Untrusted or invalid private draft request.' });
      return;
    }
    void (async () => {
      try {
        const policy = await deadline().run(trustedPolicy);
        if (!configured(policy, host)) throw new Error('Unconfigured site.');
        await openWorkspace(sender.tab, message.handoffId);
        respond(reply, { ok: true });
      } catch {
        respond(reply, { error: 'Workspace unavailable. Use the extension toolbar.' });
      }
    })();
    return true;
  }
  if (message?.type !== 'policy') return;
  const host = requestingHost(sender);
  if (!host) {
    respond(reply, {
      error: 'Only this extension’s HTTPS content guards can request a site policy.',
    });
    return;
  }
  void (async () => {
    try {
      respond(reply, { policy: contentPolicy(await deadline().run(trustedPolicy), host) });
    } catch {
      respond(reply, {
        error: 'Policy or trusted storage unavailable. Protection is blocking this page.',
      });
    }
  })();
  return true;
});
