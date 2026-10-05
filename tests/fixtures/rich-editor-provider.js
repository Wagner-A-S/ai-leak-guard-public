import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { schema } from 'prosemirror-schema-basic';

// This controlled provider fixture uses the real pinned editor library, never a live AI service.
const mount = document.getElementById('editor-mount');
const response = document.getElementById('provider-response');
const mode = document.body.dataset.fixtureMode;
const form = mount.parentElement;
let view,
  button = document.getElementById('provider-send');
let replaced = false,
  changed = false,
  replacementCount = 0;
const messages = [];
let submitCount = 0;

const updateButton = () => {
  button.disabled = !view.state.doc.textContent.trim();
};
const recordMessage = () => {
  const text = view.state.doc.textBetween(0, view.state.doc.content.size, '\n', '\n');
  messages.push(text);
  response.textContent = `Echo: ${text}`;
};
const wireButton = () =>
  button.addEventListener('click', (event) => {
    if (mode === 'chatgpt-form') return;
    event.preventDefault();
    recordMessage();
  });

function createView(state) {
  const editor = new EditorView(mount, { state, dispatchTransaction });
  editor.dom.setAttribute('role', 'textbox');
  editor.dom.setAttribute('aria-label', 'Message Claude');
  if (mode === 'chatgpt-form') {
    editor.dom.setAttribute('aria-label', 'Message ChatGPT');
    editor.dom.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        form.requestSubmit(button);
      }
    });
  }
  return editor;
}

function dispatchTransaction(transaction) {
  let state = view.state.apply(transaction);
  if (mode === 'changed-content' && !changed && state.doc.textContent.includes('[[LG_')) {
    changed = true;
    state = state.apply(
      state.tr.insertText(' Provider added unexpected content.', state.doc.content.size - 1),
    );
  }
  view.updateState(state);
  updateButton();
  if (mode === 'replace-controls' && !replaced && state.doc.textContent.includes('[[LG_')) {
    replaced = true;
    queueMicrotask(() => {
      const current = view.state;
      view.destroy();
      view = createView(current);
      const replacement = button.cloneNode(true);
      button.replaceWith(replacement);
      button = replacement;
      wireButton();
      updateButton();
      replacementCount++;
    });
  }
}

view = createView(EditorState.create({ schema }));
form.addEventListener('submit', (event) => {
  event.preventDefault();
  submitCount++;
  if (mode === 'chatgpt-form') recordMessage();
});
wireButton();
updateButton();
globalThis.richEditorFixture = {
  snapshot: () => ({
    messages: [...messages],
    paragraphs: view.state.doc.childCount,
    modelText: view.state.doc.textBetween(0, view.state.doc.content.size, '\n', '\n'),
    replacementCount,
    changed,
    submitCount,
  }),
};
