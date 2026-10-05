import { EDITION } from '../core/edition.js';

const CSS = `
:host { all: initial; color-scheme: light; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
:host([hidden]) { display: none !important; }
* { box-sizing: border-box; }
.overlay { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; position: fixed; inset: 0; display: grid; place-items: center; padding: 24px; background: rgba(6, 15, 30, .56); backdrop-filter: blur(7px); }
.panel { width: min(460px, 100%); position: relative; padding: 32px; border: 1px solid rgba(154, 208, 189, .28); border-radius: 24px; background: #0d1c31; color: #f2f7fa; box-shadow: 0 30px 100px rgba(0, 0, 0, .35); }
.brand { display: flex; align-items: center; gap: 9px; color: #a9e5cf; font-size: 11px; font-weight: 700; letter-spacing: .13em; }
.mark { display: grid; place-items: center; width: 28px; height: 28px; border: 1px solid #537f72; border-radius: 9px; background: #183c3b; font-size: 16px; letter-spacing: 0; }
h2 { margin: 23px 32px 12px 0; font-size: 25px; line-height: 1.25; letter-spacing: -.035em; font-weight: 650; }
p { margin: 0; color: #b9c7d6; font-size: 14px; line-height: 1.7; white-space: pre-wrap; overflow-wrap: anywhere; }
.footer { display: flex; justify-content: flex-end; gap: 10px; flex-wrap: wrap; margin-top: 28px; }
button { appearance: none; border: 1px solid #344459; border-radius: 11px; padding: 11px 16px; font: 600 13px/1.3 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; cursor: pointer; background: #17283d; color: #edf3f8; }
button:hover { background: #21364e; }
button:focus-visible, .panel:focus-visible { outline: 3px solid #a5e5cf; outline-offset: 4px; }
button:disabled { opacity: .58; cursor: wait; }
.primary { color: #092a25; background: #a5e5cf; border-color: #a5e5cf; }
.primary:hover { background: #c1f3e1; }
.close { position: absolute; right: 20px; top: 20px; display: grid; place-items: center; padding: 0; width: 30px; height: 30px; border-color: transparent; background: transparent; color: #bac7d4; font-size: 23px; font-weight: 400; line-height: 1; }
[hidden] { display: none !important; }
@media (max-width: 480px) { .overlay { padding: 16px; } .panel { padding: 26px; border-radius: 20px; } .footer { flex-direction: column-reverse; } .footer button { width: 100%; } }
@media (prefers-reduced-motion: no-preference) { .panel { animation: appear .16s ease-out; } @keyframes appear { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } } }
`;

/** Local notice UI. The provider receives neither originals nor restored values. */
export function createNoticeModal(document, options = {}) {
  const root = document.createElement('div');
  root.setAttribute('data-ai-leak-guard-root', '');
  root.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;';
  root.hidden = true;
  const shadow = root.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = CSS;
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  const dialog = document.createElement('section');
  dialog.className = 'panel';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-labelledby', 'guard-notice-title');
  dialog.setAttribute('aria-describedby', 'guard-notice-message');
  dialog.tabIndex = -1;
  const brand = document.createElement('div');
  brand.className = 'brand';
  const mark = document.createElement('span');
  mark.className = 'mark';
  mark.setAttribute('aria-hidden', 'true');
  mark.textContent = '◇';
  const brandName = document.createElement('span');
  brandName.textContent = EDITION.title.toUpperCase();
  brand.append(mark, brandName);
  const title = document.createElement('h2');
  title.id = 'guard-notice-title';
  const message = document.createElement('p');
  message.id = 'guard-notice-message';
  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'close';
  closeButton.setAttribute('aria-label', 'Dismiss privacy notice');
  closeButton.textContent = '×';
  const footer = document.createElement('div');
  footer.className = 'footer';
  const dismissButton = document.createElement('button');
  dismissButton.type = 'button';
  dismissButton.textContent = 'Dismiss';
  const actionButton = document.createElement('button');
  actionButton.type = 'button';
  actionButton.className = 'primary';
  footer.append(dismissButton, actionButton);
  dialog.append(brand, closeButton, title, message, footer);
  overlay.append(dialog);
  shadow.append(style, overlay);

  let open = false,
    destroyed = false,
    generation = 0,
    previousFocus = null,
    currentAction = null;
  const focus = (element) => {
    try {
      element?.focus({ preventScroll: true });
    } catch {
      try {
        element?.focus();
      } catch {}
    }
  };
  const controls = () =>
    [closeButton, dismissButton, actionButton].filter(
      (button) => !button.hidden && !button.disabled,
    );
  const isOwnEvent = (event) => {
    if (!event) return false;
    if (event.target === root) return true;
    return typeof event.composedPath === 'function' && event.composedPath().includes(root);
  };
  const close = () => {
    if (!open) return;
    open = false;
    generation++;
    root.hidden = true;
    currentAction = null;
    dialog.removeAttribute('aria-busy');
    const savedFocus = previousFocus;
    previousFocus = null;
    if (savedFocus && savedFocus !== root && savedFocus.isConnected !== false) focus(savedFocus);
  };
  const show = (notice = {}) => {
    if (destroyed) return false;
    if (!root.isConnected) {
      const mount = document.documentElement || document.body;
      if (!mount) return false;
      mount.append(root);
    }
    if (!open) previousFocus = document.activeElement;
    open = true;
    generation++;
    title.textContent = String(notice.title || 'Your privacy is protected');
    message.textContent = String(
      notice.message || 'Use the private workspace to review your message before sending.',
    );
    currentAction =
      typeof notice.onAction === 'function'
        ? notice.onAction
        : typeof options.onOpenWorkspace === 'function'
          ? options.onOpenWorkspace
          : null;
    actionButton.textContent = String(
      notice.actionLabel || options.actionLabel || 'Open private workspace',
    );
    actionButton.hidden = !currentAction;
    actionButton.disabled = false;
    dialog.removeAttribute('aria-busy');
    root.hidden = false;
    focus(currentAction ? actionButton : dismissButton);
    return true;
  };
  const activateAction = () => {
    if (!open || !currentAction || actionButton.disabled) return;
    const atGeneration = generation;
    const action = currentAction;
    actionButton.disabled = true;
    dialog.setAttribute('aria-busy', 'true');
    const complete = () => {
      if (open && generation === atGeneration) close();
    };
    const failed = () => {
      if (!open || generation !== atGeneration) return;
      message.textContent =
        'The private workspace could not be opened. Open it from the extension icon.';
      actionButton.disabled = false;
      dialog.removeAttribute('aria-busy');
      focus(actionButton);
    };
    try {
      const result = action(); // Keep the action within its initiating user gesture.
      if (result && typeof result.then === 'function')
        Promise.resolve(result).then(complete, failed);
      else complete();
    } catch {
      failed();
    }
  };
  const handleEvent = (event) => {
    if (!open) return;
    // Capture inside our closed root before provider bubbling listeners can send.
    // Controls are handled here because stopping capture also stops their target listeners.
    event.stopPropagation();
    if (event.type === 'submit') {
      event.preventDefault();
      return;
    }
    if (event.type === 'click') {
      event.preventDefault();
      const path = typeof event.composedPath === 'function' ? event.composedPath() : [event.target];
      if (path.includes(closeButton) || path.includes(dismissButton) || path[0] === overlay)
        close();
      else if (path.includes(actionButton)) activateAction();
      return;
    }
    if (event.type !== 'keydown') return;
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.key === 'Tab') {
      event.preventDefault();
      const buttons = controls();
      const active = shadow.activeElement;
      const index = buttons.indexOf(active);
      const next =
        index === -1
          ? event.shiftKey
            ? buttons.length - 1
            : 0
          : (index + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length;
      focus(buttons[next] || dialog);
    }
  };
  const guardedEvents = [
    'click',
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
  ];
  for (const type of guardedEvents)
    shadow.addEventListener(type, handleEvent, { capture: true, passive: false });
  const destroy = () => {
    close();
    destroyed = true;
    for (const type of guardedEvents) shadow.removeEventListener(type, handleEvent, true);
    root.remove();
  };
  return { show, close, isOwnEvent, destroy };
}
