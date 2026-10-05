import { test, expect } from '@playwright/test';
import { DEFAULT_POLICY } from '../../src/core/policy.js';
import { MAX_SCAN_LENGTH } from '../../src/core/limits.js';
import { EXTENSION_VERSION } from '../../src/core/build-info.js';

const originalName = 'Мария Тестова';
const originalEmail = 'maria@example.com';
const originalProject = 'Проект «Тест» 🌿';
const originalMarkup = '<img src=x onerror="window.restoreInjected=true">';
const originalDraft = `Name: ${originalName}\nEmail: ${originalEmail}\nProject: ${originalProject}\nSnippet: ${originalMarkup}`;

async function prepareWorkspace(page, connected = false) {
  await page.addInitScript(
    ({ policy, connected, version }) => {
      localStorage.setItem('guard-policy', JSON.stringify(policy));
      window.clipboardWrites = [];
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          async writeText(text) {
            if (window.rejectClipboard) throw new Error('Fixture clipboard denied.');
            window.clipboardWrites.push(text);
          },
        },
      });
      if (!connected) return;
      window.providerMessages = [];
      window.workspaceListeners = [];
      window.chrome = {
        runtime: {
          id: 'manual-restore-fixture',
          onMessage: {
            addListener(listener) {
              window.workspaceListeners.push(listener);
            },
          },
          async sendMessage() {
            return {
              ok: true,
              ready: true,
              configured: true,
              failed: false,
              host: 'chatgpt.com',
              version,
            };
          },
        },
        storage: {
          managed: {
            async get() {
              return {};
            },
          },
          local: {
            async get() {
              return { policy };
            },
          },
          onChanged: { addListener() {} },
        },
        tabs: {
          async getCurrent() {
            return { id: 11, windowId: 2 };
          },
          async get() {
            return { id: 7, url: 'https://chatgpt.com/' };
          },
          async sendMessage(tabId, message) {
            window.providerMessages.push(message);
            if (message.type === 'send-sanitized') return { ok: true };
            if (message.type === 'responses')
              return new Promise((resolve) => {
                window.finishProviderRead = (text) => resolve({ text });
              });
            throw new Error('Unexpected provider operation.');
          },
        },
      };
    },
    {
      policy: {
        ...DEFAULT_POLICY,
        sensitiveTerms: [originalProject, originalMarkup],
      },
      connected,
      version: EXTENSION_VERSION,
    },
  );
  await page.goto(`/src/ui/workspace.html${connected ? '?tab=7' : ''}`);
  await expect(page.getByRole('button', { name: 'Check & redact' })).toBeEnabled();
}

async function scanOriginal(page) {
  await page.getByLabel('Private message', { exact: true }).fill(originalDraft);
  await page.getByRole('button', { name: 'Check & redact' }).click();
  const preview = page.locator('#preview');
  await expect(preview).toBeVisible();
  const tokens = (await preview.textContent())
    .split('\n')
    .map((line) => line.match(/\[\[LG_[A-Za-z0-9_-]+\]\]/)?.[0]);
  expect(tokens).toHaveLength(4);
  expect(tokens.every(Boolean)).toBe(true);
  return tokens;
}

async function restorePasted(page, text) {
  await page.getByLabel('AI response', { exact: true }).fill(text);
  await page.getByRole('button', { name: 'Restore pasted response' }).click();
  await expect(page.getByRole('button', { name: 'Copy restored response' })).toBeEnabled();
}

test('pasted replies restore exact Unicode and repeated values, preserve unknown tokens and render HTML as text', async ({
  page,
}) => {
  await prepareWorkspace(page);
  const [name, email, project, markup] = await scanOriginal(page);
  const unknown = '[[LG_unknown_session_EMAIL_999]]';
  const reply = `**${name}**\n📧 ${email}\n${project}\nAgain: ${email}\n${markup}\n${unknown}`;
  const expected = `**${originalName}**\n📧 ${originalEmail}\n${originalProject}\nAgain: ${originalEmail}\n${originalMarkup}\n${unknown}`;
  await restorePasted(page, reply);
  expect(await page.locator('#response').textContent()).toBe(expected);
  await expect(page.locator('#response-status')).toContainText('5 private values restored locally');
  await expect(page.locator('#response-status')).toContainText(
    '1 unrecognized placeholder kept unchanged',
  );
  await expect(page.locator('#response').locator('img')).toHaveCount(0);
  expect(await page.evaluate(() => window.restoreInjected)).toBeUndefined();
  expect(await page.evaluate(() => window.clipboardWrites)).toEqual([]);
  await page.getByRole('button', { name: 'Copy restored response' }).click();
  expect(await page.evaluate(() => window.clipboardWrites)).toEqual([expected]);
  await expect(page.locator('#response-status')).toContainText('Restored response copied');
});

test('editing a pasted reply invalidates output and copy, and clearing destroys earlier mappings', async ({
  page,
}) => {
  await prepareWorkspace(page);
  const [, email] = await scanOriginal(page);
  await restorePasted(page, email);
  await expect(page.locator('#response')).toHaveText(originalEmail);
  await page.getByLabel('AI response', { exact: true }).fill(`Updated ${email}`);
  await expect(page.getByRole('button', { name: 'Copy restored response' })).toBeDisabled();
  await expect(page.locator('#response')).not.toContainText(originalEmail);
  await page.getByRole('button', { name: 'Clear session' }).click();
  await expect(page.getByLabel('AI response', { exact: true })).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Restore pasted response' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Copy restored response' })).toBeDisabled();
  await restorePasted(page, email);
  await expect(page.locator('#response')).toHaveText(email);
  await expect(page.locator('#response-status')).toContainText('0 private values restored locally');
  await expect(page.locator('#response')).not.toContainText(originalEmail);
});

test('a delayed restoration cannot display or enable copying after the response is edited', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    window.releaseRestorations = [];
    window.Worker = class extends NativeWorker {
      postMessage(message, ...options) {
        if (message.type === 'restore' && window.delayRestorations) {
          window.releaseRestorations.push(() => super.postMessage(message, ...options));
        } else super.postMessage(message, ...options);
      }
    };
  });
  await prepareWorkspace(page);
  const [, email] = await scanOriginal(page);
  await page.evaluate(() => {
    window.delayRestorations = true;
  });
  await page.getByLabel('AI response', { exact: true }).fill(email);
  await page.getByRole('button', { name: 'Restore pasted response' }).click();
  await expect.poll(() => page.evaluate(() => window.releaseRestorations.length)).toBe(1);
  await page
    .getByLabel('AI response', { exact: true })
    .fill('Edited before restoration completed.');
  await page.evaluate(() => {
    window.delayRestorations = false;
    window.releaseRestorations.shift()();
  });
  await restorePasted(page, 'Edited before restoration completed.');
  await expect(page.locator('#response')).toHaveText('Edited before restoration completed.');
  await expect(page.locator('#response')).not.toContainText(originalEmail);
  await page.evaluate(() => {
    window.delayRestorations = true;
  });
  await page.getByLabel('AI response', { exact: true }).fill(email);
  await page.getByRole('button', { name: 'Restore pasted response' }).click();
  await expect.poll(() => page.evaluate(() => window.releaseRestorations.length)).toBe(1);
  await page.getByRole('button', { name: 'Clear session' }).click();
  await expect(page.getByRole('button', { name: 'Copy restored response' })).toBeDisabled();
  await expect(page.locator('#response-status')).toContainText('Private values cleared');
  await expect(page.locator('#response')).not.toContainText(originalEmail);
});

test('an automatic provider read cannot overwrite a manually pasted reply or send restored originals', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    window.restoreRequests = [];
    window.Worker = class extends NativeWorker {
      postMessage(message, ...options) {
        if (message.type === 'restore') window.restoreRequests.push(message.text);
        super.postMessage(message, ...options);
      }
    };
  });
  await prepareWorkspace(page, true);
  const [, email] = await scanOriginal(page);
  await page.getByRole('button', { name: 'Send sanitized message' }).click();
  await expect.poll(() => page.evaluate(() => typeof window.finishProviderRead)).toBe('function');
  const reply = `Private restored reply: ${email}`;
  await restorePasted(page, reply);
  await page.evaluate(async (email) => {
    window.finishProviderRead(`Outdated provider reply: ${email}`);
    // Allow the pending provider promise to finish; a canceled read must never reach the worker.
    await new Promise((resolve) => setTimeout(resolve, 0));
  }, email);
  expect(await page.evaluate(() => window.restoreRequests)).toEqual([reply]);
  // Explicit refresh remains available after switching to manual restoration.
  await expect(page.locator('#response')).toHaveText(`Private restored reply: ${originalEmail}`);
  await page.getByRole('button', { name: 'Refresh response' }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () => window.providerMessages.filter((message) => message.type === 'responses').length,
      ),
    )
    .toBe(2);
  await page.evaluate(
    (email) => window.finishProviderRead(`Fresh provider reply: ${email}`),
    email,
  );
  await expect(page.locator('#response')).toHaveText(`Fresh provider reply: ${originalEmail}`);
  const sent = await page.evaluate(() =>
    window.providerMessages.filter((message) => message.type === 'send-sanitized'),
  );
  expect(sent).toHaveLength(1);
  expect(sent[0].text).not.toContain(originalEmail);
  expect(sent[0].text).not.toContain(originalName);
});

test('clipboard denial keeps the restored text available with an inline error', async ({
  page,
}) => {
  await prepareWorkspace(page);
  const [, email] = await scanOriginal(page);
  await restorePasted(page, email);
  await page.evaluate(() => {
    window.rejectClipboard = true;
  });
  await page.getByRole('button', { name: 'Copy restored response' }).click();
  await expect(page.locator('#response-status')).toContainText('Clipboard access was denied');
  await expect(page.locator('#response')).toHaveText(originalEmail);
  await expect(page.getByRole('button', { name: 'Copy restored response' })).toBeEnabled();
  expect(await page.evaluate(() => window.clipboardWrites)).toEqual([]);
});

test('oversized pasted replies are rejected locally without truncation', async ({ page }) => {
  await prepareWorkspace(page);
  await page.getByLabel('AI response', { exact: true }).evaluate((input, limit) => {
    input.value = 'x'.repeat(limit + 1);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, MAX_SCAN_LENGTH);
  await expect(page.locator('#response-status')).toContainText('exceeds the local limit');
  await expect(page.getByRole('button', { name: 'Restore pasted response' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Copy restored response' })).toBeDisabled();
  expect(await page.getByLabel('AI response', { exact: true }).inputValue()).toHaveLength(
    MAX_SCAN_LENGTH + 1,
  );
});

test('only our background can discover the matching live workspace without receiving private data', async ({
  page,
}) => {
  await prepareWorkspace(page, true);
  await scanOriginal(page);
  const discovery = await page.evaluate(async () => {
    const listener = window.workspaceListeners[0];
    let unexpectedReplies = 0;
    const ownSender = { id: 'manual-restore-fixture' };
    const message = { type: 'locate-workspace', tabId: 7 };
    const denied = [
      [message, { ...ownSender, tab: { id: 7 } }],
      [message, { id: 'another-extension' }],
      [{ ...message, tabId: 8 }, ownSender],
      [{ ...message, tabId: '7' }, ownSender],
      [{ ...message, type: 'read-original-values' }, ownSender],
    ].map(([request, sender]) =>
      listener(request, sender, () => {
        unexpectedReplies++;
      }),
    );
    const trusted = await new Promise((resolve) => {
      const asyncReply = listener(message, ownSender, (reply) => resolve({ asyncReply, reply }));
    });
    return { denied, unexpectedReplies, trusted };
  });
  expect(discovery.denied).toEqual(Array(5).fill(undefined));
  expect(discovery.unexpectedReplies).toBe(0);
  expect(discovery.trusted).toEqual({
    asyncReply: true,
    reply: { tabId: 7, workspaceTabId: 11, windowId: 2 },
  });
});
