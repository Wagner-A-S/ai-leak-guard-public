import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createNoticeModal } from '../src/extension/notice-modal.js';

function dom() {
  const nodes = [],
    shadows = [];
  const document = { activeElement: null };
  class Element {
    constructor(tag) {
      this.tagName = tag;
      this.children = [];
      this.attributes = new Map();
      this.listeners = new Map();
      this.style = {};
      this.hidden = false;
      this.disabled = false;
      this.focusCalls = 0;
      this.parentNode = null;
      this.textContent = '';
      nodes.push(this);
    }
    setAttribute(key, value) {
      this.attributes.set(key, String(value));
    }
    getAttribute(key) {
      return this.attributes.get(key) ?? null;
    }
    removeAttribute(key) {
      this.attributes.delete(key);
    }
    append(...children) {
      for (const child of children) {
        child.parentNode = this;
        this.children.push(child);
      }
    }
    remove() {
      if (this.parentNode)
        this.parentNode.children = this.parentNode.children.filter((child) => child !== this);
      this.parentNode = null;
    }
    get isConnected() {
      if (this === document.documentElement || this === document.body) return true;
      if (this instanceof ShadowRoot) return this.host.isConnected;
      return !!this.parentNode?.isConnected;
    }
    attachShadow({ mode }) {
      const shadow = new ShadowRoot(this, mode);
      this.shadowRoot = mode === 'closed' ? null : shadow;
      shadows.push(shadow);
      return shadow;
    }
    focus() {
      this.focusCalls++;
      let top = this;
      while (top.parentNode) top = top.parentNode;
      if (top instanceof ShadowRoot) {
        top.activeElement = this;
        document.activeElement = top.host;
      } else document.activeElement = this;
    }
    addEventListener(type, listener, options) {
      const entries = this.listeners.get(type) || [];
      entries.push({ listener, options });
      this.listeners.set(type, entries);
    }
    removeEventListener(type, listener) {
      this.listeners.set(
        type,
        (this.listeners.get(type) || []).filter((entry) => entry.listener !== listener),
      );
    }
  }
  class ShadowRoot extends Element {
    constructor(host, mode) {
      super('#shadow-root');
      this.host = host;
      this.mode = mode;
      this.activeElement = null;
    }
  }
  document.createElement = (tag) => new Element(tag);
  document.documentElement = new Element('html');
  document.body = new Element('body');
  document.documentElement.append(document.body);
  const original = new Element('input');
  document.body.append(original);
  original.focus();
  function find(predicate) {
    return nodes.find(predicate);
  }
  function fire(type, target, properties = {}) {
    const shadow = shadows[0];
    const path = [target];
    let parent = target.parentNode;
    while (parent) {
      path.push(parent);
      parent = parent.parentNode;
    }
    path.push(shadow.host, document);
    const event = {
      type,
      target,
      composedPath: () => path,
      stopPropagation() {
        this.stopped = true;
      },
      preventDefault() {
        this.prevented = true;
      },
      ...properties,
    };
    for (const { listener } of shadow.listeners.get(type) || []) listener(event);
    return event;
  }
  return {
    document,
    nodes,
    shadows,
    original,
    find,
    fire,
    get root() {
      return find((node) => node.getAttribute('data-ai-leak-guard-root') === '');
    },
    get dialog() {
      return find((node) => node.getAttribute('role') === 'dialog');
    },
    get title() {
      return find((node) => node.id === 'guard-notice-title');
    },
    get message() {
      return find((node) => node.id === 'guard-notice-message');
    },
    get closeButton() {
      return find((node) => node.className === 'close');
    },
    get dismissButton() {
      return find((node) => node.textContent === 'Dismiss');
    },
    get actionButton() {
      return find((node) => node.className === 'primary');
    },
    get overlay() {
      return find((node) => node.className === 'overlay');
    },
    get active() {
      return shadows[0]?.activeElement;
    },
  };
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((success, failure) => {
    resolve = success;
    reject = failure;
  });
  return { promise, resolve, reject };
}

test('notice uses a marked closed shadow root and remains detached until shown', () => {
  const h = dom();
  createNoticeModal(h.document);
  assert.equal(h.shadows[0].mode, 'closed');
  assert.equal(h.root.shadowRoot, null);
  assert.equal(h.root.isConnected, false);
  assert.equal(h.root.hidden, true);
});

test('dialog has accessible semantics and renders untrusted strings as plain text', () => {
  const h = dom(),
    modal = createNoticeModal(h.document);
  const count = h.nodes.length;
  modal.show({ title: '<img src=x onerror=leak()>', message: '<script>secret()</script>' });
  assert.equal(h.dialog.getAttribute('aria-modal'), 'true');
  assert.equal(h.dialog.getAttribute('aria-labelledby'), h.title.id);
  assert.equal(h.dialog.getAttribute('aria-describedby'), h.message.id);
  assert.equal(h.title.textContent, '<img src=x onerror=leak()>');
  assert.equal(h.message.textContent, '<script>secret()</script>');
  assert.equal(h.nodes.length, count);
  assert.equal(h.active, h.dismissButton);
  assert.equal(h.actionButton.hidden, true);
});

test('primary action receives initial focus, runs once, closes, and restores original focus', () => {
  const h = dom(),
    modal = createNoticeModal(h.document);
  let actions = 0;
  modal.show({
    title: 'Send privately',
    message: 'Open the workspace.',
    actionLabel: 'Review privately',
    onAction: () => {
      actions++;
    },
  });
  assert.equal(h.active, h.actionButton);
  assert.equal(h.actionButton.textContent, 'Review privately');
  const event = h.fire('click', h.actionButton);
  assert.ok(event.stopped && event.prevented);
  assert.equal(actions, 1);
  assert.equal(h.root.hidden, true);
  assert.equal(h.document.activeElement, h.original);
});

test('optional default workspace action is available without repeating it on each notice', () => {
  const h = dom();
  let actions = 0;
  const modal = createNoticeModal(h.document, {
    onOpenWorkspace: () => {
      actions++;
    },
    actionLabel: 'Private workspace',
  });
  modal.show({ title: 'Protected', message: 'Use the extension.' });
  assert.equal(h.actionButton.textContent, 'Private workspace');
  h.fire('click', h.actionButton);
  assert.equal(actions, 1);
});

test('Tab and Shift+Tab cycle inside visible controls', () => {
  const h = dom(),
    modal = createNoticeModal(h.document);
  modal.show({ onAction() {} });
  let event = h.fire('keydown', h.actionButton, { key: 'Tab' });
  assert.ok(event.stopped && event.prevented);
  assert.equal(h.active, h.closeButton);
  h.fire('keydown', h.closeButton, { key: 'Tab', shiftKey: true });
  assert.equal(h.active, h.actionButton);
  h.fire('keydown', h.actionButton, { key: 'Tab', shiftKey: true });
  assert.equal(h.active, h.dismissButton);
  h.fire('keydown', h.dismissButton, { key: 'Tab', shiftKey: true });
  assert.equal(h.active, h.closeButton);
});

test('focus trapping excludes an absent primary action and handles unknown focus', () => {
  const h = dom(),
    modal = createNoticeModal(h.document);
  modal.show();
  h.fire('keydown', h.dismissButton, { key: 'Tab' });
  assert.equal(h.active, h.closeButton);
  h.fire('keydown', h.closeButton, { key: 'Tab', shiftKey: true });
  assert.equal(h.active, h.dismissButton);
  h.dialog.focus();
  h.fire('keydown', h.dialog, { key: 'Tab' });
  assert.equal(h.active, h.closeButton);
});

test('Escape dismisses the modal and restores the prior provider focus', () => {
  const h = dom(),
    modal = createNoticeModal(h.document);
  modal.show();
  const event = h.fire('keydown', h.dismissButton, { key: 'Escape' });
  assert.ok(event.stopped && event.prevented);
  assert.equal(h.root.hidden, true);
  assert.equal(h.document.activeElement, h.original);
});

test('dismiss button, close icon descendants, and direct backdrop clicks dismiss', () => {
  const h = dom(),
    modal = createNoticeModal(h.document);
  for (const target of [h.dismissButton, h.closeButton, h.overlay]) {
    modal.show();
    h.fire('click', target);
    assert.equal(h.root.hidden, true);
    assert.equal(h.document.activeElement, h.original);
  }
  modal.show();
  const descendant = h.document.createElement('span');
  h.closeButton.append(descendant);
  h.fire('click', descendant);
  assert.equal(h.root.hidden, true);
});

test('clicking dialog content does not dismiss', () => {
  const h = dom(),
    modal = createNoticeModal(h.document);
  modal.show();
  const event = h.fire('click', h.message);
  assert.ok(event.stopped && event.prevented);
  assert.equal(h.root.hidden, false);
});

test('own capture listeners contain click, pointer, touch, keyboard, and form events', () => {
  const h = dom(),
    modal = createNoticeModal(h.document);
  modal.show();
  for (const type of [
    'auxclick',
    'pointerdown',
    'pointerup',
    'mousedown',
    'mouseup',
    'touchstart',
    'touchend',
    'keydown',
    'keypress',
    'keyup',
    'submit',
  ]) {
    const event = h.fire(type, h.message, { key: 'Enter' });
    assert.ok(event.stopped, type);
    assert.equal(h.shadows[0].listeners.get(type)[0].options.capture, true);
    assert.equal(h.shadows[0].listeners.get(type)[0].options.passive, false);
    if (type === 'submit') assert.ok(event.prevented);
  }
});

test('closed-root event classification lets provider guards ignore extension-owned events', () => {
  const h = dom(),
    modal = createNoticeModal(h.document);
  assert.equal(modal.isOwnEvent({ target: h.root }), true);
  assert.equal(
    modal.isOwnEvent({ target: h.original, composedPath: () => [h.original, h.root, h.document] }),
    true,
  );
  assert.equal(
    modal.isOwnEvent({ target: h.original, composedPath: () => [h.original, h.document] }),
    false,
  );
  assert.equal(modal.isOwnEvent({ target: h.original }), false);
  assert.equal(modal.isOwnEvent(null), false);
});

test('updating an open notice retains the original focus restoration target', () => {
  const h = dom(),
    modal = createNoticeModal(h.document);
  modal.show({ title: 'First' });
  modal.show({ title: 'Updated' });
  modal.close();
  assert.equal(h.document.activeElement, h.original);
  assert.equal(h.title.textContent, 'Updated');
});

test('asynchronous primary action disables duplicates and closes after success', async () => {
  const h = dom(),
    gate = deferred(),
    modal = createNoticeModal(h.document);
  let actions = 0;
  modal.show({
    onAction() {
      actions++;
      return gate.promise;
    },
  });
  h.fire('click', h.actionButton);
  h.fire('click', h.actionButton);
  assert.equal(actions, 1);
  assert.equal(h.actionButton.disabled, true);
  assert.equal(h.dialog.getAttribute('aria-busy'), 'true');
  h.fire('keydown', h.actionButton, { key: 'Tab' });
  assert.equal(h.active, h.closeButton);
  gate.resolve();
  await Promise.resolve();
  assert.equal(h.root.hidden, true);
  assert.equal(h.document.activeElement, h.original);
});

test('failed primary action shows a local recovery message without exposing error details', async () => {
  const h = dom(),
    gate = deferred(),
    modal = createNoticeModal(h.document);
  modal.show({ onAction: () => gate.promise });
  h.fire('click', h.actionButton);
  gate.reject(new Error('Sensitive internal data'));
  await Promise.resolve();
  assert.equal(h.root.hidden, false);
  assert.equal(h.actionButton.disabled, false);
  assert.match(h.message.textContent, /extension icon/);
  assert.ok(!h.message.textContent.includes('Sensitive internal data'));
  assert.equal(h.active, h.actionButton);
});

test('an older action completion cannot dismiss a newer notice', async () => {
  const h = dom(),
    gate = deferred(),
    modal = createNoticeModal(h.document);
  modal.show({ onAction: () => gate.promise });
  h.fire('click', h.actionButton);
  modal.close();
  modal.show({ title: 'New notice' });
  gate.resolve();
  await Promise.resolve();
  assert.equal(h.root.hidden, false);
  assert.equal(h.title.textContent, 'New notice');
});

test('destroy removes the root and handlers and prevents further display', () => {
  const h = dom(),
    modal = createNoticeModal(h.document);
  modal.show();
  modal.destroy();
  assert.equal(h.root.isConnected, false);
  assert.equal(h.document.activeElement, h.original);
  assert.ok([...h.shadows[0].listeners.values()].every((listeners) => listeners.length === 0));
  assert.equal(modal.show(), false);
});

test('closing does not attempt to focus a removed provider control', () => {
  const h = dom(),
    modal = createNoticeModal(h.document);
  modal.show();
  h.original.remove();
  modal.close();
  assert.equal(h.original.focusCalls, 1);
});

test('document-start creation can wait until a document mount exists', () => {
  const h = dom(),
    mount = h.document.documentElement;
  h.document.documentElement = null;
  h.document.body = null;
  const modal = createNoticeModal(h.document);
  assert.equal(modal.show(), false);
  h.document.documentElement = mount;
  assert.equal(modal.show(), true);
});

test('module has no provider-selector APIs, unsafe HTML writes, native dialogs, or network calls', () => {
  const source = readFileSync(new URL('../src/extension/notice-modal.js', import.meta.url), 'utf8');
  assert.doesNotMatch(
    source,
    /\b(?:querySelector(?:All)?|matches|closest|alert|confirm|prompt|fetch)\s*\(/,
  );
  assert.doesNotMatch(source, /innerHTML|outerHTML|XMLHttpRequest/);
});
