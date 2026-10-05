import { getPolicy } from '../platform/policy-repository.js';
import { api, isExtension } from '../platform/webextension.js';
import { ScannerClient } from '../platform/scanner-client.js';
import { DraftController } from '../core/draft-controller.js';
import { MAX_SCAN_LENGTH } from '../core/limits.js';
import { connectGuard, importBlockedDraft } from '../platform/guard-connection.js';
import { EXTENSION_VERSION } from '../core/build-info.js';
import { EDITION } from '../core/edition.js';
const $ = (id) => document.getElementById(id);
const parameters = new URLSearchParams(location.search),
  tab = parameters.has('tab') ? Number(parameters.get('tab')) : null;
const workspaceId = crypto.randomUUID();
const controller = new DraftController();
const scanner = new ScannerClient(
  () => new Worker(new URL('../extension/scanner-worker.js', import.meta.url), { type: 'module' }),
);
let busy = false,
  guardConnected = false,
  policyLoad = 0,
  watchTimer,
  watchUntil = 0,
  responseEpoch = 0,
  sessionEpoch = 0,
  responseSource = 'provider',
  restoringResponse = false,
  restoredResponse = null;
const responseStatus = (message, error = false) => {
  $('response-status').textContent = message;
  $('response-status').classList.toggle('error', error);
};
function updateRestoreAction() {
  const length = $('ai-response').value.length;
  $('restore-response').disabled =
    !length || length > MAX_SCAN_LENGTH || restoringResponse || scanner.failed;
}
function stopFollowingResponse() {
  clearTimeout(watchTimer);
  watchUntil = 0;
}
function clearRestoredResponse(message) {
  restoredResponse = null;
  $('response').textContent = message;
  $('copy-response').disabled = true;
}
function showRestoredResponse(result) {
  restoredResponse = result.text;
  $('response').textContent = result.text || 'Waiting for the provider response…';
  $('copy-response').disabled = !result.text;
  const { restoredCount, unresolvedCount } = result;
  if (Number.isInteger(restoredCount) && Number.isInteger(unresolvedCount)) {
    responseStatus(
      `${restoredCount.toLocaleString()} private value${restoredCount === 1 ? '' : 's'} restored locally.${unresolvedCount ? ` ${unresolvedCount.toLocaleString()} unrecognized placeholder${unresolvedCount === 1 ? '' : 's'} kept unchanged. Use the same open workspace that checked your original message.` : restoredCount ? '' : ' No matching placeholders were found. Check your original message in this workspace first.'}`,
    );
  } else {
    responseStatus(
      'Response restored locally. Only placeholders saved in this open workspace can be restored; others stay unchanged.',
    );
  }
}
const status = (message, error = false) => {
  $('status').textContent = message;
  $('status').classList.toggle('error', error);
  $('detail-operation').textContent = message;
};
if (isExtension && api.runtime.onMessage) {
  api.runtime.onMessage.addListener((message, sender, respond) => {
    // Only our background may discover this live workspace; provider pages never get access.
    if (
      message?.type !== 'locate-workspace' ||
      sender.id !== api.runtime.id ||
      sender.tab ||
      !Number.isInteger(tab) ||
      tab < 0 ||
      message.tabId !== tab
    )
      return;
    api.tabs
      .getCurrent()
      .then((current) => {
        if (
          Number.isInteger(current?.id) &&
          current.id >= 0 &&
          Number.isInteger(current.windowId) &&
          current.windowId >= 0
        )
          respond({ tabId: tab, workspaceTabId: current.id, windowId: current.windowId });
        else respond();
      })
      .catch(() => respond());
    return true;
  });
}
$('detail-version').textContent = EXTENSION_VERSION;
const stateLabels = {
  ready: 'Ready',
  disabled: 'Waiting for a prepared draft',
  missing: 'Not found on this page',
  ambiguous: 'Multiple possible controls',
  unsupported: 'Needs provider verification',
};
function showConnectionDetails(result) {
  $('detail-guard').textContent = result ? 'Guard verified' : 'Not connected';
  $('detail-provider').textContent = result?.host || 'No verified provider';
  $('detail-composer').textContent =
    stateLabels[result?.editor?.composer] || 'Checked when sending';
  $('detail-send').textContent = stateLabels[result?.editor?.send] || 'Checked when sending';
}
$('export-support').onclick = () => {
  const details = {
    version: EXTENSION_VERSION,
    edition: EDITION.slug,
    capturedAt: new Date().toISOString(),
    mode: isExtension ? 'extension' : 'preview',
    policy: $('detail-policy').textContent,
    provider: $('detail-provider').textContent,
    protection: $('detail-guard').textContent,
    composer: $('detail-composer').textContent,
    sendAction: $('detail-send').textContent,
  };
  // Explicit fields exclude message content, tokens, term lists, URL paths and tab identities.
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(details, null, 2)], { type: 'application/json' }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = `${EDITION.slug}-support.json`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
function resetPreview() {
  $('send').disabled = true;
  $('preview').hidden = true;
  $('preview-empty').hidden = false;
  $('preview').textContent = '';
  $('findings').replaceChildren();
  $('match-count').textContent = 'AWAITING CHECK';
  $('char-count').textContent = `${$('draft').value.length.toLocaleString()} characters`;
}
function invalidate() {
  controller.invalidate();
  resetPreview();
  if (controller.sending && tab !== null)
    api.tabs
      .sendMessage(tab, { type: 'cancel-handoff', workspaceId }, { frameId: 0 })
      .catch(() => {});
}
async function verifyConnection() {
  guardConnected = false;
  const result = await connectGuard(api, tab);
  guardConnected = true;
  showConnectionDetails(result);
  $('connection').textContent = `Guard active · ${result.host} · v${result.version}`;
  return result;
}
async function init() {
  const load = ++policyLoad;
  guardConnected = false;
  showConnectionDetails(null);
  controller.setPolicy(null);
  resetPreview();
  $('scan').disabled = true;
  try {
    const { policy, locked } = await getPolicy();
    if (load !== policyLoad) return;
    controller.setPolicy(policy);
    $('scan').disabled = busy || scanner.failed;
    $('mode').textContent = isExtension
      ? locked
        ? 'Company managed'
        : EDITION.managedPolicies
          ? 'Local policy'
          : 'Personal settings'
      : 'UI preview';
    $('detail-policy').textContent = locked
      ? 'Company managed'
      : EDITION.managedPolicies
        ? 'Local configuration'
        : 'Personal settings';
    $('reconnect').hidden = tab === null || !isExtension;
    if (tab !== null && isExtension) {
      $('connection').textContent = 'Checking page guard…';
      try {
        const result = await connectGuard(api, tab);
        if (load !== policyLoad) return;
        guardConnected = true;
        showConnectionDetails(result);
        $('connection').textContent = `Guard active · ${result.host} · v${result.version}`;
        status('Ready. Review the sanitized preview before sending to the connected provider.');
      } catch (error) {
        if (load !== policyLoad) return;
        $('connection').textContent = 'Page guard unavailable';
        status(`${error.message} Local scanning is available; sending is disabled.`, true);
      }
    } else {
      $('detail-guard').textContent = isExtension
        ? 'Open from a provider tab'
        : 'Preview · local scanning';
      $('connection').textContent = isExtension
        ? 'Open from a provider tab'
        : 'UI preview · local scanning';
      status(
        'Ready. Your original message stays in this workspace. Review the sanitized preview before sending.',
      );
    }
  } catch (error) {
    if (load !== policyLoad) return;
    controller.setPolicy(null);
    $('mode').textContent = 'Protection blocked';
    $('detail-policy').textContent = 'Unavailable · protection blocked';
    $('connection').textContent = 'Protection blocked';
    status(error.message, true);
    $('scan').disabled = true;
  }
}
$('reconnect').onclick = async () => {
  $('reconnect').disabled = true;
  invalidate();
  try {
    await init();
  } finally {
    $('reconnect').disabled = false;
  }
};
$('draft').addEventListener('input', invalidate);
$('scan').onclick = async () => {
  if (busy || !controller.policy || controller.sending) return;
  invalidate();
  const ticket = controller.ticket();
  busy = true;
  $('scan').disabled = true;
  $('scan').textContent = 'Checking locally…';
  try {
    const { result } = await scanner.scan($('draft').value, controller.policy);
    if (!controller.current(ticket)) return;
    if (result.blocked) {
      status('Blocked by policy. Remove prohibited content before sending.', true);
      $('match-count').textContent = 'BLOCKED';
      return;
    }
    // Render first; authorize sending only after every review operation succeeds.
    $('preview').textContent = result.text;
    $('preview').hidden = false;
    $('preview-empty').hidden = true;
    $('match-count').textContent =
      `${result.findings.length} REDACTION${result.findings.length === 1 ? '' : 'S'}`;
    const counts = new Map();
    for (const finding of result.findings)
      counts.set(finding.kind, (counts.get(finding.kind) || 0) + 1);
    for (const [kind, count] of counts) {
      const chip = document.createElement('span');
      chip.className = 'finding-tag';
      chip.textContent = count === 1 ? kind : `${kind} × ${count.toLocaleString()}`;
      $('findings').append(chip);
    }
    const reviewed = controller.acceptReview(ticket, result);
    $('send').disabled = !reviewed || !guardConnected || tab === null || !isExtension;
    status(
      `${result.findings.length} sensitive match(es) replaced locally. Review the preview for missed private data.${!guardConnected ? ' Connect a page guard before sending.' : ''}`,
    );
  } catch (error) {
    invalidate();
    status(error.message, true);
  } finally {
    busy = false;
    $('scan').disabled = !controller.policy || scanner.failed;
    $('scan').textContent = 'Check & redact';
    updateRestoreAction();
    if (scanner.failed)
      responseStatus('Local scanner unavailable. Clear the session to restart.', true);
  }
};
$('file').onchange = async () => {
  const file = $('file').files[0];
  if (!file) return;
  const ticket = controller.ticket();
  try {
    if (file.size > MAX_SCAN_LENGTH || !/\.(txt|csv|md|json)$/i.test(file.name))
      throw new Error('Only TXT, CSV, Markdown, and JSON files up to 1 MB are supported.');
    const value = await file.text();
    if (!controller.current(ticket))
      throw new Error('Draft or policy changed during import. Import the file again.');
    if (value.includes('\0')) throw new Error('Binary content is unsupported.');
    if ($('draft').value.length + value.length + 1 > MAX_SCAN_LENGTH)
      throw new Error('Combined message exceeds the local text limit.');
    $('draft').value += ($('draft').value ? '\n' : '') + value;
    invalidate();
    status('Text imported locally. Check & redact before sending.');
  } catch (error) {
    status(error.message, true);
  } finally {
    $('file').value = '';
  }
};
$('send').onclick = async () => {
  if (controller.sending || busy || !controller.reviewedText) return;
  $('send').disabled = true;
  $('scan').disabled = true;
  try {
    await controller.send({
      readPolicy: async () => (await getPolicy()).policy,
      resolveTarget: async () => {
        const target = await api.tabs.get(tab);
        const guard = await verifyConnection();
        if (new URL(target.url).hostname !== guard.host)
          throw new Error('The provider tab changed while checking its guard. Nothing was sent.');
        return target;
      },
      dispatch: (text) =>
        api.tabs.sendMessage(tab, { type: 'send-sanitized', text, workspaceId }, { frameId: 0 }),
    });
    status(
      'Sanitized message handed to the provider. Restored responses will appear privately below.',
    );
    watchUntil = Date.now() + 180000;
    followResponse();
  } catch (error) {
    if (!guardConnected) {
      $('connection').textContent = 'Page guard unavailable';
      showConnectionDetails(null);
    }
    resetPreview();
    status(error.message, true);
  } finally {
    $('scan').disabled = !controller.policy || scanner.failed;
  }
};
async function readResponse(quiet = false) {
  if (quiet && responseSource !== 'provider') return;
  const epoch = ++responseEpoch;
  if (!quiet) {
    responseSource = 'provider';
    restoringResponse = false;
    updateRestoreAction();
    clearRestoredResponse('Reading the connected provider’s response…');
    responseStatus('Reading the connected provider’s response…');
  }
  try {
    if (tab === null)
      throw new Error('Open the extension from the provider tab to read its response.');
    const result = await api.tabs.sendMessage(tab, { type: 'responses' }, { frameId: 0 });
    if (!result || result.error) throw new Error(result?.error || 'No response adapter replied.');
    if (epoch !== responseEpoch) return;
    const restored = await scanner.restore(result.text);
    if (epoch !== responseEpoch) return;
    showRestoredResponse(restored);
  } catch (error) {
    if (epoch !== responseEpoch) return;
    updateRestoreAction();
    if (scanner.failed)
      responseStatus('Local scanner unavailable. Clear the session to restart.', true);
    if (!quiet) {
      status(error.message, true);
      responseStatus(error.message, true);
    }
  }
}
function followResponse() {
  clearTimeout(watchTimer);
  if (responseSource !== 'provider' || Date.now() > watchUntil) return;
  watchTimer = setTimeout(async () => {
    await readResponse(true);
    followResponse();
  }, 1500);
}
$('read').onclick = () => readResponse();
$('ai-response').addEventListener('input', () => {
  responseEpoch++;
  responseSource = 'manual';
  restoringResponse = false;
  stopFollowingResponse();
  clearRestoredResponse('Your restored response will appear here after you restore this reply.');
  updateRestoreAction();
  const length = $('ai-response').value.length;
  responseStatus(
    scanner.failed
      ? 'Local scanner unavailable. Clear the session to restart.'
      : length > MAX_SCAN_LENGTH
        ? `This response exceeds the local limit of ${MAX_SCAN_LENGTH.toLocaleString()} characters. Split it into smaller parts.`
        : length
          ? 'Ready to restore locally. Your pasted response stays in this workspace.'
          : 'Paste the AI response to restore its placeholders.',
    scanner.failed || length > MAX_SCAN_LENGTH,
  );
});
$('restore-response').onclick = async () => {
  const text = $('ai-response').value;
  if (!text || restoringResponse || text.length > MAX_SCAN_LENGTH || scanner.failed) return;
  const epoch = ++responseEpoch;
  responseSource = 'manual';
  stopFollowingResponse();
  restoringResponse = true;
  updateRestoreAction();
  clearRestoredResponse('Restoring your response locally…');
  responseStatus('Restoring your response locally…');
  try {
    const result = await scanner.restore(text);
    if (epoch !== responseEpoch || text !== $('ai-response').value) return;
    showRestoredResponse(result);
  } catch (error) {
    if (epoch !== responseEpoch) return;
    responseStatus(error.message, true);
  } finally {
    if (epoch === responseEpoch) {
      restoringResponse = false;
      updateRestoreAction();
    }
  }
};
$('copy-response').onclick = async () => {
  const text = restoredResponse;
  if (!text) return;
  const epoch = responseEpoch;
  $('copy-response').disabled = true;
  try {
    if (!navigator.clipboard?.writeText)
      throw new Error('Clipboard access is unavailable. Select the restored text and copy it.');
    await navigator.clipboard.writeText(text);
    if (epoch !== responseEpoch || restoredResponse !== text) return;
    responseStatus('Restored response copied. Paste it into your document or message.');
  } catch {
    if (epoch !== responseEpoch || restoredResponse !== text) return;
    responseStatus('Clipboard access was denied. Select the restored text and copy it.', true);
  } finally {
    if (epoch === responseEpoch && restoredResponse === text) $('copy-response').disabled = false;
  }
};
$('clear').onclick = () => {
  responseEpoch++;
  sessionEpoch++;
  stopFollowingResponse();
  responseSource = 'provider';
  restoringResponse = false;
  $('ai-response').value = '';
  invalidate();
  scanner.reset();
  $('draft').value = '';
  resetPreview();
  clearRestoredResponse(
    'Private values cleared. New responses can only restore placeholders from this session.',
  );
  updateRestoreAction();
  responseStatus(
    'Private values cleared. Check a new original message before restoring its reply.',
  );
  $('scan').disabled = !controller.policy || busy;
  status('Private session cleared.');
};
api.storage.onChanged.addListener((changes, area) => {
  if ((area === 'local' || area === 'managed') && Object.hasOwn(changes, 'policy')) {
    invalidate();
    init();
  }
});
if (parameters.has('sample')) {
  const value = sessionStorage.getItem('guard-demo-draft');
  if (value) {
    $('draft').value = value;
    sessionStorage.removeItem('guard-demo-draft');
    invalidate();
  }
}
window.addEventListener('pagehide', () => {
  clearTimeout(watchTimer);
  scanner.dispose();
});
await init();
if (parameters.has('draft') && isExtension) {
  const epoch = sessionEpoch;
  try {
    const text = await importBlockedDraft(api, tab, parameters.get('draft'));
    if (epoch !== sessionEpoch) {
      status(
        'The session was cleared during draft transfer. Open the workspace from the page again.',
        true,
      );
    } else {
      const combined = $('draft').value + ($('draft').value && text ? '\n\n' : '') + text;
      if (combined.length > MAX_SCAN_LENGTH)
        throw new Error('The imported draft and current text exceed the local text limit.');
      $('draft').value = combined;
      invalidate();
      $('draft').focus();
      status(
        `Your blocked message is here. Check & redact before sending.${!guardConnected ? ' Reconnect the page guard to enable sending.' : ''}`,
      );
    }
  } catch (error) {
    status(`Draft transfer failed: ${error.message} Nothing was sent.`, true);
  } finally {
    parameters.delete('draft');
    const cleanUrl = new URL(location.href);
    cleanUrl.searchParams.delete('draft');
    history.replaceState(null, '', cleanUrl.href);
  }
}
