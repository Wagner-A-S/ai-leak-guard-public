import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { EXTENSION_VERSION } from '../src/core/build-info.js';

const source = readFileSync(
  new URL('../src/extension/background.js', import.meta.url),
  'utf8',
).replace(/^import .*;\n/gm, '');
const policy = {
  sites: [
    {
      host: 'chatgpt.com',
      labels: { composer: ['Message'], send: ['Send message'], response: ['Assistant response'] },
      internalNote: 'confidential',
    },
    {
      host: 'claude.ai',
      labels: { composer: ['Message Claude'] },
    },
  ],
  sensitiveTerms: ['Private Person'],
  blockTerms: ['Internal Launch Plan'],
  redactSecrets: true,
};
function deferred() {
  let resolve, reject;
  const promise = new Promise((success, failure) => {
    resolve = success;
    reject = failure;
  });
  return { promise, resolve, reject };
}
function harness({
  storageGate,
  policyGate,
  storageError = false,
  noAccessLevel = false,
  policyError = false,
  popupError = false,
  noWindows = false,
  openTabs = [],
  probeMissing = false,
  injectionError = false,
  guardFailed = false,
  workspaceResult,
  workspaceGate,
  workspaceFocusError = false,
} = {}) {
  const listeners = {},
    storageCalls = [],
    windows = [],
    tabs = [],
    messages = [],
    injections = [],
    runtimeMessages = [],
    tabUpdates = [],
    windowUpdates = [];
  const installedGuards = new Set();
  let activePolicy = policy;
  const readStarted = deferred();
  let reads = 0;
  const event = (name) => ({
    addListener(callback) {
      listeners[name] = callback;
    },
  });
  const area = (name) =>
    noAccessLevel
      ? {}
      : {
          async setAccessLevel(options) {
            storageCalls.push({ name, options });
            if (storageGate) await storageGate.promise;
            if (storageError === true || storageError === name)
              throw new Error('Sensitive operating-system error');
          },
        };
  const api = {
    storage: {
      local: area('local'),
      session: area('session'),
      managed: area('managed'),
      onChanged: event('storage'),
    },
    runtime: {
      id: 'guard',
      onMessage: event('message'),
      onInstalled: event('installed'),
      onStartup: event('startup'),
      getURL(path) {
        return `chrome-extension://guard/${path}`;
      },
      async sendMessage(message) {
        runtimeMessages.push(message);
        if (workspaceGate) return workspaceGate.promise;
        return workspaceResult;
      },
    },
    action: { onClicked: event('action') },
    tabs: {
      async query() {
        return openTabs;
      },
      async get(id) {
        return openTabs.find((tab) => tab.id === id) || { id, url: 'https://chatgpt.com/' };
      },
      async sendMessage(id, message, options) {
        messages.push({ id, message, options });
        if (message.type === 'policy-invalidated') return { ok: true };
        if (probeMissing && !installedGuards.has(id)) throw new Error('No receiving end.');
        const tab = await api.tabs.get(id);
        return {
          ok: true,
          version: EXTENSION_VERSION,
          host: new URL(tab.url).hostname,
          ready: true,
          configured: true,
          failed: guardFailed,
        };
      },
      async create(options) {
        tabs.push(options);
      },
      async update(id, options) {
        tabUpdates.push({ id, options });
        if (workspaceFocusError) throw new Error('The workspace tab has closed.');
      },
    },
    scripting: {
      async executeScript(options) {
        injections.push(options);
        if (injectionError) throw new Error('Permission denied');
        installedGuards.add(options.target.tabId);
      },
    },
    windows: noWindows
      ? undefined
      : {
          async create(options) {
            windows.push(options);
            if (popupError) throw new Error('Popup unavailable');
          },
          async update(id, options) {
            windowUpdates.push({ id, options });
          },
        },
  };
  const getPolicy = async () => {
    reads++;
    readStarted.resolve();
    if (policyGate) await policyGate.promise;
    if (policyError) throw new Error('Invalid managed policy containing Private Person');
    return { policy: activePolicy };
  };
  vm.runInNewContext(source, {
    api,
    getPolicy,
    URL,
    URLSearchParams,
    EXTENSION_VERSION,
    Date,
    setTimeout,
    clearTimeout,
  });
  const sender = {
    id: api.runtime.id,
    url: 'https://chatgpt.com/conversation/123',
    tab: { id: 27 },
  };
  return {
    api,
    listeners,
    sender,
    storageCalls,
    windows,
    tabs,
    messages,
    injections,
    runtimeMessages,
    tabUpdates,
    windowUpdates,
    set policy(value) {
      activePolicy = value;
    },
    policyRead: readStarted.promise,
    get reads() {
      return reads;
    },
    set storageError(value) {
      storageError = value;
    },
    request(from = sender) {
      return new Promise((resolve) => {
        listeners.message({ type: 'policy' }, from, resolve);
      });
    },
    message(message, from = sender) {
      return new Promise((resolve) => listeners.message(message, from, resolve));
    },
    async settle() {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    },
  };
}

test('content policy exposes only the requesting host adapter, without private literals or rules', async () => {
  const h = harness();
  const result = await h.request();
  assert.equal(result.policy.sites.length, 1);
  assert.equal(result.policy.sites[0].host, 'chatgpt.com');
  assert.deepEqual(Object.keys(result.policy), ['sites']);
  assert.deepEqual(Object.keys(result.policy.sites[0]), ['host', 'labels']);
  assert.ok(!JSON.stringify(result).includes('Private Person'));
  assert.ok(!JSON.stringify(result).includes('Internal Launch Plan'));
  assert.ok(!JSON.stringify(result).includes('claude.ai'));
  assert.ok(!JSON.stringify(result).includes('confidential'));
});

test('unconfigured hosts receive an empty adapter view', async () => {
  const h = harness();
  for (const host of ['example.com', 'chatgpt.com.example.com', 'sub.chatgpt.com']) {
    const result = await h.request({ ...h.sender, url: `https://${host}/` });
    assert.equal(result.policy.sites.length, 0);
  }
});

test('configured iframe origin is selected using sender URL rather than parent tab URL', async () => {
  const h = harness();
  const result = await h.request({
    ...h.sender,
    url: 'https://claude.ai/frame',
    tab: { id: 27, url: 'https://example.com/' },
    frameId: 4,
  });
  assert.equal(result.policy.sites[0].host, 'claude.ai');
});

test('policy reads wait for local, session and managed storage protection', async () => {
  const gate = deferred(),
    h = harness({ storageGate: gate });
  const reply = h.request();
  await h.settle();
  assert.equal(h.reads, 0);
  assert.equal(h.storageCalls.length, 1);
  gate.resolve();
  assert.ok((await reply).policy);
  assert.equal(h.storageCalls.length, 3);
  assert.deepEqual(
    h.storageCalls.map((call) => call.name),
    ['local', 'session', 'managed'],
  );
  assert.ok(h.storageCalls.every((call) => call.options.accessLevel === 'TRUSTED_CONTEXTS'));
});

test('an available storage-hardening API failure blocks policy without reading private settings', async () => {
  for (const storageError of ['local', 'session', 'managed']) {
    const h = harness({ storageError });
    const result = await h.request();
    assert.match(result.error, /Protection is blocking/);
    assert.equal(h.reads, 0);
    assert.ok(!JSON.stringify(result).includes('Sensitive operating-system error'));
  }
});

test('browsers without access-level capability can obtain their own minimal policy', async () => {
  const h = harness({ noAccessLevel: true });
  assert.equal((await h.request()).policy.sites[0].host, 'chatgpt.com');
  assert.equal(h.storageCalls.length, 0);
});

test('invalid managed policy fails closed and does not echo private error details', async () => {
  const h = harness({ policyError: true });
  const result = await h.request();
  assert.match(result.error, /Protection is blocking/);
  assert.ok(!JSON.stringify(result).includes('Private Person'));
});

test('policy broker requires own-extension HTTPS content sender with a real tab', async () => {
  const h = harness();
  const impostors = [
    {},
    { ...h.sender, id: 'other-extension' },
    { ...h.sender, tab: undefined },
    { ...h.sender, tab: { id: -1 } },
    { ...h.sender, tab: { id: '27' } },
    { ...h.sender, url: 'chrome-extension://guard/src/ui/admin.html' },
    { ...h.sender, url: 'http://chatgpt.com/' },
    { ...h.sender, url: 'invalid URL' },
  ];
  for (const sender of impostors)
    assert.match((await h.request(sender)).error, /Only this extension/);
  assert.equal(h.reads, 0);
});

test('unknown and malformed messages are ignored', () => {
  const h = harness();
  let replied = false;
  for (const message of [undefined, null, {}, { type: 'send-sanitized' }]) {
    assert.equal(
      h.listeners.message(message, h.sender, () => {
        replied = true;
      }),
      undefined,
    );
  }
  assert.equal(replied, false);
});

test('installation and browser startup reapply storage protection before further replies', async () => {
  const h = harness();
  await h.request();
  assert.equal(h.storageCalls.length, 3);
  for (const event of ['installed', 'startup']) {
    h.listeners[event]();
    await h.request();
  }
  assert.equal(h.storageCalls.length, 9);
});

test('storage protection failure during a policy read blocks the pending content reply', async () => {
  const gate = deferred(),
    h = harness({ policyGate: gate });
  const response = h.request();
  await h.policyRead;
  assert.equal(h.reads, 1);
  h.storageError = true;
  h.listeners.startup();
  gate.resolve();
  assert.match((await response).error, /Protection is blocking/);
});

test('extension action opens trusted workspace associated with the active tab', async () => {
  const h = harness();
  await h.listeners.action({ id: 27 });
  assert.equal(h.windows.length, 1);
  assert.equal(h.windows[0].url, 'chrome-extension://guard/src/ui/workspace.html?tab=27');
  assert.equal(h.windows[0].type, 'popup');
  assert.equal(h.tabs.length, 0);
});

test('unavailable or failing popup support falls back to the same trusted workspace in a tab', async () => {
  for (const options of [{ popupError: true }, { noWindows: true }]) {
    const h = harness(options);
    await h.listeners.action({ id: 27 });
    assert.equal(h.tabs.length, 1);
    assert.equal(h.tabs[0].url, 'chrome-extension://guard/src/ui/workspace.html?tab=27');
  }
});

test('missing or invalid action tab IDs never construct a workspace URL', async () => {
  const h = harness();
  for (const tab of [undefined, {}, { id: -1 }, { id: '27' }, { id: 1.5 }])
    await h.listeners.action(tab);
  assert.equal(h.windows.length, 0);
  assert.equal(h.tabs.length, 0);
});

test('modal requests open a workspace only for configured extension content senders', async () => {
  const h = harness();
  const result = await new Promise((resolve) =>
    h.listeners.message({ type: 'open-workspace' }, h.sender, resolve),
  );
  assert.equal(result.ok, true);
  assert.equal(h.windows[0].url, 'chrome-extension://guard/src/ui/workspace.html?tab=27');
  for (const sender of [{}, { ...h.sender, url: 'https://unknown.example/' }]) {
    const result = await new Promise((resolve) =>
      h.listeners.message({ type: 'open-workspace' }, sender, resolve),
    );
    assert.ok(result.error);
  }
  assert.equal(h.windows.length, 1);
});

const workspaceSender = (h) => ({
  id: h.api.runtime.id,
  url: h.api.runtime.getURL('src/ui/workspace.html') + '?tab=27',
});
test('install and startup repair guards on pre-existing configured HTTPS tabs', async () => {
  const h = harness({
    probeMissing: true,
    openTabs: [
      { id: 27, url: 'https://chatgpt.com/' },
      { id: 28, url: 'https://unknown.example/' },
      { id: 29, url: 'http://claude.ai/' },
    ],
  });
  await h.listeners.installed();
  assert.equal(h.injections.length, 1);
  assert.equal(h.injections[0].target.tabId, 27);
  assert.equal(h.injections[0].target.allFrames, true);
  assert.equal(h.injections[0].files[0], 'content.bundle.js');
  await h.listeners.startup();
  assert.equal(h.injections.length, 1);
});
test('workspace health repairs a missing guard and returns verified live readiness', async () => {
  const h = harness({ probeMissing: true });
  const result = await h.message({ type: 'guard-status', tabId: 27 }, workspaceSender(h));
  assert.equal(result.ok, true);
  assert.equal(result.ready, true);
  assert.equal(result.host, 'chatgpt.com');
  assert.equal(result.version, EXTENSION_VERSION);
  assert.equal(h.injections.length, 1);
  assert.ok(
    h.messages
      .filter((entry) => entry.message.type === 'guard-status')
      .every((entry) => entry.options.frameId === 0),
  );
});
test('toolbar activation injects before opening the private workspace', async () => {
  const h = harness({ probeMissing: true });
  await h.listeners.action({ id: 27 });
  assert.equal(h.injections.length, 1);
  assert.equal(h.windows.length, 1);
});
test('toolbar refocuses the live workspace without navigating or replacing its session', async () => {
  // A fresh background has no remembered workspace handle, as after an MV3 restart.
  const h = harness({ workspaceResult: { tabId: 27, workspaceTabId: 45, windowId: 8 } });
  await h.listeners.action({ id: 27 });
  assert.deepEqual(JSON.parse(JSON.stringify(h.runtimeMessages)), [
    { type: 'locate-workspace', tabId: 27 },
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(h.tabUpdates)), [
    { id: 45, options: { active: true } },
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(h.windowUpdates)), [
    { id: 8, options: { focused: true } },
  ]);
  assert.equal(h.windows.length, 0);
  assert.equal(h.tabs.length, 0);
});
test('toolbar rejects mismatched and malformed workspace identities before focusing', async () => {
  for (const workspaceResult of [
    { tabId: 28, workspaceTabId: 45, windowId: 8 },
    { tabId: '27', workspaceTabId: 45, windowId: 8 },
    { tabId: 27, workspaceTabId: 27, windowId: 8 },
    { tabId: 27, workspaceTabId: -1, windowId: 8 },
    { tabId: 27, workspaceTabId: '45', windowId: 8 },
    { tabId: 27, workspaceTabId: 45, windowId: null },
    { tabId: 27, workspaceTabId: 45, windowId: -1 },
    { tabId: 27, workspaceTabId: 45, windowId: 0.5 },
    undefined,
  ]) {
    const h = harness({ workspaceResult });
    await h.listeners.action({ id: 27 });
    assert.equal(h.tabUpdates.length, 0);
    assert.equal(h.windowUpdates.length, 0);
    assert.equal(h.windows.length, 1);
  }
});
test('a workspace closing during focus opens a fresh session safely', async () => {
  const h = harness({
    workspaceResult: { tabId: 27, workspaceTabId: 45, windowId: 8 },
    workspaceFocusError: true,
  });
  await h.listeners.action({ id: 27 });
  assert.equal(h.windowUpdates.length, 0);
  assert.equal(h.windows.length, 1);
});
test('concurrent toolbar requests share one discovery and workspace opening', async () => {
  const gate = deferred();
  const h = harness({ workspaceGate: gate });
  const first = h.listeners.action({ id: 27 });
  const second = h.listeners.action({ id: 27 });
  assert.equal(first, second);
  gate.resolve(undefined);
  await Promise.all([first, second]);
  assert.equal(h.runtimeMessages.length, 1);
  assert.equal(h.windows.length, 1);
});
test('workspace discovery expires and a late reply cannot focus an old session', async (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 0 });
  const gate = deferred(),
    started = deferred(),
    h = harness();
  h.api.runtime.sendMessage = () => {
    started.resolve();
    return gate.promise;
  };
  const opening = h.listeners.action({ id: 27 });
  await started.promise;
  t.mock.timers.tick(500);
  await opening;
  assert.equal(h.windows.length, 1);
  gate.resolve({ tabId: 27, workspaceTabId: 45, windowId: 8 });
  await h.settle();
  assert.equal(h.tabUpdates.length, 0);
  assert.equal(h.windowUpdates.length, 0);
});
test('a blocked draft opens its own handoff workspace without reusing an active vault', async () => {
  const h = harness({ workspaceResult: { tabId: 27, workspaceTabId: 45, windowId: 8 } });
  const handoffId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  assert.equal(
    (await h.message({ type: 'open-workspace', handoffId }, { ...h.sender, frameId: 0 })).ok,
    true,
  );
  assert.equal(h.runtimeMessages.length, 0);
  assert.equal(h.tabUpdates.length, 0);
  assert.equal(h.windows.length, 1);
  assert.match(h.windows[0].url, /draft=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/);
});
test('failed scripting permission reports unavailability rather than readiness', async () => {
  const h = harness({ probeMissing: true, injectionError: true });
  const result = await h.message({ type: 'guard-status', tabId: 27 }, workspaceSender(h));
  assert.equal(result.ok, false);
  assert.equal(result.ready, false);
  assert.match(result.error, /permission/i);
});
test('stale guard versions trigger bundled reinjection before reporting healthy', async () => {
  const h = harness();
  const send = h.api.tabs.sendMessage;
  let first = true;
  h.api.tabs.sendMessage = async (...args) => {
    if (first && args[1].type === 'guard-status') {
      first = false;
      return {
        ok: true,
        version: '0.3.0',
        ready: true,
        configured: true,
        failed: false,
        host: 'chatgpt.com',
      };
    }
    return send(...args);
  };
  const result = await h.message({ type: 'guard-status', tabId: 27 }, workspaceSender(h));
  assert.equal(result.ok, true);
  assert.equal(h.injections.length, 1);
});
test('health checks reject provider pages, other extension pages and invalid tab IDs', async () => {
  const h = harness();
  for (const sender of [
    h.sender,
    {},
    { id: 'other', url: workspaceSender(h).url },
    { id: h.api.runtime.id, url: h.api.runtime.getURL('src/ui/admin.html') },
  ])
    assert.ok((await h.message({ type: 'guard-status', tabId: 27 }, sender)).error);
  for (const tabId of [null, -1, '27', 1.5])
    assert.ok((await h.message({ type: 'guard-status', tabId }, workspaceSender(h))).error);
  assert.equal(h.injections.length, 0);
  assert.equal(h.messages.length, 0);
});
test('unconfigured provider health never returns ready', async () => {
  const h = harness({ openTabs: [{ id: 27, url: 'https://unknown.example/' }] });
  const result = await h.message({ type: 'guard-status', tabId: 27 }, workspaceSender(h));
  assert.equal(result.ok, false);
  assert.equal(result.configured, false);
  assert.equal(h.injections.length, 0);
});
test('policy changes invalidate removed hosts and inject newly configured existing tabs', async () => {
  const h = harness({
    probeMissing: true,
    openTabs: [
      { id: 27, url: 'https://chatgpt.com/' },
      { id: 28, url: 'https://new.example/' },
    ],
  });
  h.policy = { ...policy, sites: [{ host: 'new.example' }] };
  await h.listeners.storage({ policy: { newValue: h.policy } }, 'local');
  const invalidations = h.messages.filter((entry) => entry.message.type === 'policy-invalidated');
  assert.deepEqual(
    invalidations.map((entry) => entry.id),
    [27, 28],
  );
  assert.ok(invalidations.every((entry) => Object.keys(entry.message).length === 1));
  assert.equal(h.injections.length, 1);
  assert.equal(h.injections[0].target.tabId, 28);
});
test('managed policy failures still invalidate existing guards without publishing private values', async () => {
  const h = harness({ policyError: true, openTabs: [{ id: 27, url: 'https://chatgpt.com/' }] });
  await h.listeners.storage({ policy: { newValue: 'invalid' } }, 'managed');
  assert.ok(h.messages.some((entry) => entry.message.type === 'policy-invalidated'));
  assert.equal(h.injections.length, 0);
  const health = await h.message({ type: 'guard-status', tabId: 27 }, workspaceSender(h));
  assert.equal(health.ok, false);
  assert.ok(!JSON.stringify(health).includes('Private Person'));
});
test('unrelated storage changes do not deploy or invalidate page guards', () => {
  const h = harness();
  h.listeners.storage({ theme: {} }, 'local');
  h.listeners.storage({ policy: {} }, 'session');
  assert.equal(h.messages.length, 0);
  assert.equal(h.injections.length, 0);
});
test('draft transfer adds only an opaque UUID to the trusted workspace URL', async () => {
  const h = harness();
  const handoffId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const result = await h.message(
    { type: 'open-workspace', handoffId },
    { ...h.sender, frameId: 0 },
  );
  assert.equal(result.ok, true);
  assert.equal(
    h.windows[0].url,
    `chrome-extension://guard/src/ui/workspace.html?tab=27&draft=${handoffId}`,
  );
  assert.ok(!JSON.stringify(h.windows).includes('Private Person'));
});
test('draft transfer rejects malformed identities and non-main-frame handoffs', async () => {
  const h = harness();
  for (const handoffId of [null, 42, '', 'raw private draft', {}, 'x'.repeat(100000)])
    assert.ok((await h.message({ type: 'open-workspace', handoffId })).error);
  assert.ok(
    (
      await h.message(
        { type: 'open-workspace', handoffId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
        { ...h.sender, frameId: 3 },
      )
    ).error,
  );
  assert.equal(h.windows.length, 0);
});

test('simultaneous workspace checks and toolbar activation share one injection', async () => {
  const h = harness({ probeMissing: true });
  const gate = deferred(),
    started = deferred();
  const inject = h.api.scripting.executeScript;
  let calls = 0;
  h.api.scripting.executeScript = async (options) => {
    calls++;
    started.resolve();
    await gate.promise;
    return inject(options);
  };
  const first = h.message({ type: 'guard-status', tabId: 27 }, workspaceSender(h));
  const second = h.message({ type: 'guard-status', tabId: 27 }, workspaceSender(h));
  const action = h.listeners.action({ id: 27 });
  await started.promise;
  assert.equal(calls, 1);
  gate.resolve();
  assert.equal((await first).ok, true);
  assert.equal((await second).ok, true);
  await action;
  assert.equal(calls, 1);
  assert.equal(h.windows.length, 1);
});

test('hung injection expires within the total activation budget and ignores late completion', async (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 0 });
  const h = harness({ probeMissing: true });
  const gate = deferred(),
    started = deferred();
  const inject = h.api.scripting.executeScript;
  h.api.scripting.executeScript = async (options) => {
    started.resolve();
    await gate.promise;
    return inject(options);
  };
  const response = h.message({ type: 'guard-status', tabId: 27 }, workspaceSender(h));
  await started.promise;
  const probes = h.messages.length;
  t.mock.timers.tick(6000);
  const result = await response;
  assert.equal(result.ready, false);
  assert.match(result.error, /in time/);
  gate.resolve();
  await h.settle();
  assert.equal(h.messages.length, probes);
});

test('hung trusted-storage initialization is included in the activation and policy deadlines', async (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 0 });
  const h = harness({ storageGate: deferred() });
  const health = h.message({ type: 'guard-status', tabId: 27 }, workspaceSender(h));
  const content = h.request();
  await h.settle();
  t.mock.timers.tick(6000);
  assert.equal((await health).ready, false);
  assert.match((await content).error, /Protection is blocking/);
  assert.equal(h.reads, 0);
  assert.equal(h.messages.length, 0);
});

test('a policy change during a live probe cannot publish a stale healthy result', async () => {
  const h = harness();
  const gate = deferred(),
    started = deferred();
  const send = h.api.tabs.sendMessage;
  h.api.tabs.sendMessage = async (...args) => {
    if (args[1].type === 'guard-status') {
      started.resolve();
      await gate.promise;
    }
    return send(...args);
  };
  const response = h.message({ type: 'guard-status', tabId: 27 }, workspaceSender(h));
  await started.promise;
  h.policy = { ...policy, sites: [] };
  const invalidation = h.listeners.storage({ policy: {} }, 'local');
  gate.resolve();
  const result = await response;
  await invalidation;
  assert.equal(result.ready, false);
  assert.match(result.error, /changed/);
});

test('final policy reread detects a removal even before storage notifications arrive', async () => {
  const h = harness();
  const send = h.api.tabs.sendMessage;
  h.api.tabs.sendMessage = async (...args) => {
    const result = await send(...args);
    if (args[1].type === 'guard-status') h.policy = { ...policy, sites: [] };
    return result;
  };
  const result = await h.message({ type: 'guard-status', tabId: 27 }, workspaceSender(h));
  assert.equal(result.ready, false);
  assert.match(result.error, /changed/);
  assert.ok(h.messages.some((entry) => entry.message.type === 'policy-invalidated'));
});

test('policy invalidation reaches guarded tabs while the managed policy read is stalled', async (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 0 });
  const h = harness({
    policyGate: deferred(),
    openTabs: [{ id: 27, url: 'https://chatgpt.com/' }],
  });
  const operation = h.listeners.storage({ policy: {} }, 'managed');
  await h.policyRead;
  assert.ok(h.messages.some((entry) => entry.message.type === 'policy-invalidated'));
  t.mock.timers.tick(6000);
  await operation;
  assert.equal(h.injections.length, 0);
});

test('same-host navigation and pending navigation cannot reuse the previous document status', async () => {
  for (const changed of [
    { id: 27, url: 'https://chatgpt.com/new-conversation' },
    { id: 27, url: 'https://chatgpt.com/', pendingUrl: 'https://claude.ai/' },
  ]) {
    const h = harness();
    let reads = 0;
    h.api.tabs.get = async () => (++reads <= 2 ? { id: 27, url: 'https://chatgpt.com/' } : changed);
    const result = await h.message({ type: 'guard-status', tabId: 27 }, workspaceSender(h));
    assert.equal(result.ready, false);
    assert.match(result.error, /navigated/);
  }
});

test('guard health has no cross-request cache and diagnostics contain only safe enums', async () => {
  const h = harness();
  const send = h.api.tabs.sendMessage;
  h.api.tabs.sendMessage = async (...args) => ({
    ...(await send(...args)),
    editor: {
      composer: 'ready',
      send: 'disabled',
      attachments: 'none',
      label: 'Private Person',
      draft: 'secret',
      url: 'https://chatgpt.com/private',
    },
  });
  const first = await h.message({ type: 'guard-status', tabId: 27 }, workspaceSender(h));
  assert.equal(first.ok, true);
  assert.deepEqual(JSON.parse(JSON.stringify(first.editor)), {
    composer: 'ready',
    send: 'disabled',
    attachments: 'none',
  });
  assert.ok(!JSON.stringify(first).includes('Private Person'));
  assert.ok(!JSON.stringify(first).includes('private'));
  h.api.tabs.get = async () => ({ id: 27, url: 'https://unknown.example/' });
  const second = await h.message({ type: 'guard-status', tabId: 27 }, workspaceSender(h));
  assert.equal(second.ready, false);
  assert.equal(second.configured, false);
});

test('unsupported or malformed editor diagnostics are normalized rather than disclosed', async () => {
  const h = harness();
  const send = h.api.tabs.sendMessage;
  h.api.tabs.sendMessage = async (...args) => ({
    ...(await send(...args)),
    editor: { composer: 'unsupported', send: { text: 'secret' }, attachments: 4 },
  });
  const result = await h.message({ type: 'guard-status', tabId: 27 }, workspaceSender(h));
  assert.deepEqual(JSON.parse(JSON.stringify(result.editor)), {
    composer: 'unknown',
    send: 'unknown',
    attachments: 'unknown',
  });
});
