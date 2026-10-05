const BLOCKS = new Set([
  'P',
  'DIV',
  'SECTION',
  'ARTICLE',
  'LI',
  'PRE',
  'BLOCKQUOTE',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
]);
const TOKENS = /\[\[LG_[a-zA-Z0-9_-]+\]\]/g;
const MAX_EDITOR_CHARACTERS = 2_000_000;
const MAX_EDITOR_NODES = 50_000;
const oversized = () =>
  new Error('The editor content is oversized or too complex to verify. Nothing was sent.');
const tag = (node) => String(node?.tagName || node?.nodeName || '').toUpperCase();

// Editor frameworks may normalize spaces, paragraph breaks or canonically equivalent Unicode.
// Every non-whitespace character, including Markdown escapes and redaction delimiters, is retained.
export function canonicalDraftText(text) {
  return String(text ?? '')
    .normalize('NFC')
    .replace(/\s+/gu, ' ')
    .trim();
}

export function compareDraftText(actual, expected) {
  const found = String(actual ?? '').match(TOKENS) || [];
  const wanted = String(expected ?? '').match(TOKENS) || [];
  if (found.length !== wanted.length || found.some((token, index) => token !== wanted[index]))
    return { ok: false, reason: 'placeholders' };
  return canonicalDraftText(actual) === canonicalDraftText(expected)
    ? { ok: true }
    : { ok: false, reason: 'content' };
}

export function createEditorAdapter(environment = globalThis) {
  const nativeField = (editor) =>
    (typeof environment.HTMLTextAreaElement === 'function' &&
      editor instanceof environment.HTMLTextAreaElement) ||
    (typeof environment.HTMLInputElement === 'function' &&
      editor instanceof environment.HTMLInputElement) ||
    ['TEXTAREA', 'INPUT'].includes(tag(editor));
  const isEditable = (editor) =>
    nativeField(editor) ||
    editor?.isContentEditable === true ||
    ['', 'true', 'plaintext-only'].includes(editor?.getAttribute?.('contenteditable'));

  function read(editor) {
    if (!editor) return '';
    const boundedText = (value) => {
      const text = String(value ?? '');
      if (text.length > MAX_EDITOR_CHARACTERS) throw oversized();
      return text;
    };
    if (nativeField(editor)) return boundedText(editor.value);
    // textContent merges paragraphs; innerText can omit hidden values that a provider serializer reads.
    // Read the entire editable DOM, adding only semantic block/line separators.
    if (!editor.childNodes?.length)
      return boundedText(editor.textContent ?? editor.innerText ?? '');
    const chunks = [],
      stack = [{ node: editor, root: true }];
    let queuedNodes = 1,
      characters = 0;
    const append = (value) => {
      characters += value.length;
      if (characters > MAX_EDITOR_CHARACTERS) throw oversized();
      chunks.push(value);
    };
    while (stack.length) {
      const item = stack.pop();
      if (item.separator) {
        append('\n');
        continue;
      }
      const node = item.node;
      if (node.nodeType === 3 || node.nodeType === 4) {
        append(boundedText(node.nodeValue ?? node.data ?? node.textContent ?? ''));
        continue;
      }
      if (tag(node) === 'BR') {
        append('\n');
        continue;
      }
      const block = !item.root && BLOCKS.has(tag(node));
      if (block) append('\n');
      if (block) stack.push({ separator: true });
      queuedNodes += node.childNodes?.length || 0;
      if (queuedNodes > MAX_EDITOR_NODES) throw oversized();
      const descendants = Array.from(node.childNodes || []);
      for (let index = descendants.length - 1; index >= 0; index--)
        stack.push({ node: descendants[index] });
    }
    return chunks.join('');
  }

  function event(editor, type, text, cancelable = false) {
    const EventType = editor.ownerDocument?.defaultView?.InputEvent || environment.InputEvent;
    return editor.dispatchEvent(
      new EventType(type, {
        bubbles: true,
        composed: true,
        cancelable,
        inputType: 'insertText',
        data: text,
      }),
    );
  }

  function select(editor, end = false) {
    const document = editor.ownerDocument || environment.document;
    if (!document?.createRange || !document.getSelection) return;
    const selection = document.getSelection();
    if (!selection) return;
    const range = document.createRange();
    range.selectNodeContents(editor);
    if (end) range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function write(editor, text) {
    if (!isEditable(editor))
      throw new Error(
        'The current message composer is not an editable text field. Nothing was sent.',
      );
    if (nativeField(editor)) {
      const view = editor.ownerDocument?.defaultView || environment;
      const Constructor =
        tag(editor) === 'INPUT' ||
        (typeof view.HTMLInputElement === 'function' && editor instanceof view.HTMLInputElement)
          ? view.HTMLInputElement
          : view.HTMLTextAreaElement;
      const setter =
        Constructor && Object.getOwnPropertyDescriptor(Constructor.prototype, 'value')?.set;
      if (setter) setter.call(editor, text);
      else editor.value = text;
      event(editor, 'input', text);
      return;
    }
    try {
      editor.focus?.({ preventScroll: true });
    } catch {
      editor.focus?.();
    }
    select(editor);
    // A framework can handle the replacement itself. A canceled edit is verified after settling.
    if (event(editor, 'beforeinput', text, true) === false) return;
    const document = editor.ownerDocument || environment.document;
    if (
      document?.createDocumentFragment &&
      document.createElement &&
      document.createTextNode &&
      editor.replaceChildren
    ) {
      const fragment = document.createDocumentFragment();
      const lines = text.replace(/\r\n?/g, '\n').split('\n');
      const paragraphs =
        ['DIV', 'SECTION', 'ARTICLE'].includes(tag(editor)) ||
        Array.from(editor.children || []).some((child) => tag(child) === 'P');
      for (const [index, line] of lines.entries()) {
        if (paragraphs) {
          const paragraph = document.createElement('p');
          paragraph.appendChild(
            line ? document.createTextNode(line) : document.createElement('br'),
          );
          fragment.appendChild(paragraph);
        } else {
          if (index) fragment.appendChild(document.createElement('br'));
          fragment.appendChild(document.createTextNode(line));
        }
      }
      editor.replaceChildren(fragment);
    } else editor.textContent = text;
    select(editor, true);
    event(editor, 'input', text);
  }

  return {
    read,
    write,
    verify: (editor, expected) => compareDraftText(read(editor), expected),
    isEditable,
  };
}
