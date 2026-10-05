import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createSemanticDom } from '../src/extension/semantic-dom.js';

// Deliberately small standards-based DOM fake. Any use of CSS discovery fails immediately.
class Element {
  constructor(name, attributes = {}, content = '') {
    this.nodeType = 1;
    this.tagName = name.toUpperCase();
    this.attributes = { ...attributes };
    this.children = [];
    this.content = content;
    this.style = {};
    this.isConnected = true;
  }
  append(...nodes) {
    for (const node of nodes) {
      node.parentNode = this;
      node.parentElement = this;
      this.children.push(node);
    }
    return this;
  }
  getAttribute(name) {
    return this.attributes[name] ?? null;
  }
  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }
  get textContent() {
    return [this.content, ...this.children.map((node) => node.textContent)]
      .filter(Boolean)
      .join(' ');
  }
  get innerText() {
    return this.textContent;
  }
  get isContentEditable() {
    if (this.getAttribute('contenteditable') === 'false') return false;
    return (
      ['', 'true', 'plaintext-only'].includes(this.getAttribute('contenteditable')) ||
      this.parentElement?.isContentEditable === true
    );
  }
  getRootNode() {
    let root = this;
    while (root.parentNode) root = root.parentNode;
    return root;
  }
  getClientRects() {
    return this.rectless ? [] : [{}];
  }
  querySelector() {
    throw new Error('CSS discovery is forbidden.');
  }
  querySelectorAll() {
    throw new Error('CSS discovery is forbidden.');
  }
  matches() {
    throw new Error('CSS discovery is forbidden.');
  }
  closest() {
    throw new Error('CSS discovery is forbidden.');
  }
}
const element = (...args) => new Element(...args);

function documentWith(...elements) {
  const body = element('body').append(...elements);
  const html = element('html').append(body);
  const document = {
    nodeType: 9,
    children: [html],
    documentElement: html,
    body,
    defaultView: { getComputedStyle: (node) => node.style },
    querySelector() {
      throw new Error('CSS discovery is forbidden.');
    },
    querySelectorAll() {
      throw new Error('CSS discovery is forbidden.');
    },
  };
  html.parentNode = document;
  return document;
}

function shadow(host, ...elements) {
  const root = { nodeType: 11, mode: 'open', host, children: elements };
  for (const node of elements) {
    node.parentNode = root;
    node.parentElement = null;
  }
  host.shadowRoot = root;
  return root;
}

const site = { host: 'chat.example' };
const token = '[[LG_nonce_EMAIL_1]]';

test('module has no CSS discovery calls or provider-specific adapter strings', () => {
  const source = readFileSync(new URL('../src/extension/semantic-dom.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /\.(?:querySelectorAll|querySelector|matches|closest)\s*\(/);
  assert.doesNotMatch(source, /prompt-textarea|font-claude|ql-editor|data-testid/);
});

test('resolves an accessible textarea and a text-named button', () => {
  const editor = element('textarea', { placeholder: 'Ask a question' });
  const send = element('button', {}, 'Send message');
  const dom = createSemanticDom(documentWith(editor, send));
  assert.equal(dom.resolveComposer(site), editor);
  assert.equal(dom.resolveSend(site, editor), send);
});

test('discovers editable roots while ignoring inherited editing paragraphs', () => {
  const paragraph = element('p', {}, 'Draft');
  const editor = element('div', { contenteditable: 'true', role: 'textbox' }).append(paragraph);
  const dom = createSemanticDom(documentWith(editor));
  assert.equal(dom.resolveComposer(site), editor);
});

test('plaintext-only editing hosts are supported', () => {
  const editor = element('div', { contenteditable: 'plaintext-only' });
  assert.equal(createSemanticDom(documentWith(editor)).resolveComposer(site), editor);
});

test('a role without an editable host cannot become a composer', () => {
  const dom = createSemanticDom(documentWith(element('div', { role: 'textbox' })));
  assert.throws(() => dom.resolveComposer(site), /No accessible message composer/);
});

test('rejects competing composers instead of selecting the first', () => {
  const dom = createSemanticDom(documentWith(element('textarea'), element('textarea')));
  assert.throws(() => dom.resolveComposer(site), /Ambiguous message composer: 2/);
});

test('composer label hints use actual labels and literal accessible phrases', () => {
  const label = element('label', { for: 'private-editor' }, 'Message to assistant');
  const editor = element('textarea', { id: 'private-editor' });
  const search = element('input', { type: 'search', placeholder: 'Search history' });
  const dom = createSemanticDom(documentWith(label, editor, search));
  assert.equal(
    dom.resolveComposer({ ...site, labels: { composer: ['message to assistant'] } }),
    editor,
  );
  assert.throws(
    () => dom.resolveComposer({ ...site, labels: { composer: ['#private-editor'] } }),
    /No accessible/,
  );
});

test('aria-labelledby references precede aria-label and are scoped to their shadow root', () => {
  const outerLabel = element('span', { id: 'label' }, 'Search');
  const editor = element('textarea', { 'aria-labelledby': 'label', 'aria-label': 'Wrong name' });
  const host = element('div');
  shadow(host, element('span', { id: 'label' }, 'Message composer'), editor);
  const dom = createSemanticDom(documentWith(outerLabel, host));
  assert.equal(
    dom.resolveComposer({ ...site, labels: { composer: ['message composer'] } }),
    editor,
  );
});

test('wrapping labels provide accessible names', () => {
  const editor = element('textarea');
  const label = element('label', {}, 'Ask the assistant').append(editor);
  const dom = createSemanticDom(documentWith(label));
  assert.equal(
    dom.resolveComposer({ ...site, labels: { composer: ['ask the assistant'] } }),
    editor,
  );
});

test('field title and placeholder provide optional label hints', () => {
  const titled = element('textarea', { title: 'Write a prompt' });
  const other = element('textarea', { placeholder: 'Search' });
  const dom = createSemanticDom(documentWith(titled, other));
  assert.equal(dom.resolveComposer({ ...site, labels: { composer: ['write a prompt'] } }), titled);
});

test('does not use a private draft as its own accessible label', () => {
  const editor = element('div', { contenteditable: 'true' }, 'My selected label is Customer');
  const dom = createSemanticDom(documentWith(editor));
  assert.throws(
    () => dom.resolveComposer({ ...site, labels: { composer: ['customer'] } }),
    /No accessible/,
  );
});

test('form relationships distinguish a conversation composer from site search', () => {
  const editor = element('textarea');
  const send = element('button', { type: 'submit' }, 'Send');
  const form = element('form').append(editor, send);
  const searchForm = element('form').append(
    element('input', { type: 'search' }),
    element('button', {}, 'Search'),
  );
  const dom = createSemanticDom(documentWith(searchForm, form));
  assert.equal(dom.resolveComposer(site), editor);
  assert.equal(dom.resolveSend(site, editor), send);
  assert.equal(dom.nearestForm(editor), form);
});

test('form associations include controls outside their form', () => {
  const editor = element('textarea');
  const form = element('form', { id: 'conversation' }).append(editor);
  const send = element('button', { form: 'conversation' }, 'Send');
  const other = element('form').append(element('button', {}, 'Send'));
  const dom = createSemanticDom(documentWith(form, send, other));
  assert.equal(dom.nearestForm(send), form);
  assert.equal(dom.resolveSend(site, editor), send);
});

test('semantic form roles may relate custom composer controls', () => {
  const editor = element('div', { contenteditable: 'true' });
  const send = element('div', { role: 'button', 'aria-label': 'Send' });
  const form = element('section', { role: 'form' }).append(editor, send);
  const dom = createSemanticDom(documentWith(form));
  assert.equal(dom.nearestForm(editor), form);
  assert.equal(dom.resolveSend(site, editor), send);
});

test('rejects readonly, disabled, hidden, disconnected and password inputs', () => {
  const hidden = element('section', { 'aria-hidden': 'true' }).append(element('textarea'));
  const disconnected = element('textarea');
  disconnected.isConnected = false;
  const rectless = element('textarea');
  rectless.rectless = true;
  const collapsed = element('section');
  collapsed.style.display = 'none';
  collapsed.append(element('textarea'));
  const editor = element('input', { type: 'text', placeholder: 'Prompt' });
  const dom = createSemanticDom(
    documentWith(
      element('textarea', { readonly: '' }),
      element('textarea', { disabled: '' }),
      element('textarea', { 'aria-readonly': 'true' }),
      element('input', { type: 'password' }),
      hidden,
      disconnected,
      rectless,
      collapsed,
      editor,
    ),
  );
  assert.equal(dom.resolveComposer(site), editor);
});

test('a disabled send control may be discovered before the draft enables it', () => {
  const editor = element('textarea');
  const send = element('button', { 'aria-label': 'Send', disabled: '' });
  send.disabled = true;
  const dom = createSemanticDom(documentWith(editor, send));
  assert.equal(dom.resolveSend(site, editor), send);
});

test('later send controls are discovered dynamically', () => {
  const editor = element('textarea');
  const document = documentWith(editor);
  const dom = createSemanticDom(document);
  assert.throws(() => dom.resolveSend(site, editor), /No accessible send control/);
  const send = element('button', { 'aria-label': 'Send message (Enter)' });
  document.body.append(send);
  assert.equal(dom.resolveSend(site, editor), send);
});

test('optional send discovery allows a missing control but still rejects ambiguity', () => {
  const editor = element('textarea');
  const document = documentWith(editor);
  const dom = createSemanticDom(document);
  assert.equal(dom.resolveSend(site, editor, { allowMissing: true }), null);
  assert.throws(() => dom.resolveSend(site, editor), /No accessible send control/);
  document.body.append(element('button', {}, 'Send'), element('button', {}, 'Send'));
  assert.throws(
    () => dom.resolveSend(site, editor, { allowMissing: true }),
    /Ambiguous send control/,
  );
});

test('rejects ambiguous sends including duplicates within a form', () => {
  const editor = element('textarea');
  const form = element('form').append(
    editor,
    element('button', {}, 'Send'),
    element('button', {}, 'Send'),
  );
  const dom = createSemanticDom(documentWith(form));
  assert.throws(() => dom.resolveSend(site, editor), /Ambiguous send control: 2/);
});

test('custom send hints select a literal accessible action', () => {
  const editor = element('textarea');
  const run = element('button', { 'aria-label': 'Run assistant prompt' });
  const dom = createSemanticDom(documentWith(editor, run, element('button', {}, 'Send feedback')));
  assert.equal(
    dom.resolveSend({ ...site, labels: { send: ['run assistant prompt'] } }, editor),
    run,
  );
  assert.equal(dom.isSendControl(element('button', {}, 'Send feedback'), site), false);
});

test('unnamed explicit native submit controls work without inventing a provider name', () => {
  const editor = element('textarea');
  const send = element('input', { type: 'submit' });
  const dom = createSemanticDom(documentWith(element('form').append(editor, send)));
  assert.equal(dom.resolveSend(site, editor), send);
});

test('unnamed native and role buttons are guarded even when configured hints cannot resolve a composer', () => {
  const dom = createSemanticDom(documentWith());
  const configured = { ...site, labels: { composer: ['Message'], send: ['Send message'] } };
  for (const control of [
    element('button'),
    element('input', { type: 'button' }),
    element('div', { role: 'button' }),
  ])
    assert.equal(dom.isSendControl(control, configured), true);
});

test('multiple unnamed controls are rejected while an explicitly named send is preferred', () => {
  const editor = element('textarea');
  const document = documentWith(editor, element('button'), element('div', { role: 'button' }));
  const dom = createSemanticDom(document);
  assert.throws(() => dom.resolveSend(site, editor), /Ambiguous send control: 2/);
  const send = element('button', { 'aria-label': 'Send' });
  document.body.append(send);
  assert.equal(dom.resolveSend(site, editor), send);
});

test('known native send labels remain guarded even when hints specify a custom action', () => {
  const dom = createSemanticDom(documentWith());
  assert.equal(
    dom.isSendControl(element('button', {}, 'Send'), { ...site, labels: { send: ['Run prompt'] } }),
    true,
  );
});

test('multilingual send labels include Russian and CIS languages', () => {
  const dom = createSemanticDom(documentWith());
  for (const label of [
    'Send',
    'Отправить',
    'послать',
    'Надіслати',
    'жіберу',
    'göndər',
    'yuborish',
    'trimite mesajul',
    'жөнөтүү',
    'фиристодан',
    'ուղարկել',
    'адпраўіць',
    'Senden',
    'Envoyer',
    '发送',
    '送信',
    '보내기',
  ])
    assert.equal(dom.isSendControl(element('button', { 'aria-label': label }), site), true, label);
});

test('traverses open shadow roots and discovers their controls', () => {
  const host = element('provider-chat');
  const editor = element('textarea');
  const send = element('button', {}, 'Send');
  shadow(host, element('form').append(editor, send));
  const dom = createSemanticDom(documentWith(host));
  assert.equal(dom.resolveComposer(site), editor);
  assert.equal(dom.resolveSend(site, editor), send);
  assert.ok(dom.nodes().includes(editor));
});

test('does not enter closed roots or the extension modal subtree', () => {
  const privateEditor = element('textarea');
  const privateSend = element('button', {}, 'Send');
  const modal = element('div', { 'data-ai-leak-guard-root': '' }).append(
    privateEditor,
    privateSend,
  );
  const closedHost = element('div');
  shadow(closedHost, element('textarea')).mode = 'closed';
  const editor = element('textarea');
  const dom = createSemanticDom(documentWith(modal, closedHost, editor));
  assert.equal(dom.resolveComposer(site), editor);
  assert.equal(dom.nodes().includes(privateEditor), false);
  assert.equal(dom.isSendControl(privateSend, site), false);
});

test('event control resolution crosses text nodes and shadow boundaries without CSS', () => {
  const send = element('button', {}, 'Send');
  const icon = element('span');
  send.append(icon);
  const target = { nodeType: 3, parentNode: icon, parentElement: icon };
  const host = element('div');
  shadow(host, send);
  const dom = createSemanticDom(documentWith(host));
  assert.equal(
    dom.controlFromEvent({ target }, (node) => dom.isSendControl(node, site)),
    send,
  );
  assert.equal(
    dom.controlFromEvent({ target: host, composedPath: () => [target, icon, send, host] }, (node) =>
      dom.isSendControl(node, site),
    ),
    send,
  );
});

test('upload discovery handles native inputs, associated labels and accessible upload actions', () => {
  const input = element('input', { id: 'files', type: 'file', hidden: '' });
  const label = element('label', { for: 'files' }, 'Choose documents');
  const dom = createSemanticDom(documentWith(input, label));
  assert.equal(dom.isUploadControl(input), true);
  assert.equal(dom.isUploadControl(label), true);
  assert.equal(dom.isUploadControl(element('button', { 'aria-label': 'Attach files' })), true);
  assert.equal(dom.isUploadControl(element('button', { 'aria-label': 'Прикрепить файл' })), true);
  assert.equal(dom.isUploadControl(element('button', {}, 'Copy answer')), false);
});

test('selected files include hidden and shadow file inputs but exclude private modal inputs', () => {
  const input = element('input', { type: 'file', hidden: '' });
  input.files = [{ name: 'private.csv' }];
  const host = element('div');
  shadow(host, input);
  const dom = createSemanticDom(documentWith(host));
  assert.equal(dom.selectedFiles(), true);
  input.files = [];
  assert.equal(dom.selectedFiles(), false);
  const privateInput = element('input', { type: 'file' });
  privateInput.files = [{}];
  host.append(element('div', { 'data-ai-leak-guard-root': '' }).append(privateInput));
  assert.equal(dom.selectedFiles(), false);
});

test('reads semantic assistant responses and excludes user messages and drafts', () => {
  const user = element('div', { 'data-message-author-role': 'user' }, `My email is ${token}`);
  const assistant = element(
    'article',
    { 'data-message-author-role': 'assistant' },
    `Hello ${token}`,
  );
  const draft = element('textarea', {}, `Current private draft ${token}`);
  const dom = createSemanticDom(documentWith(user, assistant, draft));
  assert.deepEqual(dom.readResponses(site), [`Hello ${token}`]);
});

test('accessible assistant regions and heading containers identify responses', () => {
  const region = element(
    'section',
    { role: 'region', 'aria-label': 'Assistant response' },
    'First answer',
  );
  const article = element('article').append(
    element('h2', {}, 'Assistant'),
    element('p', {}, 'Second answer'),
  );
  const dom = createSemanticDom(documentWith(region, article));
  assert.deepEqual(dom.readResponses(site), ['First answer', 'Assistant Second answer']);
});

test('native articles and explicitly named regions identify ordinary responses without placeholders', () => {
  const article = element('article', { 'aria-label': 'Assistant response' }, 'An ordinary answer');
  const region = element('div', { 'aria-label': 'AI response' }, 'A second answer');
  const dom = createSemanticDom(documentWith(article, region));
  assert.deepEqual(dom.readResponses(site), ['An ordinary answer', 'A second answer']);
});

test('response hints match semantic labels instead of provider classes', () => {
  const response = element('section', { 'aria-label': 'Generated answer' }, 'Answer text');
  const decoy = element('div', { class: 'generated-answer' }, 'Do not select this');
  const dom = createSemanticDom(documentWith(response, decoy));
  assert.deepEqual(dom.readResponses({ ...site, labels: { response: ['generated answer'] } }), [
    'Answer text',
  ]);
  assert.deepEqual(dom.readResponses({ ...site, labels: { response: ['.generated-answer'] } }), []);
});

test('response wrappers containing editable drafts are never read', () => {
  const draft = element('div', { contenteditable: 'true', hidden: '' }, `Draft ${token}`);
  const wrapper = element('section', { 'data-message-author-role': 'assistant' }).append(
    element('p', {}, 'A reply'),
    draft,
  );
  assert.deepEqual(createSemanticDom(documentWith(wrapper)).readResponses(site), []);
});

test('smallest noneditable blocks containing placeholders provide a conservative fallback', () => {
  const response = element('div').append(element('p', {}, `Answer for ${token}`));
  const user = element('div', { 'data-message-author-role': 'user' }).append(
    element('p', {}, `User ${token}`),
  );
  const editor = element('div', { contenteditable: 'true' }).append(
    element('p', {}, `Draft ${token}`),
  );
  const dom = createSemanticDom(documentWith(response, user, editor));
  assert.deepEqual(dom.readResponses(site), [`Answer for ${token}`]);
});

test('fallback may be constrained to the current conversation tokens', () => {
  const otherToken = '[[LG_other_EMAIL_1]]';
  const dom = createSemanticDom(
    documentWith(element('p', {}, `Current ${token}`), element('p', {}, `Older ${otherToken}`)),
  );
  assert.deepEqual(dom.readResponses(site, [token]), [`Current ${token}`]);
});

test('nested semantic wrappers do not duplicate response text', () => {
  const inner = element(
    'section',
    { role: 'region', 'aria-label': 'Assistant response' },
    'One answer',
  );
  const outer = element('article', { 'data-message-author-role': 'assistant' }).append(inner);
  assert.deepEqual(createSemanticDom(documentWith(outer)).readResponses(site), ['One answer']);
});

test('hidden assistant text and private extension output are excluded', () => {
  const hidden = element(
    'article',
    { 'data-message-author-role': 'assistant', hidden: '' },
    'Hidden',
  );
  const modal = element('div', { 'data-ai-leak-guard-root': '' }).append(
    element('p', {}, `Private ${token}`),
  );
  const dom = createSemanticDom(documentWith(hidden, modal));
  assert.deepEqual(dom.readResponses(site), []);
});
