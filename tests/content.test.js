import test from 'node:test';
import assert from 'node:assert/strict';
import { installContentGuard } from '../src/extension/content-script.js';
import { EXTENSION_VERSION } from '../src/core/build-info.js';
const defaultPolicy = () => ({
  sites: [{ host: 'chatgpt.com' }],
});

function harness({
  host = 'chatgpt.com',
  firefox = false,
  nativeEditor = false,
  windowCapture = false,
} = {}) {
  const listeners = {},
    timers = [],
    requests = [],
    notices = [],
    noticeDetails = [],
    workspaceRequests = [],
    workspaceMessages = [],
    sendResolutions = [];
  const fileInputs = [],
    responseNodes = [];
  let receive,
    changePolicy,
    clicks = 0,
    clickHook = null,
    currentTime = 0,
    uuidSequence = 0,
    messageListenerCount = 0,
    storageListenerCount = 0,
    modalDestroyCount = 0;
  class TextArea {
    get value() {
      return this._value || '';
    }
    set value(value) {
      this._value = value;
      this.nativeWrites = (this.nativeWrites || 0) + 1;
    }
  }
  class TextInput extends TextArea {
    get value() {
      return super.value;
    }
    set value(value) {
      super.value = value;
    }
  }
  const editor = nativeEditor ? new TextArea() : { textContent: '', isContentEditable: true };
  editor.isConnected = true;
  editor.dispatchEvent = (event) => {
    editor.lastInput = event;
  };
  const form = {};
  const button = {
    disabled: false,
    isConnected: true,
    click() {
      const click = fire('click', this, { isTrusted: false });
      if (!click.blocked) {
        clicks++;
        clickHook?.();
        if (this.form) fire('submit', this.form);
      }
    },
  };
  const elements = { editor, button };
  const document = {
    addEventListener(type, callback, options) {
      (listeners[type] ||= []).push({ callback, options, target: 'document' });
    },
    removeEventListener(type, callback) {
      listeners[type] = (listeners[type] || []).filter((entry) => entry.callback !== callback);
    },
  };
  if (windowCapture)
    document.defaultView = {
      addEventListener(type, callback, options) {
        (listeners[type] ||= []).push({ callback, options, target: 'window' });
      },
      removeEventListener(type, callback) {
        listeners[type] = (listeners[type] || []).filter((entry) => entry.callback !== callback);
      },
    };
  const dom = {
    nodes() {
      return [...Object.values(elements).filter(Boolean), ...fileInputs];
    },
    resolveComposer() {
      return elements.editor;
    },
    resolveSend(_site, _editor, options = {}) {
      sendResolutions.push(options);
      if (!elements.button && !options.allowMissing)
        throw new Error('No accessible send control was found.');
      return elements.button;
    },
    readResponses() {
      return responseNodes.map((node) => node.innerText || node.textContent || '');
    },
    selectedFiles() {
      return fileInputs.some((input) => input.files?.length);
    },
    nearestForm(node) {
      return node.form;
    },
    isSendControl(node) {
      return node === elements.button;
    },
    isUploadControl(node) {
      return Boolean(node?.files);
    },
    controlFromEvent(event, predicate) {
      return (event.composedPath?.() || [event.target]).find(predicate) || null;
    },
  };
  const modal = {
    destroy() {
      modalDestroyCount++;
    },
    show(notice) {
      noticeDetails.push(notice);
      const { message } = notice;
      if (notices.at(-1) !== message) notices.push(message);
    },
    isOwnEvent(event) {
      return Boolean(event.ownModal);
    },
  };
  const runtime = {
    id: 'leak-guard',
    getURL(path) {
      return `${firefox ? 'moz-extension' : 'chrome-extension'}://leak-guard/${path}`;
    },
    sendMessage(message, callback) {
      if (message.type === 'open-workspace') {
        workspaceMessages.push(message);
        if (firefox) return new Promise((resolve) => workspaceRequests.push(resolve));
        workspaceRequests.push(callback);
        return;
      }
      assert.equal(message.type, 'policy');
      if (firefox) return new Promise((resolve) => requests.push(resolve));
      requests.push(callback);
    },
    onMessage: {
      addListener(callback) {
        messageListenerCount++;
        receive = callback;
      },
      removeListener(callback) {
        if (receive === callback) receive = null;
      },
    },
  };
  const api = {
    runtime,
    storage: {
      onChanged: {
        addListener(callback) {
          storageListenerCount++;
          changePolicy = callback;
        },
        removeListener(callback) {
          if (changePolicy === callback) changePolicy = null;
        },
      },
    },
  };
  const context = {
    document,
    location: { hostname: host },
    URL,
    [firefox ? 'browser' : 'chrome']: api,
    HTMLTextAreaElement: TextArea,
    HTMLInputElement: TextInput,
    InputEvent: class {
      constructor(type, options) {
        this.type = type;
        Object.assign(this, options);
      }
    },
    crypto: {
      randomUUID: () =>
        `aaaaaaaa-aaaa-4aaa-8aaa-${(++uuidSequence).toString(16).padStart(12, '0')}`,
    },
    setTimeout(callback, delay) {
      callback.delay = delay;
      timers.push(callback);
      return callback;
    },
    clearTimeout(callback) {
      const index = timers.indexOf(callback);
      if (index !== -1) timers.splice(index, 1);
    },
  };
  const dependencies = { dom, modal, now: () => currentTime };
  const guard = installContentGuard(context, dependencies);
  function event(type = 'click', target = button, properties = {}) {
    return {
      type,
      target,
      isTrusted: true,
      preventDefault() {
        this.blocked = true;
      },
      stopImmediatePropagation() {
        this.stopped = true;
      },
      ...properties,
    };
  }
  function fire(type, target = button, properties = {}) {
    const current = event(type, target, properties);
    for (const { callback } of listeners[type] || []) {
      callback(current);
      if (current.stopped) break;
    }
    return current;
  }
  const sender = { id: runtime.id, url: `${runtime.getURL('src/ui/workspace.html')}?tab=17` };
  return {
    editor,
    button,
    form,
    elements,
    timers,
    requests,
    notices,
    noticeDetails,
    workspaceRequests,
    workspaceMessages,
    sendResolutions,
    listeners,
    fileInputs,
    responseNodes,
    runtime,
    document,
    dom,
    context,
    guard,
    get messageListenerCount() {
      return messageListenerCount;
    },
    get storageListenerCount() {
      return storageListenerCount;
    },
    get modalDestroyCount() {
      return modalDestroyCount;
    },
    reinstall() {
      return installContentGuard(context, dependencies);
    },
    advanceTime(milliseconds) {
      currentTime += milliseconds;
    },
    finishTimers(limit = 30) {
      for (let count = 0; timers.length && count < limit; count++) {
        const timer = timers.shift();
        currentTime += timer.delay;
        timer();
      }
    },
    event,
    fire,
    sender,
    get clicks() {
      return clicks;
    },
    load(policy = defaultPolicy()) {
      requests.shift()({ policy });
    },
    fail() {
      requests.shift()({ error: 'Policy invalid' });
    },
    refresh(area = 'local', changes = { policy: { newValue: {} } }) {
      changePolicy(changes, area);
    },
    send(message, reply, from = sender) {
      return receive(message, from, reply);
    },
    handoff(text = '[[LG_test_EMAIL_1]]') {
      const result = {};
      result.async = receive({ type: 'send-sanitized', text }, sender, (value) => {
        result.value = value;
      });
      return result;
    },
    set clickHook(callback) {
      clickHook = callback;
    },
  };
}

test('startup and invalid policy fail closed before native page actions', () => {
  for (const fail of [
    (h) => h.fail(),
    (h) =>
      h.load({
        sites: [{ host: 'chatgpt.com', send: '[invalid' }],
      }),
    (h) => h.load({}),
  ]) {
    const h = harness();
    assert.ok(h.fire('click').blocked);
    assert.ok(h.fire('submit', h.form).blocked);
    fail(h);
    assert.ok(h.fire('click').blocked);
    assert.ok(h.fire('keydown', h.editor, { key: 'Enter' }).blocked);
  }
});

test('unconfigured exact hosts resume normal interaction after policy loads', () => {
  for (const host of ['example.com', 'chatgpt.com.example.com', 'sub.chatgpt.com']) {
    const h = harness({ host });
    h.load();
    assert.ok(!h.fire('click').blocked);
    assert.ok(!h.fire('submit', h.form).blocked);
    assert.ok(!h.fire('keydown', h.editor, { key: 'Enter' }).blocked);
    assert.match(h.handoff().value.error, /not configured/);
  }
});

test('native sends are blocked across click, pointer, mouse, and touch actions', () => {
  const h = harness();
  h.load();
  for (const type of [
    'click',
    'auxclick',
    'pointerdown',
    'pointerup',
    'mousedown',
    'mouseup',
    'touchstart',
    'touchend',
  ]) {
    assert.ok(h.fire(type).blocked, type);
  }
  assert.equal(h.notices.length, 1);
  assert.equal(h.listeners.touchstart[0].options.passive, false);
});

test('send guard finds semantic controls in open shadow event paths and text nodes', () => {
  const h = harness();
  h.load();
  assert.ok(h.fire('click', {}, { composedPath: () => [{}, h.button] }).blocked);
  assert.ok(!h.fire('click', { closest: () => null }).blocked);
});

test('Enter and modified Enter cannot send; Shift+Enter can insert a newline', () => {
  const h = harness();
  h.load();
  for (const type of ['keydown', 'keypress', 'keyup']) {
    for (const modifiers of [
      {},
      { ctrlKey: true },
      { metaKey: true },
      { shiftKey: true, ctrlKey: true },
    ]) {
      assert.ok(h.fire(type, h.editor, { key: 'Enter', ...modifiers }).blocked);
    }
    assert.ok(h.fire(type, h.button, { key: ' ' }).blocked);
    assert.ok(h.fire(type, h.button, { key: 'Enter', shiftKey: true }).blocked);
  }
  assert.ok(!h.fire('keydown', h.editor, { key: 'Enter', shiftKey: true }).blocked);
  assert.ok(h.fire('submit', h.form).blocked);
});

test('files are blocked from selection, drop, clipboard, and drag items without Files', () => {
  const h = harness();
  h.load();
  const input = {
    files: [{}],
    value: 'C:/fakepath/private.txt',
  };
  assert.ok(h.fire('click', input).blocked);
  assert.ok(h.fire('keydown', input, { key: ' ' }).blocked);
  assert.ok(h.fire('keydown', input, { key: 'Enter', shiftKey: true }).blocked);
  assert.ok(h.fire('change', input).blocked);
  assert.equal(input.value, '');
  assert.ok(h.fire('drop', h.editor, { dataTransfer: { files: [{}] } }).blocked);
  assert.ok(
    h.fire('paste', h.editor, { clipboardData: { files: [], items: [{ kind: 'file' }] } }).blocked,
  );
  for (const type of ['dragenter', 'dragover']) {
    assert.ok(
      h.fire(type, h.editor, { dataTransfer: { files: [], items: [{ kind: 'file' }] } }).blocked,
    );
  }
  assert.ok(
    !h.fire('paste', h.editor, { clipboardData: { files: [], items: [{ kind: 'string' }] } })
      .blocked,
  );
  assert.equal(h.notices.length, 1);
});

test('sends and response reads accept only the extension private workspace', () => {
  const h = harness();
  h.load();
  const impostors = [
    {},
    { id: 'another-extension', url: h.sender.url },
    { id: h.runtime.id, url: 'https://chatgpt.com/src/ui/workspace.html' },
    { id: h.runtime.id, url: h.runtime.getURL('admin.html') },
    { id: h.runtime.id, url: `${h.runtime.getURL('src/ui/workspace.html')}/extra` },
    { id: h.runtime.id, url: 'invalid URL' },
  ];
  for (const sender of impostors)
    for (const type of ['send-sanitized', 'responses']) {
      let result;
      h.send(
        { type, text: 'safe' },
        (value) => {
          result = value;
        },
        sender,
      );
      assert.match(result.error, /Only the extension/);
    }
  assert.equal(h.timers.length, 0);
  assert.equal(h.editor.textContent, '');
});

test('unrelated runtime messages are ignored', () => {
  const h = harness();
  h.load();
  let replied = false;
  assert.equal(
    h.send({ type: 'policy' }, () => {
      replied = true;
    }),
    undefined,
  );
  assert.equal(
    h.send(null, () => {
      replied = true;
    }),
    undefined,
  );
  assert.equal(replied, false);
});

test('only the intended sanitized synthetic click is allowed and protection resumes', () => {
  const h = harness();
  h.load();
  const result = h.handoff();
  assert.equal(result.async, true);
  assert.equal(h.editor.textContent, '[[LG_test_EMAIL_1]]');
  h.timers.shift()();
  assert.equal(h.clicks, 1);
  assert.equal(result.value.ok, true);
  assert.ok(h.fire('click').blocked);
  assert.ok(h.fire('submit', h.form).blocked);
});

test('native input value setter dispatches the sanitized draft as input', () => {
  const h = harness({ nativeEditor: true });
  h.load();
  const result = h.handoff('Sanitized phone: [[LG_session_PHONE_1]]');
  assert.equal(h.editor.nativeWrites, 1);
  assert.equal(h.editor.lastInput.type, 'input');
  assert.equal(h.editor.lastInput.data, h.editor.value);
  h.timers.shift()();
  assert.equal(result.value.ok, true);
});

test('nested sends cannot borrow the permission granted to a sanitized click', () => {
  const h = harness();
  h.load();
  let nested;
  h.clickHook = () => {
    nested = h.fire('click', h.button, { isTrusted: false });
  };
  const result = h.handoff();
  h.timers.shift()();
  assert.ok(nested.blocked);
  assert.equal(h.clicks, 1);
  assert.equal(result.value.ok, true);
});

test('only the send button own form can submit while click is allowed', () => {
  const h = harness();
  h.load();
  h.button.form = h.form;
  const unrelated = { closest: () => null };
  let unrelatedSubmit, ownSubmit;
  h.clickHook = () => {
    unrelatedSubmit = h.fire('submit', unrelated);
    ownSubmit = h.fire('submit', h.form);
  };
  const result = h.handoff();
  h.timers.shift()();
  assert.ok(unrelatedSubmit.blocked);
  assert.ok(!ownSubmit.blocked);
  assert.equal(result.value.ok, true);
  assert.ok(h.fire('submit', h.form).blocked);
});

test('changed draft content, disconnected elements and disabled controls prevent send', () => {
  for (const change of [
    (h) => {
      h.editor.textContent = 'changed';
    },
    (h) => {
      h.editor.isConnected = false;
    },
    (h) => {
      h.button.disabled = true;
    },
    (h) => {
      h.elements.editor = { ...h.editor, textContent: 'A different draft' };
    },
  ]) {
    const h = harness();
    h.load();
    const result = h.handoff();
    change(h);
    h.finishTimers();
    assert.equal(h.clicks, 0);
    assert.match(result.value.error, /Nothing was sent/);
  }
});

test('missing or noneditable composers and disabled send controls reject handoff', () => {
  for (const change of [
    (h) => {
      h.elements.editor = null;
    },
    (h) => {
      h.editor.isContentEditable = false;
    },
  ]) {
    const h = harness();
    h.load();
    change(h);
    assert.ok(h.handoff().value.error);
    assert.equal(h.timers.length, 0);
    assert.equal(h.clicks, 0);
  }
});

test('invalid and oversized drafts never enter the provider composer', () => {
  const h = harness();
  h.load();
  for (const text of [null, undefined, 42, '', ' \n ', 'x'.repeat(1_000_001)]) {
    let result;
    h.send({ type: 'send-sanitized', text }, (value) => {
      result = value;
    });
    assert.match(result.error, /Invalid or oversized/);
  }
  assert.equal(h.editor.textContent, '');
});

test('selected page files block sending both before draft fill and before final click', () => {
  const h = harness();
  h.load();
  h.fileInputs.push({ files: [{}] });
  assert.match(h.handoff().value.error, /file is still selected/);
  assert.equal(h.editor.textContent, '');
  h.fileInputs.length = 0;
  const result = h.handoff();
  h.fileInputs.push({ files: [{}] });
  h.timers.shift()();
  assert.equal(h.clicks, 0);
  assert.match(result.value.error, /Remove attachments/);
});

test('overlapping handoffs are rejected without releasing the first pending request', () => {
  const h = harness();
  h.load();
  const first = h.handoff('first sanitized draft');
  assert.match(h.handoff('second draft').value.error, /already in progress/);
  assert.match(h.handoff('third draft').value.error, /already in progress/);
  assert.equal(h.editor.textContent, 'first sanitized draft');
  h.timers.shift()();
  assert.equal(first.value.ok, true);
  const next = h.handoff('next sanitized draft');
  h.timers.shift()();
  assert.equal(next.value.ok, true);
});

test('policy changes block during reload, cancel pending handoff, and activate new hosts', () => {
  const h = harness({ host: 'example.com' });
  h.load();
  assert.ok(!h.fire('click').blocked);
  h.refresh();
  assert.ok(h.fire('click').blocked);
  const policy = defaultPolicy();
  policy.sites[0].host = 'example.com';
  h.load(policy);
  assert.ok(h.fire('click').blocked);
  const result = h.handoff();
  h.refresh('managed');
  h.load(policy);
  h.timers.shift()();
  assert.equal(h.clicks, 0);
  assert.match(result.value.error, /Policy changed/);
});

test('removing a host from policy releases it after protection reload', () => {
  const h = harness();
  h.load();
  assert.ok(h.fire('click').blocked);
  h.refresh();
  h.load({
    sites: [{ host: 'example.com' }],
  });
  assert.ok(!h.fire('click').blocked);
});

test('out-of-order policy results cannot overwrite the newest policy', () => {
  const h = harness();
  const firstCallback = h.requests.shift();
  h.refresh();
  h.load(defaultPolicy());
  firstCallback({ policy: { sites: [] } });
  assert.ok(h.fire('click').blocked);
});

test('unrelated storage changes do not interrupt handoff', () => {
  const h = harness();
  h.load();
  const result = h.handoff();
  h.refresh('session');
  h.refresh('local', { theme: { newValue: 'dark' } });
  h.timers.shift()();
  assert.equal(result.value.ok, true);
  assert.equal(h.requests.length, 0);
});

test('responses remain plain text, and no original values are inserted into the page', () => {
  const h = harness();
  h.load();
  h.responseNodes.push(
    { innerText: '<script>unsafe()</script> [[LG_test_EMAIL_1]]' },
    { textContent: 'second reply' },
  );
  let result;
  h.send({ type: 'responses' }, (value) => {
    result = value;
  });
  assert.equal(result.text, '<script>unsafe()</script> [[LG_test_EMAIL_1]]\n\nsecond reply');
  assert.equal(h.editor.textContent, '');
});

test('Firefox Promise-based policy loading supports the same guarded handoff', async () => {
  const h = harness({ firefox: true });
  assert.ok(h.fire('click').blocked);
  h.load();
  await Promise.resolve();
  const result = h.handoff();
  h.timers.shift()();
  assert.equal(result.value.ok, true);
  assert.equal(h.clicks, 1);
});

test('clear or draft edits can cancel an authorized pending handoff', () => {
  const h = harness();
  h.load();
  const pending = h.handoff();
  let cancellation;
  h.send({ type: 'cancel-handoff' }, (r) => (cancellation = r));
  assert.equal(cancellation.ok, true);
  h.timers.shift()();
  assert.equal(h.clicks, 0);
  assert.match(pending.value.error, /canceled/);
});
test('another private window cannot cancel this workspace pending send', () => {
  const h = harness();
  h.load();
  const pending = h.handoff();
  h.send({ type: 'cancel-handoff' }, () => {}, {
    ...h.sender,
    url: h.runtime.getURL('src/ui/workspace.html') + '?tab=other',
  });
  h.timers.shift()();
  assert.equal(h.clicks, 1);
  assert.equal(pending.value.ok, true);
});

test('initially disabled or absent send controls can appear after sanitized input', () => {
  for (const absent of [false, true]) {
    const h = harness();
    h.load();
    h.button.disabled = true;
    if (absent) h.elements.button = null;
    h.editor.dispatchEvent = () => {
      h.button.disabled = false;
      h.elements.button = h.button;
    };
    const result = h.handoff();
    h.timers.shift()();
    assert.equal(result.value.ok, true);
    assert.equal(h.clicks, 1);
  }
});
test('send control remaining disabled after input blocks the handoff', () => {
  const h = harness();
  h.load();
  h.button.disabled = true;
  const result = h.handoff();
  h.finishTimers();
  assert.ok(result.value.error);
  assert.equal(h.clicks, 0);
});

test('framework rerender can replace the composer and send control while preserving the verified draft', () => {
  const h = harness();
  h.load();
  const text = 'Name: [[LG_session_NAME_1]]\nAddress: [[LG_session_ADDRESS_2]]';
  const result = h.handoff(text);
  h.elements.editor = { ...h.editor, textContent: text.replace('\n', '\n\n') };
  h.elements.button = { ...h.button };
  h.editor.isConnected = false;
  h.button.isConnected = false;
  h.timers.shift()();
  assert.deepEqual(result.value, { ok: true });
  assert.equal(h.clicks, 1);
  assert.ok(h.fire('click', h.elements.button).blocked);
});

test('placeholder loss, reorder, duplication and appended raw content are rejected after rerender', () => {
  const expected = 'First [[LG_session_NAME_1]]\nSecond [[LG_session_EMAIL_2]]';
  for (const actual of [
    'First [[LG_session_NAME_1]] Second',
    'First [[LG_session_EMAIL_2]] Second [[LG_session_NAME_1]]',
    `${expected} [[LG_session_NAME_1]]`,
    `${expected} Original name added by the page`,
  ]) {
    const h = harness();
    h.load();
    const result = h.handoff(expected);
    h.elements.editor = { ...h.editor, textContent: actual };
    h.timers.shift()();
    assert.match(result.value.error, /changed.*(?:placeholders|content).*Nothing was sent/);
    assert.equal(h.clicks, 0);
  }
});

test('a delayed enabled send control is retried within a bounded timeout', () => {
  const h = harness();
  h.load();
  h.button.disabled = true;
  const result = h.handoff();
  h.timers.shift()();
  assert.equal(result.value, undefined);
  assert.equal(h.clicks, 0);
  h.button.disabled = false;
  h.timers.shift()();
  assert.equal(result.value.ok, true);
  assert.equal(h.clicks, 1);
});

test('text is verified again inside the click permit after page updates at click time', () => {
  const h = harness();
  h.load();
  h.button.click = function () {
    h.editor.textContent += ' Raw value added at click time';
    const event = h.fire('click', this, { isTrusted: false });
    assert.ok(event.blocked);
  };
  const result = h.handoff();
  h.timers.shift()();
  assert.match(result.value.error, /guarded send click/);
  assert.equal(h.clicks, 0);
});

test('a current uniquely resolved control uses its exact permitted node even if the broad send classifier changes', () => {
  const h = harness();
  h.load();
  h.button.tagName = 'BUTTON';
  h.dom.isSendControl = () => false;
  const result = h.handoff();
  h.timers.shift()();
  assert.equal(result.value.ok, true);
  assert.equal(h.clicks, 1);
  assert.ok(h.fire('click', h.button).blocked);
});

test('nearby editor mutations settle before a verified send and the observer is disconnected afterward', () => {
  const h = harness();
  h.load();
  let observer;
  h.context.MutationObserver = class {
    constructor(callback) {
      this.callback = callback;
      observer = this;
    }
    observe(target) {
      this.target = target;
    }
    disconnect() {
      this.disconnected = true;
    }
  };
  const result = h.handoff();
  assert.equal(observer.target, h.editor);
  h.advanceTime(80);
  observer.callback();
  h.advanceTime(20);
  h.timers.shift()();
  assert.equal(result.value, undefined);
  assert.equal(h.clicks, 0);
  h.advanceTime(100);
  h.timers.shift()();
  assert.equal(result.value.ok, true);
  assert.equal(h.clicks, 1);
  assert.equal(observer.disconnected, true);
});

test('cancellation during disabled-control retry cannot release a later enabled control', () => {
  const h = harness();
  h.load();
  h.button.disabled = true;
  const result = h.handoff();
  h.timers.shift()();
  h.send({ type: 'cancel-handoff' }, () => {});
  h.button.disabled = false;
  h.timers.shift()();
  assert.match(result.value.error, /canceled/);
  assert.equal(h.clicks, 0);
});

test('safe readiness diagnostics distinguish composer, send and attachment states without text or labels', () => {
  const h = harness();
  h.load();
  h.editor.textContent = 'A private original that must not appear in diagnostics';
  h.button.disabled = true;
  h.fileInputs.push({ files: [{}] });
  assert.deepEqual(h.guard.status().editor, {
    composer: 'ready',
    send: 'disabled',
    attachments: 'selected',
  });
  h.elements.button = null;
  assert.equal(h.guard.status().editor.send, 'missing');
  h.dom.resolveSend = () => {
    throw new Error('Ambiguous send control: 2 accessible targets match.');
  };
  assert.equal(h.guard.status().editor.send, 'ambiguous');
  h.dom.resolveComposer = () => {
    throw new Error('Ambiguous message composer: 2 accessible targets match.');
  };
  assert.equal(h.guard.status().editor.composer, 'ambiguous');
  assert.ok(!JSON.stringify(h.guard.status()).includes('private original'));
  assert.equal(h.guard.status().failed, false);
});

test('modal controls remain interactive while guarded page sends stay blocked', () => {
  const h = harness();
  assert.ok(!h.fire('click', {}, { ownModal: true }).blocked);
  h.load();
  assert.ok(!h.fire('keydown', {}, { ownModal: true, key: 'Enter' }).blocked);
  assert.ok(h.fire('click').blocked);
});

test('guards register on window capture ahead of provider document-capture handlers', () => {
  const h = harness({ windowCapture: true });
  for (const registrations of Object.values(h.listeners)) {
    assert.ok(registrations.every((entry) => entry.target === 'window'));
    assert.ok(
      registrations.every((entry) => entry.options === true || entry.options.capture === true),
    );
  }
  assert.ok(h.fire('click').blocked);
  h.load();
  assert.ok(h.fire('keydown', h.editor, { key: 'Enter' }).blocked);
});

test('unrecognized named controls cannot transmit a nonempty provider draft', () => {
  const h = harness();
  h.load();
  h.editor.textContent = 'Hans Müller, Hauptstraße 27, 10115 Berlin, +49 30 123456';
  const controls = [
    { tagName: 'BUTTON' },
    { tagName: 'DIV', getAttribute: (name) => (name === 'role' ? 'button' : null) },
    ...['submit', 'button', 'image'].map((type) => ({ tagName: 'INPUT', type })),
  ];
  for (const target of controls) {
    assert.ok(h.fire('click', target).blocked);
    assert.ok(h.fire('pointerdown', target).blocked);
    assert.ok(h.fire('keydown', target, { key: ' ' }).blocked);
  }
});

test('ordinary unknown navigation controls remain usable with an empty native draft', () => {
  const h = harness();
  h.load();
  const navigation = { tagName: 'BUTTON' };
  assert.ok(!h.fire('click', navigation).blocked);
  assert.ok(!h.fire('pointerdown', navigation).blocked);
  assert.ok(!h.fire('keydown', navigation, { key: ' ' }).blocked);
});

test('composer ambiguity blocks unknown controls without assuming an empty draft', () => {
  const h = harness();
  h.load();
  h.dom.resolveComposer = () => {
    throw new Error('Ambiguous message composer: 2 accessible targets match.');
  };
  const unknown = { tagName: 'BUTTON' };
  assert.ok(h.fire('click', unknown).blocked);
  assert.ok(h.fire('keydown', unknown, { key: ' ' }).blocked);
});

test('pages without any accessible composer retain ordinary navigation', () => {
  const h = harness();
  h.load();
  h.dom.resolveComposer = () => {
    throw new Error('No accessible message composer was found.');
  };
  assert.ok(!h.fire('click', { tagName: 'BUTTON' }).blocked);
});

test('retained drafts remain guarded when accessibility discovery excludes aria-hidden or readonly editors', () => {
  for (const draft of [
    {
      tagName: 'DIV',
      isContentEditable: true,
      innerText: 'A retained prompt',
      getAttribute: (name) => (name === 'aria-hidden' ? 'true' : null),
    },
    { tagName: 'TEXTAREA', readOnly: true, value: 'A readonly retained prompt' },
    { tagName: 'TEXTAREA', disabled: true, value: 'A disabled retained prompt' },
  ]) {
    const h = harness();
    h.load();
    h.dom.resolveComposer = () => {
      throw new Error('No accessible message composer was found.');
    };
    h.dom.nodes = () => [draft];
    h.dom.isSendControl = () => false;
    const button = { tagName: 'BUTTON' };
    for (const type of ['click', 'pointerdown', 'touchstart'])
      assert.ok(h.fire(type, button).blocked, type);
    assert.ok(h.fire('keydown', button, { key: ' ' }).blocked);
    assert.equal(h.clicks, 0);
  }
});

test('an empty accessible field cannot mask a retained draft in another editable host', () => {
  const h = harness();
  h.load();
  const hiddenDraft = { tagName: 'TEXTAREA', value: 'Retained draft', hidden: true };
  h.dom.nodes = () => [h.editor, hiddenDraft];
  assert.ok(h.fire('click', { tagName: 'BUTTON' }).blocked);
});

test('installation reinjection returns the same version guard without duplicate listeners or policy requests', () => {
  const h = harness();
  const counts = Object.fromEntries(
    Object.entries(h.listeners).map(([type, entries]) => [type, entries.length]),
  );
  assert.equal(h.reinstall(), h.guard);
  assert.equal(h.requests.length, 1);
  h.load();
  assert.equal(h.reinstall(), h.guard);
  assert.equal(h.messageListenerCount, 1);
  assert.equal(h.storageListenerCount, 1);
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(h.listeners).map(([type, entries]) => [type, entries.length]),
    ),
    counts,
  );
});

test('replacement runtime tears down old event, storage, message and modal ownership', () => {
  const h = harness({ windowCapture: true });
  h.load();
  const previous = h.guard;
  h.context.chrome = { ...h.context.chrome, runtime: { ...h.runtime } };
  const replacement = h.reinstall();
  assert.notEqual(replacement, previous);
  assert.equal(h.modalDestroyCount, 1);
  assert.equal(h.messageListenerCount, 2);
  assert.equal(h.storageListenerCount, 2);
  assert.ok(Object.values(h.listeners).every((entries) => entries.length === 1));
  assert.equal(h.requests.length, 1);
  assert.equal(previous.status().ready, false);
  h.load();
  assert.ok(h.fire('click').blocked);
  assert.equal(replacement.status().ready, true);
});

test('common installation registry replaces a previous version without duplicate guards', () => {
  const h = harness();
  h.load();
  h.context.__aiLeakGuardContentGuard = { ...h.guard, version: '0.3.99' };
  const replacement = h.reinstall();
  assert.notEqual(replacement, h.guard);
  assert.equal(h.context.__aiLeakGuardContentGuard, replacement);
  assert.equal(h.modalDestroyCount, 1);
  assert.ok(Object.values(h.listeners).every((entries) => entries.length === 1));
});

test('destroy immediately cancels pending sends and removes the installation registry and timers', () => {
  const h = harness();
  h.load();
  const pending = h.handoff();
  const oldTimer = h.timers[0];
  h.guard.destroy();
  assert.match(pending.value.error, /guard was replaced/);
  assert.equal(h.timers.length, 0);
  assert.equal(h.context.__aiLeakGuardContentGuard, undefined);
  assert.ok(Object.values(h.listeners).every((entries) => entries.length === 0));
  oldTimer();
  assert.equal(h.clicks, 0);
  h.guard.destroy();
  assert.equal(h.modalDestroyCount, 1);
});

test('replacement destroys an unused original snapshot instead of importing it into the new guard', async () => {
  const h = harness();
  h.load();
  const handoffId = await captureDraft(h, 'Retired original draft');
  h.context.chrome = { ...h.context.chrome, runtime: { ...h.runtime } };
  h.reinstall();
  h.load();
  let reply;
  h.send({ type: 'take-draft', handoffId }, (value) => {
    reply = value;
  });
  assert.match(reply.error, /expired or was already used/);
  assert.equal(h.timers.length, 0);
});

test('trusted background and workspace probes report the actual installed guard state', () => {
  const h = harness();
  const backgrounds = [
    { id: h.runtime.id },
    ...[
      'src/extension/background.js',
      'background.bundle.js',
      '_generated_background_page.html',
    ].map((path) => ({ id: h.runtime.id, url: h.runtime.getURL(path) })),
    h.sender,
  ];
  for (const sender of backgrounds) {
    let status;
    h.send(
      { type: 'guard-status' },
      (reply) => {
        status = reply;
      },
      sender,
    );
    assert.deepEqual(status, {
      ok: true,
      version: EXTENSION_VERSION,
      host: 'chatgpt.com',
      configured: false,
      ready: false,
      failed: false,
    });
  }
  h.load();
  assert.deepEqual(h.guard.status(), {
    ok: true,
    version: EXTENSION_VERSION,
    host: 'chatgpt.com',
    configured: true,
    ready: true,
    failed: false,
    editor: { composer: 'ready', send: 'ready', attachments: 'none' },
  });
  h.refresh();
  h.fail();
  assert.equal(h.guard.status().failed, true);
  assert.equal(h.guard.status().configured, false);
});

test('foreign pages, other extension pages and content senders cannot probe or invalidate guard state', () => {
  const h = harness();
  h.load();
  for (const sender of [
    { id: 'foreign', url: h.runtime.getURL('src/extension/background.js') },
    { id: h.runtime.id, tab: { id: 17 }, url: h.runtime.getURL('src/extension/background.js') },
    { id: h.runtime.id, tab: { id: 17 }, url: 'https://chatgpt.com/' },
    { id: h.runtime.id, url: h.runtime.getURL('src/ui/admin.html') },
  ])
    for (const type of ['guard-status', 'policy-invalidated']) {
      let reply;
      h.send(
        { type },
        (value) => {
          reply = value;
        },
        sender,
      );
      assert.ok(reply.error);
    }
  let workspaceReply;
  h.send({ type: 'policy-invalidated' }, (value) => {
    workspaceReply = value;
  });
  assert.ok(workspaceReply.error);
  assert.equal(h.requests.length, 0);
  assert.equal(h.guard.status().ready, true);
});

test('background policy invalidation blocks immediately and cancels a pending handoff', () => {
  const h = harness();
  h.load();
  const pending = h.handoff();
  let reply;
  h.send(
    { type: 'policy-invalidated' },
    (value) => {
      reply = value;
    },
    { id: h.runtime.id },
  );
  assert.equal(reply.ok, true);
  assert.equal(h.guard.status().ready, false);
  assert.equal(h.requests.length, 1);
  assert.ok(h.fire('click').blocked);
  h.load();
  h.timers.shift()();
  assert.match(pending.value.error, /Policy changed/);
  assert.equal(h.clicks, 0);
});

async function captureDraft(h, text) {
  h.editor.textContent = text;
  h.fire('click');
  const opened = h.noticeDetails.at(-1).onAction();
  h.workspaceRequests.shift()({ ok: true });
  await opened;
  return h.workspaceMessages.at(-1).handoffId;
}

test('modal action transfers the current original multiline content only once to its private workspace', async () => {
  for (const nativeEditor of [false, true]) {
    const h = harness({ nativeEditor });
    h.load();
    const original = '  First line\nSecond line\n\nFinal line  ';
    h.fire('click');
    if (nativeEditor) h.editor.value = original;
    else {
      h.editor.textContent = 'Collapsed DOM text';
      h.editor.innerText = original;
    }
    const action = h.noticeDetails.at(-1).onAction();
    const message = h.workspaceMessages.at(-1);
    assert.deepEqual(Object.keys(message).sort(), ['handoffId', 'type']);
    assert.equal(message.type, 'open-workspace');
    assert.match(message.handoffId, /^[a-f\d-]{36}$/);
    assert.ok(!JSON.stringify(message).includes('First line'));
    h.workspaceRequests.shift()({ ok: true });
    await action;
    let result;
    h.send({ type: 'take-draft', handoffId: message.handoffId }, (reply) => {
      result = reply;
    });
    assert.deepEqual(result, { text: original });
    h.send({ type: 'take-draft', handoffId: message.handoffId }, (reply) => {
      result = reply;
    });
    assert.match(result.error, /expired or was already used/);
    assert.equal(h.clicks, 0);
    assert.equal(nativeEditor ? h.editor.value : h.editor.innerText, original);
  }
});

test('wrong identities and foreign senders cannot consume another private draft transfer', async () => {
  const h = harness();
  h.load();
  const handoffId = await captureDraft(h, 'Original stays local');
  for (const sender of [
    { id: 'foreign', url: h.sender.url },
    { id: h.runtime.id, tab: { id: 17 }, url: 'https://chatgpt.com/' },
    { id: h.runtime.id, url: h.runtime.getURL('src/ui/admin.html') },
    { id: h.runtime.id },
  ]) {
    let reply;
    h.send(
      { type: 'take-draft', handoffId },
      (value) => {
        reply = value;
      },
      sender,
    );
    assert.ok(reply.error);
  }
  for (const id of [null, '', 'not-a-uuid', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb']) {
    let reply;
    h.send({ type: 'take-draft', handoffId: id }, (value) => {
      reply = value;
    });
    assert.ok(reply.error);
  }
  let reply;
  h.send({ type: 'take-draft', handoffId }, (value) => {
    reply = value;
  });
  assert.equal(reply.text, 'Original stays local');
});

test('private draft transfers expire after five minutes and expiry also erases idle memory', async () => {
  for (const expiry of ['clock', 'timer']) {
    const h = harness();
    h.load();
    const handoffId = await captureDraft(h, 'Expiring draft');
    if (expiry === 'clock') h.advanceTime(300_000);
    else h.timers.find((timer) => timer.delay === 300_000)();
    let reply;
    h.send({ type: 'take-draft', handoffId }, (value) => {
      reply = value;
    });
    assert.match(reply.error, /expired or was already used/);
  }
});

test('older draft expiry cannot erase a newer transfer and replacement retires the old UUID', async () => {
  const h = harness();
  h.load();
  const first = await captureDraft(h, 'First original');
  const oldTimer = h.timers.find((timer) => timer.delay === 300_000);
  const second = await captureDraft(h, 'Second original');
  assert.notEqual(first, second);
  oldTimer();
  let reply;
  h.send({ type: 'take-draft', handoffId: first }, (value) => {
    reply = value;
  });
  assert.ok(reply.error);
  h.send({ type: 'take-draft', handoffId: second }, (value) => {
    reply = value;
  });
  assert.equal(reply.text, 'Second original');
});

test('broker failure erases an unused original snapshot', async () => {
  const h = harness();
  h.load();
  h.editor.textContent = 'A snapshot';
  h.fire('click');
  const opened = h.noticeDetails.at(-1).onAction();
  const handoffId = h.workspaceMessages.at(-1).handoffId;
  const rejected = assert.rejects(opened, /Private workspace unavailable/);
  h.workspaceRequests.shift()({ error: 'Broker unavailable' });
  await rejected;
  let reply;
  h.send({ type: 'take-draft', handoffId }, (value) => {
    reply = value;
  });
  assert.ok(reply.error);
});

test('empty original drafts open a private workspace without transferring a nonce or provider text', async () => {
  const h = harness();
  h.load();
  h.fire('click');
  const opened = h.noticeDetails.at(-1).onAction();
  assert.deepEqual(h.workspaceMessages.at(-1), { type: 'open-workspace' });
  h.workspaceRequests.shift()({ ok: true });
  await opened;
  assert.equal(h.timers.length, 0);
});

test('ambiguous, inaccessible retained and oversized originals explain why import cannot safely proceed', async () => {
  for (const reason of ['ambiguous', 'inaccessible', 'oversized', 'no-crypto']) {
    const h = harness();
    h.load();
    h.editor.textContent = 'Retained original';
    h.fire('click');
    if (reason === 'ambiguous')
      h.dom.resolveComposer = () => {
        throw new Error('Ambiguous message composer: 2 targets match.');
      };
    if (reason === 'inaccessible')
      h.dom.resolveComposer = () => {
        throw new Error('No accessible message composer was found.');
      };
    if (reason === 'oversized') h.editor.textContent = 'x'.repeat(1_000_001);
    if (reason === 'no-crypto') h.context.crypto = undefined;
    const original = h.editor.textContent;
    await assert.rejects(h.noticeDetails.at(-1).onAction());
    assert.equal(h.noticeDetails.at(-1).title, 'Your draft stays on this page');
    assert.match(h.noticeDetails.at(-1).message, /toolbar.*private workspace/);
    assert.equal(h.workspaceMessages.length, 0);
    assert.equal(h.editor.textContent, original);
    assert.equal(h.clicks, 0);
  }
});

test('missing send discovery is optional only before sanitized input, never at final confirmation', () => {
  const h = harness();
  h.load();
  h.elements.button = null;
  h.editor.dispatchEvent = () => {
    h.elements.button = h.button;
  };
  const result = h.handoff();
  h.timers.shift()();
  assert.equal(h.sendResolutions[0].allowMissing, true);
  assert.ok(h.sendResolutions.length > 1);
  assert.ok(h.sendResolutions.slice(1).every((options) => options.allowMissing !== true));
  assert.equal(result.value.ok, true);
});

test('ambiguous send discovery fails before modifying the provider composer', () => {
  const h = harness();
  h.load();
  h.dom.resolveSend = () => {
    throw new Error('Ambiguous send control: 2 accessible targets match.');
  };
  const result = h.handoff();
  assert.match(result.value.error, /Ambiguous send control/);
  assert.equal(h.editor.textContent, '');
  assert.equal(h.timers.length, 0);
});

test('startup and unavailable policy explain blocked intent using a modal at click or Enter', () => {
  const h = harness();
  assert.ok(h.fire('pointerdown').blocked);
  assert.ok(h.fire('mouseup').blocked);
  assert.equal(h.noticeDetails.length, 0);
  assert.ok(h.fire('click').blocked);
  assert.match(h.noticeDetails.at(-1).message, /Protection is loading/);
  assert.equal(h.noticeDetails.at(-1).title, 'Review before sending');
  h.fail();
  assert.ok(h.fire('keydown', h.editor, { key: 'Enter' }).blocked);
  assert.match(h.noticeDetails.at(-1).message, /policy is unavailable/);
});

test('pointer and touch preparation do not open a modal that the same gesture could dismiss', () => {
  const h = harness();
  h.load();
  for (const type of [
    'pointerdown',
    'pointerup',
    'mousedown',
    'mouseup',
    'touchstart',
    'touchend',
  ]) {
    assert.ok(h.fire(type).blocked);
  }
  assert.equal(h.noticeDetails.length, 0);
  h.fire('click');
  assert.equal(h.noticeDetails.length, 1);
});

test('modal workspace action waits for successful Chrome or Firefox broker acknowledgement', async () => {
  for (const firefox of [false, true]) {
    const h = harness({ firefox });
    h.load();
    await Promise.resolve();
    h.fire('click');
    const action = h.noticeDetails.at(-1).onAction();
    assert.equal(typeof action.then, 'function');
    assert.equal(h.workspaceRequests.length, 1);
    h.workspaceRequests.shift()({ ok: true });
    assert.equal((await action).ok, true);
  }
});

test('modal workspace action rejects broker error replies rather than silently closing', async () => {
  for (const firefox of [false, true]) {
    const h = harness({ firefox });
    h.load();
    await Promise.resolve();
    h.fire('click');
    const action = h.noticeDetails.at(-1).onAction();
    const rejected = assert.rejects(action, /Private workspace unavailable/);
    h.workspaceRequests.shift()({ error: 'Workspace unavailable.' });
    await rejected;
  }
});

test('keyboard discovery failures block the gesture and show policy failure', () => {
  const h = harness();
  h.load();
  h.dom.isUploadControl = () => {
    throw new Error('DOM discovery failed.');
  };
  const event = h.fire('keydown', h.editor, { key: 'Enter' });
  assert.ok(event.blocked);
  assert.match(h.noticeDetails.at(-1).message, /policy is unavailable/);
});

test('same-URL private windows cannot cancel another workspace UUID handoff', () => {
  const h = harness();
  h.load();
  const firstId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const secondId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  let result;
  h.send({ type: 'send-sanitized', text: 'safe', workspaceId: firstId }, (value) => {
    result = value;
  });
  h.send({ type: 'cancel-handoff', workspaceId: secondId }, () => {});
  h.timers.shift()();
  assert.equal(result.ok, true);
  assert.equal(h.clicks, 1);
});

test('workspace UUID owner can cancel its own handoff without browser document identity', () => {
  const h = harness();
  h.load();
  const workspaceId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  let result;
  h.send({ type: 'send-sanitized', text: 'safe', workspaceId }, (value) => {
    result = value;
  });
  h.send({ type: 'cancel-handoff', workspaceId }, () => {});
  h.timers.shift()();
  assert.match(result.error, /canceled/);
  assert.equal(h.clicks, 0);
});

test('browser document identity separates same-URL windows even with an identical workspace UUID', () => {
  const h = harness();
  h.load();
  const workspaceId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const first = { ...h.sender, documentId: 'document-one' };
  const second = { ...h.sender, documentId: 'document-two' };
  let result;
  h.send(
    { type: 'send-sanitized', text: 'safe', workspaceId },
    (value) => {
      result = value;
    },
    first,
  );
  h.send({ type: 'cancel-handoff', workspaceId }, () => {}, second);
  h.timers.shift()();
  assert.equal(result.ok, true);
  assert.equal(h.clicks, 1);
});

test('same browser document can cancel after its application session identifier changes', () => {
  const h = harness();
  h.load();
  const sender = { ...h.sender, documentId: 'document-one' };
  let result;
  h.send(
    { type: 'send-sanitized', text: 'safe', workspaceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
    (value) => {
      result = value;
    },
    sender,
  );
  h.send(
    { type: 'cancel-handoff', workspaceId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' },
    () => {},
    sender,
  );
  h.timers.shift()();
  assert.match(result.error, /canceled/);
  assert.equal(h.clicks, 0);
});

test('a legacy URL-only cancellation cannot cancel a UUID-owned new workspace handoff', () => {
  const h = harness();
  h.load();
  let result;
  h.send(
    { type: 'send-sanitized', text: 'safe', workspaceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
    (value) => {
      result = value;
    },
  );
  h.send({ type: 'cancel-handoff' }, () => {});
  h.timers.shift()();
  assert.equal(result.ok, true);
});

test('invalid supplied workspace identifiers fail before preparing a provider draft', () => {
  const h = harness();
  h.load();
  for (const workspaceId of [null, 42, '', 'other-window', {}, []]) {
    for (const type of ['send-sanitized', 'cancel-handoff']) {
      let result;
      h.send({ type, text: 'safe', workspaceId }, (value) => {
        result = value;
      });
      assert.match(result.error, /Invalid private workspace identity/);
    }
  }
  assert.equal(h.editor.textContent, '');
  assert.equal(h.timers.length, 0);
});
