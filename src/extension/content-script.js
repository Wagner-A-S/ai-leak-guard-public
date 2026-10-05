import { createSemanticDom } from './semantic-dom.js';
import { createNoticeModal } from './notice-modal.js';
import { EXTENSION_VERSION } from '../core/build-info.js';
import { createEditorAdapter } from './editor-adapter.js';

const INSTALLATION_KEY = '__aiLeakGuardContentGuard';
const DRAFT_LIFETIME_MS = 5 * 60_000;
const MAX_DRAFT_LENGTH = 1_000_000;
const UUID_PATTERN = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;
const SEND_TIMEOUT_MS = 2_000;
const SEND_SETTLE_MS = 70;
const SEND_POLL_MS = 100;

export function installContentGuard(environment = globalThis, dependencies = {}) {
  const api = environment.browser || environment.chrome;
  // Reuse the current runtime; replace older versions without retaining their listeners/vault.
  const existing = environment[INSTALLATION_KEY];
  if (existing?.version === EXTENSION_VERSION && existing.runtime === api.runtime) return existing;
  existing?.destroy?.();
  const { document, location, setTimeout } = environment;
  // Window capture precedes provider document-capture send handlers.
  const eventTarget = document.defaultView || document;
  const dom = dependencies.dom || createSemanticDom(document);
  const modal = dependencies.modal || createNoticeModal(document);
  const editors = dependencies.editors || createEditorAdapter(environment);
  const runtime = api.runtime;
  const workspaceUrl = runtime.getURL('src/ui/workspace.html');
  let site = null,
    ready = false,
    failed = false;
  let revision = 0,
    permit = null,
    pending = null,
    capturedDraft = null,
    destroyed = false;
  const eventRegistrations = [],
    scheduledTimers = new Set();
  const addGuardListener = (type, callback, options) => {
    const listener = (event) => {
      if (!destroyed) callback(event);
    };
    eventTarget.addEventListener(type, listener, options);
    eventRegistrations.push({ type, listener, options });
  };
  const schedule = (callback, delay) => {
    const timer = setTimeout(() => {
      scheduledTimers.delete(timer);
      if (!destroyed) callback();
    }, delay);
    scheduledTimers.add(timer);
    return timer;
  };
  const now = dependencies.now || (() => Date.now());
  const block = (event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  const originalDraftText = (editor) =>
    String('value' in editor ? editor.value : (editor.innerText ?? editor.textContent ?? ''));
  const potentialEditor = (node) => {
    const name = String(node?.tagName || node?.nodeName || '').toUpperCase();
    const type = String(node?.getAttribute?.('type') || node?.type || '').toLowerCase();
    const contenteditable = node?.getAttribute?.('contenteditable');
    return (
      name === 'TEXTAREA' ||
      (name === 'INPUT' && ['', 'text', 'search', 'email', 'tel', 'url'].includes(type)) ||
      node?.isContentEditable === true ||
      ['', 'true', 'plaintext-only'].includes(contenteditable)
    );
  };
  const retainedDraftExists = () =>
    (dom.nodes?.() || []).some((node) => potentialEditor(node) && originalDraftText(node).trim());
  const openWorkspace = () => {
    if (destroyed)
      return Promise.reject(new Error('The page guard was replaced. Reopen the privacy notice.'));
    let handoffId;
    try {
      let editor;
      try {
        editor = dom.resolveComposer(site);
      } catch (error) {
        // Navigation/upload surfaces may have no composer; never guess among other fields.
        if (!/^No accessible message composer\b/.test(error.message) || retainedDraftExists())
          throw error;
      }
      const text = editor ? originalDraftText(editor) : '';
      if (text.length > MAX_DRAFT_LENGTH)
        throw new Error(
          'This draft is too large to import. Copy a smaller section into the private workspace. Nothing was sent.',
        );
      capturedDraft = null;
      if (text.trim()) {
        handoffId = environment.crypto?.randomUUID?.();
        if (typeof handoffId !== 'string' || !UUID_PATTERN.test(handoffId))
          throw new Error(
            'A secure private draft transfer could not be created. Open the extension from the toolbar and copy your draft there. Nothing was sent.',
          );
        capturedDraft = { id: handoffId, text, expiresAt: now() + DRAFT_LIFETIME_MS };
        schedule(() => {
          if (capturedDraft?.id === handoffId) capturedDraft = null;
        }, DRAFT_LIFETIME_MS);
      }
    } catch (error) {
      modal.show({
        title: 'Your draft stays on this page',
        message: `${error.message} Open the extension from the toolbar and copy your message into its private workspace.`,
      });
      return Promise.reject(error);
    }
    return new Promise((resolve, reject) => {
      const discardTransfer = () => {
        if (capturedDraft?.id === handoffId) capturedDraft = null;
      };
      const complete = (result) => {
        if (runtime.lastError || !result?.ok) {
          discardTransfer();
          reject(
            new Error(
              'Private workspace unavailable. Open the extension from your browser toolbar.',
            ),
          );
          return;
        }
        resolve(result);
      };
      const fail = (error) => {
        discardTransfer();
        reject(error);
      };
      const message = { type: 'open-workspace', ...(handoffId ? { handoffId } : {}) };
      try {
        if (environment.browser) runtime.sendMessage(message).then(complete, fail);
        else runtime.sendMessage(message, complete);
      } catch (error) {
        fail(error);
      }
    });
  };
  const notice = (message) =>
    modal.show({
      title: 'Review before sending',
      message,
      actionLabel: 'Open private workspace',
      onAction: openWorkspace,
    });
  const unavailableNotice = () =>
    notice(
      failed
        ? 'Protection policy is unavailable. Sending is blocked. Open the extension to check your policy.'
        : 'Protection is loading. Use the private workspace after policy is ready.',
    );
  const protectedPage = () => !ready || failed || Boolean(site);
  const sendControl = (event) =>
    dom.controlFromEvent(event, (node) => dom.isSendControl(node, site));
  const uploadControl = (event) => dom.controlFromEvent(event, (node) => dom.isUploadControl(node));
  const anyControl = (event) =>
    dom.controlFromEvent(event, (node) => {
      const name = String(node?.tagName || node?.nodeName || '').toUpperCase();
      const type = String(node?.getAttribute?.('type') || node?.type || '').toLowerCase();
      return (
        name === 'BUTTON' ||
        node?.getAttribute?.('role') === 'button' ||
        (name === 'INPUT' && ['submit', 'button', 'image'].includes(type))
      );
    });
  const nativeDraftMaySend = () => {
    try {
      const editor = dom.resolveComposer(site);
      if (editor && originalDraftText(editor).trim()) return true;
    } catch (error) {
      // A missing composer can be a navigation page. Ambiguity cannot prove an empty draft.
      if (!/^No accessible message composer\b/.test(error.message)) return true;
    }
    // Accessibility/editing states cannot prove retained text is safe to transmit.
    return retainedDraftExists();
  };
  const guardedSendControl = (event) =>
    sendControl(event) || (anyControl(event) && nativeDraftMaySend());
  const selectedFiles = () => dom.selectedFiles();
  const permitStillVerified = () => {
    try {
      if (!permit || !ready || failed || permit.revision !== revision || selectedFiles())
        return false;
      const editor = dom.resolveComposer(site);
      return (
        editor === permit.editor &&
        dom.resolveSend(site, editor) === permit.button &&
        editor.isConnected !== false &&
        permit.button.isConnected !== false &&
        !permit.button.disabled &&
        permit.button.getAttribute?.('aria-disabled') !== 'true' &&
        editors.verify(editor, permit.text).ok
      );
    } catch {
      return false;
    }
  };
  const isPermittedClick = (event) => {
    if (!permit || permit.clickUsed || event.type !== 'click' || event.isTrusted === true)
      return false;
    if (
      dom.controlFromEvent(event, (node) => node === permit.button) !== permit.button ||
      !permitStillVerified()
    )
      return false;
    permit.clickUsed = true;
    return true;
  };

  // Guards are installed at document_start before policy retrieval. Pending/invalid policy fails closed.
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
    addGuardListener(
      type,
      (event) => {
        if (modal.isOwnEvent(event) || !protectedPage()) return;
        if (!ready || failed) {
          block(event);
          if (event.type === 'click') unavailableNotice();
          return;
        }
        try {
          if (uploadControl(event)) {
            block(event);
            if (event.type === 'click')
              notice('Direct uploads are blocked. Import a text file in the private workspace.');
            return;
          }
          if (guardedSendControl(event) && !isPermittedClick(event)) {
            block(event);
            if (event.type === 'click') notice('Send through the extension’s private workspace.');
          }
        } catch {
          failed = true;
          block(event);
          if (event.type === 'click') unavailableNotice();
        }
      },
      { capture: true, passive: false },
    );
  }
  addGuardListener(
    'submit',
    (event) => {
      if (modal.isOwnEvent(event) || !protectedPage()) return;
      if (
        permit?.clickUsed &&
        !permit.submitUsed &&
        permit.form &&
        event.target === permit.form &&
        permitStillVerified()
      ) {
        permit.submitUsed = true;
        return;
      }
      block(event);
      if (!ready || failed) unavailableNotice();
      else notice('Use the private workspace to send.');
    },
    true,
  );
  for (const type of ['keydown', 'keypress', 'keyup']) {
    addGuardListener(
      type,
      (event) => {
        if (modal.isOwnEvent(event) || !protectedPage()) return;
        // Cover plain Enter and modified Enter shortcuts; Shift+Enter remains available for a newline.
        const enterSends =
          event.key === 'Enter' &&
          (!event.shiftKey || event.ctrlKey || event.metaKey || event.altKey);
        if (enterSends) block(event);
        try {
          const activatesControl = ['Enter', ' ', 'Spacebar'].includes(event.key);
          const uploads = activatesControl && uploadControl(event);
          const controlSends = uploads || (activatesControl && site && guardedSendControl(event));
          if (!enterSends && !controlSends) return;
          block(event);
          if (event.type === 'keydown') {
            if (!ready || failed) unavailableNotice();
            else if (uploads)
              notice('Direct uploads are blocked. Import a text file in the private workspace.');
            else notice('Use the private workspace to send.');
          }
        } catch {
          failed = true;
          block(event);
          if (event.type === 'keydown') unavailableNotice();
        }
      },
      true,
    );
  }
  for (const type of ['change', 'dragenter', 'dragover', 'drop', 'paste']) {
    addGuardListener(
      type,
      (event) => {
        if (modal.isOwnEvent(event) || !protectedPage()) return;
        const transfer = type === 'paste' ? event.clipboardData : event.dataTransfer;
        const files = type === 'change' ? event.target?.files : transfer?.files;
        const fileItems =
          transfer?.items && Array.from(transfer.items).some((item) => item.kind === 'file');
        if (!files?.length && !fileItems) return;
        block(event);
        if (type === 'change') event.target.value = '';
        if (type !== 'dragenter' && type !== 'dragover')
          notice('Direct uploads are blocked. Import a text file in the private workspace.');
      },
      { capture: true, passive: false },
    );
  }

  const loadPolicy = () => {
    if (destroyed) return;
    ready = false;
    const requestedRevision = ++revision;
    const receivePolicy = (result) => {
      if (destroyed || requestedRevision !== revision) return;
      ready = true;
      site = null;
      failed = false;
      try {
        if (!result || result.error || !Array.isArray(result.policy?.sites))
          throw new Error('Policy unavailable.');
        site =
          result.policy.sites.find(
            (entry) => entry.host.toLowerCase() === location.hostname.toLowerCase(),
          ) || null;
        if (
          site &&
          (typeof site.host !== 'string' ||
            Object.keys(site).some((key) => !['host', 'labels'].includes(key)))
        )
          throw new Error('Invalid semantic site policy.');
      } catch {
        failed = true;
      }
    };
    try {
      if (environment.browser)
        runtime.sendMessage({ type: 'policy' }).then(receivePolicy, () => receivePolicy(null));
      else
        runtime.sendMessage({ type: 'policy' }, (result) =>
          receivePolicy(runtime.lastError ? null : result),
        );
    } catch {
      receivePolicy(null);
    }
  };
  const storageChanged = (changes, area) => {
    if (destroyed) return;
    if ((area === 'local' || area === 'managed') && Object.hasOwn(changes, 'policy')) loadPolicy();
  };
  api.storage.onChanged.addListener(storageChanged);
  loadPolicy();

  const trustedWorkspace = (sender) => {
    if (sender?.id !== runtime.id || typeof sender.url !== 'string') return false;
    try {
      const url = new URL(sender.url);
      url.search = '';
      url.hash = '';
      return url.href === workspaceUrl;
    } catch {
      return false;
    }
  };
  const trustedBackground = (sender) => {
    if (sender?.id !== runtime.id || sender.tab != null) return false;
    if (sender.url === undefined) return true;
    return [
      'src/extension/background.js',
      'background.bundle.js',
      '_generated_background_page.html',
    ].some((path) => sender.url === runtime.getURL(path));
  };
  const editorStatus = () => {
    if (!ready || failed || !site) return undefined;
    const status = { composer: 'missing', send: 'missing', attachments: 'none' };
    try {
      status.attachments = selectedFiles() ? 'selected' : 'none';
    } catch {
      return undefined;
    }
    let editor;
    try {
      editor = dom.resolveComposer(site);
    } catch (error) {
      if (/^Ambiguous message composer\b/.test(error.message)) status.composer = 'ambiguous';
      return status;
    }
    if (!editor) return status;
    status.composer = 'ready';
    try {
      const button = dom.resolveSend(site, editor, { allowMissing: true });
      if (button)
        status.send =
          button.disabled || button.getAttribute?.('aria-disabled') === 'true'
            ? 'disabled'
            : 'ready';
    } catch (error) {
      if (/^Ambiguous send control\b/.test(error.message)) status.send = 'ambiguous';
    }
    return status;
  };
  const guardStatus = () => {
    const editor = editorStatus();
    return {
      ok: true,
      version: EXTENSION_VERSION,
      host: location.hostname.toLowerCase(),
      configured: Boolean(site),
      ready,
      failed,
      ...(editor ? { editor } : {}),
    };
  };
  const handoffOwner = (sender, message) => {
    // Browser-supplied document identity separates same-URL windows and page reloads.
    if (typeof sender.documentId === 'string' && sender.documentId)
      return JSON.stringify(['document', sender.documentId]);
    if (message.workspaceId !== undefined) {
      if (typeof message.workspaceId !== 'string' || !UUID_PATTERN.test(message.workspaceId))
        throw new Error('Invalid private workspace identity.');
      return JSON.stringify(['workspace', sender.url, message.workspaceId.toLowerCase()]);
    }
    // Compatibility with older extension workspaces; new UI instances always supply a UUID.
    return JSON.stringify(['legacy', sender.url]);
  };
  const runtimeMessage = (message, sender, reply) => {
    if (destroyed) return;
    if (
      !message ||
      ![
        'guard-status',
        'policy-invalidated',
        'take-draft',
        'send-sanitized',
        'responses',
        'cancel-handoff',
      ].includes(message.type)
    )
      return;
    if (message.type === 'guard-status') {
      reply(
        trustedBackground(sender) || trustedWorkspace(sender)
          ? guardStatus()
          : { error: 'Only this extension can inspect its page guard.' },
      );
      return;
    }
    if (message.type === 'policy-invalidated') {
      if (!trustedBackground(sender)) {
        reply({ error: 'Only the extension background can invalidate policy.' });
        return;
      }
      loadPolicy();
      reply({ ok: true });
      return;
    }
    if (!trustedWorkspace(sender)) {
      reply({ error: 'Only the extension’s private workspace can access this tab.' });
      return;
    }
    if (message.type === 'take-draft') {
      if (!capturedDraft || capturedDraft.expiresAt <= now()) {
        capturedDraft = null;
        reply({
          error:
            'This private draft transfer expired or was already used. Copy the original into the private workspace.',
        });
        return;
      }
      if (
        typeof message.handoffId !== 'string' ||
        !UUID_PATTERN.test(message.handoffId) ||
        message.handoffId !== capturedDraft.id
      ) {
        reply({ error: 'Private draft transfer unavailable.' });
        return;
      }
      const text = capturedDraft.text;
      capturedDraft = null;
      reply({ text });
      return;
    }
    let owner;
    if (message.type !== 'responses') {
      try {
        owner = handoffOwner(sender, message);
      } catch (error) {
        reply({ error: error.message });
        return;
      }
    }
    if (message.type === 'cancel-handoff') {
      if (pending && pending.owner === owner) pending.cancelled = true;
      reply({ ok: true });
      return;
    }
    if (!ready || !site || failed) {
      reply({
        error: 'This site is not configured, its policy is invalid, or policy is still loading.',
      });
      return;
    }
    let sendRequest = null;
    if (message.type === 'send-sanitized' && pending) {
      reply({ error: 'A sanitized send is already in progress.' });
      return;
    }
    try {
      if (message.type === 'responses') {
        reply({
          text: dom.readResponses(site, message.tokens).join('\n\n'),
        });
        return;
      }
      if (
        typeof message.text !== 'string' ||
        !message.text.trim() ||
        message.text.length > MAX_DRAFT_LENGTH
      )
        throw new Error('Invalid or oversized message.');
      if (selectedFiles())
        throw new Error(
          'A file is still selected on this page. Remove existing attachments before sending.',
        );
      const editor = dom.resolveComposer(site);
      const button = dom.resolveSend(site, editor, { allowMissing: true });
      if (!editor)
        throw new Error(
          'A unique message composer could not be identified. Add an accessible text hint in Admin.',
        );
      if (!editors.isEditable(editor))
        throw new Error('The configured composer is not an editable text field.');
      const request = {
        editor,
        button,
        text: message.text,
        revision,
        owner,
        cancelled: false,
        attempts: 0,
        deadline: now() + SEND_TIMEOUT_MS,
        lastMutationAt: null,
        finished: false,
      };
      request.reply = (result) => {
        if (request.finished) return;
        request.finished = true;
        request.observer?.disconnect();
        if (pending === request) pending = null;
        reply(result);
      };
      sendRequest = request;
      pending = request;
      if (typeof environment.MutationObserver === 'function') {
        request.observer = new environment.MutationObserver(() => {
          request.lastMutationAt = now();
        });
        request.observer.observe(editor.parentNode || editor, {
          childList: true,
          characterData: true,
          subtree: true,
          attributes: true,
          attributeFilter: ['disabled', 'aria-disabled', 'contenteditable', 'aria-hidden'],
        });
      }
      editors.write(editor, message.text);
      const attemptSend = () => {
        if (request.finished) return;
        request.attempts++;
        const waitOrFail = (reason) => {
          if (request.attempts < SEND_TIMEOUT_MS / SEND_POLL_MS && now() < request.deadline) {
            schedule(attemptSend, SEND_POLL_MS);
            return true;
          }
          throw new Error(`${reason} Nothing was sent.`);
        };
        try {
          if (request.cancelled) throw new Error('Private workspace canceled this send.');
          if (!ready || failed || request.revision !== revision)
            throw new Error('Policy changed while preparing the draft. Check & redact again.');
          let finalEditor;
          try {
            finalEditor = dom.resolveComposer(site);
          } catch (error) {
            if (/^No accessible message composer\b/.test(error.message)) {
              waitOrFail(
                'The page replaced its composer and no unique editable field became ready.',
              );
              return;
            }
            throw error;
          }
          if (!finalEditor || finalEditor.isConnected === false) {
            waitOrFail('The current message composer is disconnected or unavailable.');
            return;
          }
          const verification = editors.verify(finalEditor, request.text);
          if (!verification.ok)
            throw new Error(
              verification.reason === 'placeholders'
                ? 'The page changed or removed redaction placeholders. Nothing was sent.'
                : 'The page changed the sanitized message content. Nothing was sent.',
            );
          let finalButton;
          try {
            finalButton = dom.resolveSend(site, finalEditor);
          } catch (error) {
            if (/^No accessible send control\b/.test(error.message)) {
              waitOrFail(
                'No unique send control became available after preparing the sanitized draft.',
              );
              return;
            }
            throw error;
          }
          if (!finalButton || typeof finalButton.click !== 'function')
            throw new Error('Send control unavailable after preparing the draft.');
          if (
            finalButton.isConnected === false ||
            finalButton.disabled ||
            finalButton.getAttribute?.('aria-disabled') === 'true'
          ) {
            waitOrFail('The current send control is disconnected or still disabled.');
            return;
          }
          if (
            request.observer &&
            request.lastMutationAt !== null &&
            now() - request.lastMutationAt < SEND_SETTLE_MS
          ) {
            waitOrFail('The page kept changing the prepared draft or controls.');
            return;
          }
          if (selectedFiles())
            throw new Error('A file is selected on this page. Remove attachments before sending.');
          // Permit one synthetic click on this exact button, plus its own form's default submission.
          // The permission is private to this isolated-world closure and expires when click() returns.
          permit = {
            ...request,
            editor: finalEditor,
            button: finalButton,
            form: dom.nearestForm(finalButton),
            clickUsed: false,
            submitUsed: false,
          };
          finalButton.click();
          if (!permit.clickUsed)
            throw new Error(
              'The page did not receive the guarded send click. Nothing was confirmed sent.',
            );
          request.reply({ ok: true });
        } catch (error) {
          request.reply({ error: error.message });
        } finally {
          permit = null;
        }
      };
      schedule(attemptSend, SEND_POLL_MS);
      return true;
    } catch (error) {
      sendRequest?.observer?.disconnect();
      if (pending === sendRequest) pending = null;
      reply({ error: error.message });
    }
  };
  runtime.onMessage.addListener(runtimeMessage);
  const destroy = () => {
    if (destroyed) return;
    destroyed = true;
    revision++;
    ready = false;
    site = null;
    capturedDraft = null;
    permit = null;
    if (pending) {
      pending.cancelled = true;
      try {
        pending.reply({
          error: 'The page guard was replaced. Check & redact again. Nothing was sent.',
        });
      } catch {}
      pending = null;
    }
    for (const { type, listener, options } of eventRegistrations)
      eventTarget.removeEventListener?.(type, listener, options);
    eventRegistrations.length = 0;
    for (const timer of scheduledTimers) environment.clearTimeout?.(timer);
    scheduledTimers.clear();
    try {
      api.storage.onChanged.removeListener?.(storageChanged);
    } catch {}
    try {
      runtime.onMessage.removeListener?.(runtimeMessage);
    } catch {}
    modal.destroy?.();
    if (environment[INSTALLATION_KEY] === guard) delete environment[INSTALLATION_KEY];
  };
  const guard = Object.freeze({
    version: EXTENSION_VERSION,
    runtime,
    status: guardStatus,
    destroy,
  });
  environment[INSTALLATION_KEY] = guard;
  return guard;
}

if (globalThis.document && (globalThis.browser?.runtime || globalThis.chrome?.runtime))
  installContentGuard();
