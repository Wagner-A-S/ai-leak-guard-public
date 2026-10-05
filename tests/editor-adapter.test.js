import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  canonicalDraftText,
  compareDraftText,
  createEditorAdapter,
} from '../src/extension/editor-adapter.js';

const token = '[[LG_session_NAME_1]]';
const other = '[[LG_session_EMAIL_2]]';

function fixture() {
  class Node {
    constructor(name = '', type = 1, value = '') {
      this.tagName = name.toUpperCase();
      this.nodeType = type;
      this.nodeValue = value;
      this.childNodes = [];
      this.ownerDocument = document;
    }
    get children() {
      return this.childNodes.filter((node) => node.nodeType === 1);
    }
    get textContent() {
      return this.nodeType === 3
        ? this.nodeValue
        : this.childNodes.map((node) => node.textContent).join('');
    }
    set textContent(value) {
      this.replaceChildren(document.createTextNode(value));
    }
    appendChild(node) {
      node.parentNode = this;
      this.childNodes.push(node);
      return node;
    }
    replaceChildren(...nodes) {
      this.childNodes = [];
      for (const node of nodes) {
        if (node.nodeType === 11) for (const child of node.childNodes) this.appendChild(child);
        else this.appendChild(node);
      }
    }
  }
  const document = {
    createElement: (tag) => new Node(tag),
    createTextNode: (text) => new Node('', 3, text),
    createDocumentFragment: () => new Node('', 11),
  };
  const environment = {
    document,
    InputEvent: class {
      constructor(type, init) {
        this.type = type;
        Object.assign(this, init);
      }
    },
  };
  const editor = document.createElement('div');
  editor.isContentEditable = true;
  editor.events = [];
  editor.dispatchEvent = (event) => {
    editor.events.push(event);
    return editor.onEvent?.(event) !== false;
  };
  const adapter = createEditorAdapter(environment);
  return { document, editor, adapter };
}

test('canonical comparison accepts paragraph whitespace and NFC, retaining all literal punctuation', () => {
  assert.equal(canonicalDraftText('  Cafe\u0301\r\n\tStraße\u00a0 12  '), 'Café Straße 12');
  assert.deepEqual(compareDraftText(`Name:\\ ${token}\n\nCafé`, `Name:\\ ${token}\r\nCafe\u0301`), {
    ok: true,
  });
  assert.deepEqual(compareDraftText(`Name: ${token}`, `Name:\\ ${token}`), {
    ok: false,
    reason: 'content',
  });
  assert.deepEqual(compareDraftText(`name: ${token}`, `Name: ${token}`), {
    ok: false,
    reason: 'content',
  });
});

test('placeholder count, order and delimiters must survive editor normalization', () => {
  const expected = `${token}\n${other}`;
  for (const actual of [
    `${other} ${token}`,
    token,
    `${expected} ${token}`,
    expected.replace('[[LG_', '[LG_'),
  ])
    assert.deepEqual(compareDraftText(actual, expected), { ok: false, reason: 'placeholders' });
});

test('paragraph and BR boundaries are read without concatenating adjacent fields', () => {
  const { document, editor, adapter } = fixture();
  const first = document.createElement('p');
  first.textContent = `Name: ${token}`;
  const second = document.createElement('p');
  second.appendChild(document.createTextNode('Address: '));
  second.appendChild(document.createElement('br'));
  second.appendChild(document.createTextNode(other));
  editor.appendChild(first);
  editor.appendChild(second);
  assert.equal(editor.textContent, `Name: ${token}Address: ${other}`);
  assert.deepEqual(adapter.verify(editor, `Name: ${token}\nAddress:\n${other}`), { ok: true });
});

test('structured writes preserve blank lines, literal Markdown escapes and tokens without parsing HTML', () => {
  const { editor, adapter } = fixture();
  const expected = `Name\\: ${token}\n\n**Address**: ${other}\n<img src=x onerror=leak()>`;
  adapter.write(editor, expected);
  assert.equal(editor.children.length, 4);
  assert.ok(editor.children.every((node) => node.tagName === 'P'));
  assert.equal(editor.children[1].children[0].tagName, 'BR');
  assert.ok(!editor.children.some((node) => node.tagName === 'IMG'));
  assert.deepEqual(adapter.verify(editor, expected), { ok: true });
  assert.deepEqual(
    editor.events.map((event) => event.type),
    ['beforeinput', 'input'],
  );
  assert.equal(editor.events.at(-1).data, expected);
});

test('inline editing hosts use BR separators without nesting paragraph elements', () => {
  const { document, adapter } = fixture();
  const editor = document.createElement('span');
  editor.isContentEditable = true;
  editor.dispatchEvent = () => true;
  adapter.write(editor, `First ${token}\nSecond ${other}`);
  assert.deepEqual(
    editor.children.map((node) => node.tagName),
    ['BR'],
  );
  assert.deepEqual(adapter.verify(editor, `First ${token}\nSecond ${other}`), { ok: true });
});

test('hidden appended text is included in verification even if rendered innerText looks safe', () => {
  const { document, editor, adapter } = fixture();
  adapter.write(editor, token);
  editor.innerText = token;
  const hidden = document.createElement('span');
  hidden.hidden = true;
  hidden.textContent = ' Original raw value';
  editor.appendChild(hidden);
  assert.deepEqual(adapter.verify(editor, token), { ok: false, reason: 'content' });
});

test('beforeinput handling can own the replacement without a second DOM mutation', () => {
  const { editor, adapter } = fixture();
  editor.onEvent = (event) => {
    editor.textContent = event.data;
    return false;
  };
  adapter.write(editor, token);
  assert.deepEqual(adapter.verify(editor, token), { ok: true });
  assert.deepEqual(
    editor.events.map((event) => event.type),
    ['beforeinput'],
  );
});

test('a canceled edit that discards text never passes verification', () => {
  const { editor, adapter } = fixture();
  editor.onEvent = () => false;
  adapter.write(editor, token);
  assert.deepEqual(adapter.verify(editor, token), { ok: false, reason: 'placeholders' });
});

test('framework native value setters still receive one input event', () => {
  class TextArea {
    get value() {
      return this.text || '';
    }
    set value(value) {
      this.text = value;
      this.writes = (this.writes || 0) + 1;
    }
  }
  const events = [],
    editor = new TextArea();
  editor.dispatchEvent = (event) => events.push(event);
  const adapter = createEditorAdapter({
    HTMLTextAreaElement: TextArea,
    InputEvent: class {
      constructor(type, init) {
        this.type = type;
        Object.assign(this, init);
      }
    },
  });
  adapter.write(editor, `${token}\n${other}`);
  assert.equal(editor.writes, 1);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'input');
  assert.deepEqual(adapter.verify(editor, `${token}\n${other}`), { ok: true });
});

test('adapter does not use CSS discovery, HTML parsing or provider-specific framework internals', () => {
  const source = readFileSync(
    new URL('../src/extension/editor-adapter.js', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(source, /\.(?:querySelectorAll|querySelector|matches|closest)\s*\(/);
  assert.doesNotMatch(source, /innerHTML\s*=|execCommand|\.editorView|\.view\.dispatch/);
});

test('oversized hidden text and excessively complex editor trees fail closed before comparison', () => {
  const { document, editor, adapter } = fixture();
  const hidden = document.createElement('span');
  hidden.hidden = true;
  hidden.textContent = 'x'.repeat(2_000_001);
  editor.appendChild(hidden);
  assert.throws(() => adapter.verify(editor, token), /oversized or too complex.*Nothing was sent/);
  editor.childNodes = Array(50_001).fill(document.createTextNode(''));
  assert.throws(() => adapter.read(editor), /oversized or too complex/);
});
