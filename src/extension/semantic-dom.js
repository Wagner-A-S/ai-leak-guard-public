// Provider discovery uses the page's accessibility semantics, never provider-specific DOM paths.
// Ambiguous pages fail closed so a draft cannot be written into an unrelated text field.
const SEND_LABELS = [
  'send',
  'send message',
  'send prompt',
  'submit',
  'submit prompt',
  'ask',
  'ask ai',
  'отправить',
  'отправить сообщение',
  'отправить запрос',
  'послать',
  'запитати',
  'надіслати',
  'жіберу',
  'göndər',
  'yuborish',
  'trimite',
  'trimite mesajul',
  'жөнөтүү',
  'фиристодан',
  'ուղարկել',
  'адпраўіць',
  'адправіць',
  'senden',
  'nachricht senden',
  'absenden',
  'envoyer',
  'envoyer le message',
  'enviar',
  'enviar mensaje',
  'invia',
  'invia messaggio',
  'enviar mensagem',
  'verzenden',
  'versturen',
  'wyślij',
  'wyslij',
  'skicka',
  'send besked',
  'lähetä',
  'odeslat',
  'gönder',
  'gonder',
  'إرسال',
  'ارسال',
  'שלח',
  '发送',
  '發送',
  '送信',
  '보내기',
];
const RESPONSE_LABELS = [
  'assistant',
  'assistant response',
  'assistant message',
  'ai response',
  'ai answer',
  'model response',
  'ответ ассистента',
  'ответ ии',
  'antwort des assistenten',
  'réponse de l’assistant',
  'réponse de l assistant',
  'respuesta del asistente',
  'resposta do assistente',
  'risposta dell assistente',
  '助手回复',
  '助手回覆',
];
const UPLOAD_LABELS = [
  'upload',
  'attach',
  'attachment',
  'attachments',
  'add files',
  'add file',
  'add photos',
  'add photo',
  'add images',
  'add image',
  'add document',
  'add documents',
  'загрузить',
  'прикрепить',
  'вложение',
  'добавить файл',
  'добавить файлы',
  'hochladen',
  'anhängen',
  'joindre',
  'téléverser',
  'subir archivo',
  'adjuntar',
  'carica',
  'allega',
  'anexar',
  '上传',
  '上傳',
  '添付',
  'アップロード',
  '첨부',
];
const TEXT_INPUTS = new Set(['', 'text', 'search', 'email', 'tel', 'url']);
const RESPONSE_BLOCKS = new Set(['P', 'DIV', 'ARTICLE', 'SECTION', 'LI', 'PRE', 'BLOCKQUOTE']);
const TOKEN_PATTERN = /\[\[LG_[a-zA-Z0-9_-]+\]\]/;
const tag = (node) => String(node?.tagName || node?.nodeName || '').toUpperCase();
const attr = (node, name) => node?.getAttribute?.(name) ?? null;
const normalize = (value) =>
  String(value || '')
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[\p{P}\p{Z}\s]+/gu, ' ')
    .trim();
const literal = (value) =>
  String(value || '')
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
const parent = (node) => node?.parentElement || node?.parentNode?.host || node?.parentNode || null;
const isElement = (node) => node?.nodeType === 1 || typeof node?.tagName === 'string';
const children = (node) => Array.from(node?.children || node?.childNodes || []).filter(isElement);

export function createSemanticDom(document) {
  if (!document) throw new Error('A document is required for semantic page discovery.');

  const extensionRoot = (node) => {
    for (let current = node; current; current = parent(current))
      if (attr(current, 'data-ai-leak-guard-root') !== null) return true;
    return false;
  };

  function nodes(root = document) {
    const result = [];
    const seen = new Set();
    const stack = isElement(root) ? [root] : children(root).reverse();
    if (!stack.length && root === document && document.documentElement)
      stack.push(document.documentElement);
    while (stack.length) {
      const node = stack.pop();
      if (!node || seen.has(node) || extensionRoot(node)) continue;
      seen.add(node);
      result.push(node);
      const descendants = children(node);
      if (node.shadowRoot && node.shadowRoot.mode !== 'closed')
        descendants.push(...children(node.shadowRoot));
      for (let index = descendants.length - 1; index >= 0; index--) stack.push(descendants[index]);
    }
    return result;
  }

  function visible(node) {
    if (!isElement(node) || node.isConnected === false || extensionRoot(node)) return false;
    for (let current = node; current && current !== document; current = parent(current)) {
      if (
        current.hidden ||
        current.inert ||
        attr(current, 'hidden') !== null ||
        attr(current, 'aria-hidden') === 'true' ||
        attr(current, 'inert') !== null
      )
        return false;
      let style = current.style;
      try {
        style = document.defaultView?.getComputedStyle?.(current) || style;
      } catch {
        return false;
      }
      if (style?.display === 'none' || ['hidden', 'collapse'].includes(style?.visibility))
        return false;
    }
    if (typeof node.getClientRects === 'function' && node.getClientRects().length === 0)
      return false;
    return true;
  }

  function within(node, ancestor) {
    for (let current = node; current; current = parent(current))
      if (current === ancestor) return true;
    return false;
  }

  function byId(id, source) {
    // Label references are DOM semantics. IDs supplied by aria-labelledby/form are not adapters.
    const root = source?.getRootNode?.() || document;
    if (!id) return null;
    if (typeof root.getElementById === 'function') return root.getElementById(id);
    return nodes(root).find((node) => attr(node, 'id') === id) || null;
  }

  function text(node) {
    return String(node?.innerText ?? node?.textContent ?? '').trim();
  }

  function accessibleName(node) {
    const references = attr(node, 'aria-labelledby');
    if (references) {
      const label = references
        .trim()
        .split(/\s+/)
        .map((id) => text(byId(id, node)))
        .join(' ')
        .trim();
      if (label) return label;
    }
    const ariaLabel = attr(node, 'aria-label');
    if (ariaLabel?.trim()) return ariaLabel;
    const labels = Array.from(node?.labels || []);
    const id = attr(node, 'id');
    if (!node?.labels && id && ['INPUT', 'TEXTAREA', 'BUTTON', 'SELECT'].includes(tag(node)))
      for (const label of nodes(node.getRootNode?.() || document))
        if (tag(label) === 'LABEL' && attr(label, 'for') === id) labels.push(label);
    for (let current = parent(node); current && current !== document; current = parent(current))
      if (tag(current) === 'LABEL' && !labels.includes(current)) labels.push(current);
    if (labels.length) return labels.map(text).join(' ');
    return (
      attr(node, 'title') ||
      attr(node, 'placeholder') ||
      (tag(node) === 'INPUT' && ['submit', 'button', 'image'].includes(inputType(node))
        ? node.value || attr(node, 'value') || attr(node, 'alt') || ''
        : tag(node) === 'TEXTAREA' || node.isContentEditable || attr(node, 'role') === 'textbox'
          ? ''
          : text(node))
    );
  }

  function hints(site, kind) {
    const values = site?.labels?.[kind];
    return Array.isArray(values) ? values.map(literal).filter(Boolean) : [];
  }

  function containsPhrase(name, phrases) {
    const normalized = literal(name);
    return phrases.some((phrase) => {
      const escaped = literal(phrase).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp(`(?:^|[^\\p{L}\\p{N}])${escaped}(?:$|[^\\p{L}\\p{N}])`, 'u').test(
        normalized,
      );
    });
  }

  function defaultLabel(name, labels) {
    // Common key hints may accompany a button name without changing the action's meaning.
    const normalized = normalize(
      String(name).replace(/\s*\((?:[^)]*(?:enter|return|↵|⏎)[^)]*)\)\s*$/iu, ''),
    );
    return labels.some((label) => normalized === normalize(label));
  }

  function inputType(node) {
    return String(attr(node, 'type') || node?.type || '').toLowerCase();
  }

  function editable(node) {
    if (
      !visible(node) ||
      node.disabled ||
      attr(node, 'disabled') !== null ||
      attr(node, 'aria-disabled') === 'true' ||
      node.readOnly ||
      attr(node, 'readonly') !== null ||
      attr(node, 'aria-readonly') === 'true'
    )
      return false;
    if (tag(node) === 'TEXTAREA') return true;
    if (tag(node) === 'INPUT') return TEXT_INPUTS.has(inputType(node));
    const own = attr(node, 'contenteditable');
    if (own === 'false') return false;
    if (own === '' || own === 'true' || own === 'plaintext-only') return true;
    return node.isContentEditable === true;
  }

  function editorCandidates() {
    return nodes().filter((node) => {
      if (!editable(node)) return false;
      // An inherited editable paragraph is part of its editing host, not a second composer.
      for (
        let ancestor = parent(node);
        ancestor && ancestor !== document;
        ancestor = parent(ancestor)
      )
        if (editable(ancestor)) return false;
      return true;
    });
  }

  function nearestForm(node) {
    if (node?.form) return node.form;
    const formId = attr(node, 'form');
    const associated = formId && byId(formId, node);
    if (tag(associated) === 'FORM') return associated;
    for (let current = node; current && current !== document; current = parent(current))
      if (tag(current) === 'FORM' || attr(current, 'role') === 'form') return current;
    return null;
  }

  function control(node) {
    return (
      tag(node) === 'BUTTON' ||
      attr(node, 'role') === 'button' ||
      (tag(node) === 'INPUT' && ['submit', 'button', 'image'].includes(inputType(node)))
    );
  }

  function isSendControl(node, site) {
    if (!control(node) || !visible(node)) return false;
    const name = accessibleName(node);
    const configured = hints(site, 'send');
    if (configured.length && containsPhrase(name, configured)) return true;
    if (defaultLabel(name, SEND_LABELS)) return true;
    // An unnamed icon control cannot prove that it is safe. Guard every unnamed control.
    return !normalize(name);
  }

  function unique(candidates, kind) {
    if (!candidates.length)
      throw new Error(
        `No accessible ${kind} was found. Add an accessible label hint in Admin or use the private workspace.`,
      );
    if (candidates.length !== 1)
      throw new Error(
        `Ambiguous ${kind}: ${candidates.length} accessible targets match. Add a specific label hint in Admin. Nothing was sent.`,
      );
    return candidates[0];
  }

  function resolveComposer(site) {
    let candidates = editorCandidates();
    const configured = hints(site, 'composer');
    if (configured.length)
      candidates = candidates.filter((node) => containsPhrase(accessibleName(node), configured));
    else if (candidates.length > 1) {
      const sends = nodes().filter((node) => isSendControl(node, site));
      const related = candidates.filter((node) => {
        const form = nearestForm(node);
        return form && sends.some((send) => nearestForm(send) === form);
      });
      if (related.length) candidates = related;
    }
    return unique(candidates, 'message composer');
  }

  function resolveSend(site, editor, options = {}) {
    let candidates = nodes().filter((node) => isSendControl(node, site));
    const form = nearestForm(editor);
    if (form) {
      const related = candidates.filter((node) => nearestForm(node) === form);
      // An external button may submit the same form through its native form association.
      if (related.length) candidates = related;
      else candidates = candidates.filter((node) => !nearestForm(node));
    }
    const configured = hints(site, 'send');
    if (configured.length)
      candidates = candidates.filter((node) => containsPhrase(accessibleName(node), configured));
    else {
      const named = candidates.filter((node) => normalize(accessibleName(node)));
      if (named.length) candidates = named;
    }
    if (!candidates.length && options.allowMissing === true) return null;
    return unique(candidates, 'send control');
  }

  function isUploadControl(node) {
    if (!isElement(node) || extensionRoot(node)) return false;
    if (tag(node) === 'INPUT' && inputType(node) === 'file') return true;
    if (tag(node) === 'LABEL') {
      const associated = byId(attr(node, 'for'), node);
      if (tag(associated) === 'INPUT' && inputType(associated) === 'file') return true;
      if (nodes(node).some((child) => tag(child) === 'INPUT' && inputType(child) === 'file'))
        return true;
    }
    return control(node) && containsPhrase(accessibleName(node), UPLOAD_LABELS);
  }

  function controlFromEvent(event, predicate) {
    const path = typeof event?.composedPath === 'function' ? event.composedPath() : [event?.target];
    const seen = new Set();
    for (const node of path) {
      for (let current = node; current && !seen.has(current); current = parent(current)) {
        seen.add(current);
        if (predicate(current)) return current;
      }
    }
    return null;
  }

  function selectedFiles() {
    return nodes().some(
      (node) => tag(node) === 'INPUT' && inputType(node) === 'file' && node.files?.length,
    );
  }

  function readResponses(site, tokens = []) {
    const all = nodes();
    // Exclude drafts even while their editing host is temporarily hidden, disabled or readonly.
    const editors = all.filter(
      (node) =>
        tag(node) === 'TEXTAREA' ||
        (tag(node) === 'INPUT' && TEXT_INPUTS.has(inputType(node))) ||
        node.isContentEditable === true ||
        ['', 'true', 'plaintext-only'].includes(attr(node, 'contenteditable')),
    );
    const notResponse = (node) => {
      if (!visible(node) || editors.some((editor) => within(node, editor) || within(editor, node)))
        return true;
      for (let current = node; current && current !== document; current = parent(current))
        if (
          ['user', 'human'].includes(
            String(attr(current, 'data-message-author-role')).toLowerCase(),
          )
        )
          return true;
      return ['INPUT', 'TEXTAREA', 'BUTTON', 'SCRIPT', 'STYLE', 'NOSCRIPT'].includes(tag(node));
    };
    const configured = hints(site, 'response');
    const semantic = all.filter((node) => {
      if (notResponse(node)) return false;
      if (configured.length) return containsPhrase(accessibleName(node), configured);
      if (String(attr(node, 'data-message-author-role')).toLowerCase() === 'assistant') return true;
      const namedRegion =
        tag(node) === 'ARTICLE' ||
        ['article', 'listitem', 'region'].includes(attr(node, 'role')) ||
        attr(node, 'aria-label') !== null ||
        attr(node, 'aria-labelledby') !== null;
      return namedRegion && defaultLabel(accessibleName(node), RESPONSE_LABELS);
    });
    if (!configured.length) {
      for (const heading of all) {
        if (!/^H[1-6]$/.test(tag(heading)) && attr(heading, 'role') !== 'heading') continue;
        if (notResponse(heading) || !defaultLabel(accessibleName(heading), RESPONSE_LABELS))
          continue;
        const container = parent(heading);
        if (container && !['BODY', 'HTML'].includes(tag(container)) && !notResponse(container))
          semantic.push(container);
      }
    }
    let candidates = [...new Set(semantic)];
    if (!candidates.length && !configured.length) {
      const validTokens = Array.isArray(tokens)
        ? tokens.filter((token) => typeof token === 'string' && TOKEN_PATTERN.test(token))
        : [];
      candidates = all.filter((node) => {
        if (notResponse(node) || !RESPONSE_BLOCKS.has(tag(node))) return false;
        const value = text(node);
        return validTokens.length
          ? validTokens.some((token) => value.includes(token))
          : TOKEN_PATTERN.test(value);
      });
    }
    // Keep the smallest response blocks so nested accessibility wrappers never duplicate text.
    candidates = candidates.filter(
      (node) => !candidates.some((other) => other !== node && within(other, node)),
    );
    return candidates.map(text).filter(Boolean);
  }

  return {
    resolveComposer,
    resolveSend,
    readResponses,
    selectedFiles,
    isSendControl,
    isUploadControl,
    controlFromEvent,
    nearestForm,
    nodes,
  };
}
