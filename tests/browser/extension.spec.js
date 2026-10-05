import { test, expect, chromium } from '@playwright/test';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import { PROVIDERS } from '../../src/core/providers.js';
test.describe.configure({ mode: 'serial' });
test('Chromium extension sends only sanitized text and restores privately', async ({}, info) => {
  test.skip(
    info.project.name !== 'chromium',
    'Chromium-only installation smoke test; Firefox/WebKit UI tested separately.',
  );
  const dir = await mkdtemp(path.join(os.tmpdir(), 'leakguard-browser-'));
  const extension = path.resolve('dist/chromium');
  const context = await chromium.launchPersistentContext(dir, {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  try {
    let worker = context.serviceWorkers()[0];
    if (!worker) worker = await context.waitForEvent('serviceworker');
    const id = new URL(worker.url()).host;
    await context.route('https://chatgpt.com/guard-test', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: semanticFixture('fixture-editor', 'fixture-send', 'fixture-response'),
      }),
    );
    const provider = await context.newPage();
    await provider.goto('https://chatgpt.com/guard-test');
    // Confirm document_start content script is ready, then obtain this controlled provider's tab id.
    const tabId = await worker.evaluate(async () => {
      const tabs = await chrome.tabs.query({});
      return tabs.find((t) => t.url === 'https://chatgpt.com/guard-test').id;
    });
    const original = 'Email: jane@example.com\nPhone: +1 202-555-0123';
    await provider.getByRole('textbox', { name: 'Message' }).fill(original);
    await provider.getByRole('button', { name: 'Send message' }).click({ force: true });
    await expect(provider.getByRole('article', { name: 'Assistant response' })).toBeEmpty();
    await provider.waitForTimeout(200); // Capture the modal after its brief entrance animation.
    await provider.screenshot({ path: 'docs/previews/modal-chromium.png' });
    // The closed-root modal focuses its primary action; Enter opens the private workspace.
    const opened = context.waitForEvent('page');
    await provider.keyboard.press('Enter');
    const workspace = await opened;
    workspace.on('pageerror', (e) => console.log('Extension page error:', e.message));
    await expect(workspace).toHaveURL(new RegExp(`chrome-extension://${id}/src/ui/workspace.html`));
    await expect(workspace.locator('#draft')).toHaveValue(original);
    await expect(workspace.locator('#connection')).toContainText('Guard active');
    await expect(workspace.locator('#status')).toContainText('Your blocked message is here');
    expect(new URL(workspace.url()).searchParams.has('draft')).toBe(false);
    expect(new URL(workspace.url()).searchParams.get('tab')).toBe(String(tabId));
    expect(workspace.url()).not.toContain('jane@example.com');
    await expect(workspace.locator('#send')).toBeDisabled();
    await expect(provider.getByRole('article', { name: 'Assistant response' })).toBeEmpty();
    await workspace.locator('#scan').click();
    await expect(workspace.locator('#send')).toBeEnabled();
    await workspace.locator('#send').click();
    await expect(workspace.locator('#status')).toContainText('handed to the provider');
    const remote = await provider
      .getByRole('article', { name: 'Assistant response' })
      .textContent();
    expect(remote).toContain('[[LG_');
    expect(remote).not.toContain('jane@example.com');
    expect(remote).not.toContain('202-555-0123');
    await expect(workspace.locator('#response')).toContainText('jane@example.com');
    await expect(workspace.locator('#response')).toContainText('202-555-0123');
    expect(
      await provider.getByRole('article', { name: 'Assistant response' }).textContent(),
    ).toEqual(remote);
    // Paste a copied AI answer into the real extension, keeping restoration private.
    const replyTokens = remote.match(/\[\[LG_[A-Za-z0-9_-]+\]\]/g);
    expect(replyTokens).toHaveLength(2);
    const pasted = `Copied AI answer:\nEmail: ${replyTokens[0]}\nPhone: ${replyTokens[1]}\n[[LG_unknown_EMAIL_999]]`;
    await workspace.getByLabel('AI response', { exact: true }).fill(pasted);
    await workspace.getByRole('button', { name: 'Restore pasted response' }).click();
    await expect(workspace.locator('#response')).toHaveText(
      `Copied AI answer:\n${original}\n[[LG_unknown_EMAIL_999]]`,
    );
    await expect(workspace.getByRole('button', { name: 'Copy restored response' })).toBeEnabled();
    await expect(workspace.locator('#response-status')).toContainText(
      '1 unrecognized placeholder kept unchanged',
    );
    const foundWorkspace = await worker.evaluate(
      (tabId) => chrome.runtime.sendMessage({ type: 'locate-workspace', tabId }),
      tabId,
    );
    expect(foundWorkspace.tabId).toBe(tabId);
    expect(Number.isInteger(foundWorkspace.workspaceTabId)).toBe(true);
    expect(foundWorkspace.workspaceTabId).not.toBe(tabId);
    expect(Number.isInteger(foundWorkspace.windowId)).toBe(true);
    expect(
      await provider.getByRole('article', { name: 'Assistant response' }).textContent(),
    ).toEqual(remote);
    // A cleared vault must never reinterpret an old provider token as new data.
    await workspace.locator('#clear').click();
    await workspace.locator('#draft').fill('Email: bob@example.com');
    await workspace.locator('#scan').click();
    await expect(workspace.locator('#preview')).toBeVisible();
    await workspace.locator('#read').click();
    await expect(workspace.locator('#response')).toContainText('[[LG_');
    await expect(workspace.locator('#response')).not.toContainText('jane@example.com');
    await expect(workspace.locator('#response')).not.toContainText('bob@example.com');
  } finally {
    await context.close();
    await rm(dir, { recursive: true, force: true });
  }
});

function semanticFixture(editorId, buttonId, responseId) {
  return `<!doctype html><html><body><div id="${editorId}" contenteditable="true" role="textbox" aria-label="Message"></div><button id="${buttonId}" aria-label="Send message">Send</button><article id="${responseId}" aria-label="Assistant response"></article><script>document.getElementById('${buttonId}').addEventListener('click',()=>{document.getElementById('${responseId}').textContent='Echo: '+document.getElementById('${editorId}').textContent;});</script></body></html>`;
}

test('Chromium repairs an existing tab and blocks retained inaccessible drafts', async ({}, info) => {
  test.skip(info.project.name !== 'chromium', 'Installed Chromium guard regression.');
  const dir = await mkdtemp(path.join(os.tmpdir(), 'leakguard-repair-'));
  const extension = path.resolve('dist/chromium');
  const context = await chromium.launchPersistentContext(dir, {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  try {
    const worker = context.serviceWorkers()[0] || (await context.waitForEvent('serviceworker'));
    const id = new URL(worker.url()).host;
    const url = 'https://chatgpt.com/guard-repair-test';
    await context.route(url, (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: semanticFixture('editor', 'send', 'response'),
      }),
    );
    const provider = await context.newPage();
    await provider.goto(url);
    const tabId = await worker.evaluate(
      async (url) => (await chrome.tabs.query({})).find((tab) => tab.url === url).id,
      url,
    );
    await expect
      .poll(
        () =>
          worker.evaluate(async (tabId) => {
            try {
              return await chrome.tabs.sendMessage(tabId, { type: 'guard-status' }, { frameId: 0 });
            } catch (error) {
              return { error: error.message };
            }
          }, tabId),
        { timeout: 10000 },
      )
      .toMatchObject({ ready: true, configured: true, failed: false });
    // Simulate an already-open tab missing its content guard, without reloading its document.
    await worker.evaluate(
      async (tabId) =>
        chrome.scripting.executeScript({
          target: { tabId },
          func: () => globalThis.__aiLeakGuardContentGuard.destroy(),
        }),
      tabId,
    );
    await provider.evaluate(() => {
      window.repairSentinel = 'preserved';
      window.submissions = 0;
      document.getElementById('send').addEventListener('click', () => window.submissions++);
    });
    const workspace = await context.newPage();
    await workspace.goto(`chrome-extension://${id}/src/ui/workspace.html?tab=${tabId}`);
    await expect(workspace.locator('#connection')).toContainText('Guard active');
    expect(await provider.evaluate(() => window.repairSentinel)).toBe('preserved');
    // Reinjection of the same guard must leave a single capture/message installation.
    await worker.evaluate(async (tabId) => {
      for (let i = 0; i < 2; i++)
        await chrome.scripting.executeScript({
          target: { tabId },
          files: ['content.bundle.js'],
        });
    }, tabId);
    await provider.evaluate(() => {
      document.body.setAttribute('aria-hidden', 'true');
      document.getElementById('editor').textContent = 'Email: demo@example.com';
    });
    await provider.locator('#send').click({ force: true });
    expect(await provider.evaluate(() => window.submissions)).toBe(0);
    await provider.keyboard.press('Escape');
    await provider.evaluate(() => {
      document.body.removeAttribute('aria-hidden');
      const field = document.createElement('textarea');
      field.id = 'editor';
      field.readOnly = true;
      field.value = 'Email: demo@example.com';
      document.getElementById('editor').replaceWith(field);
      document.getElementById('send').setAttribute('aria-label', 'Go');
    });
    await provider.locator('#send').click({ force: true });
    expect(await provider.evaluate(() => window.submissions)).toBe(0);
  } finally {
    await context.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('all 30 curated services block native sends with edition modals', async ({}, info) => {
  test.skip(
    info.project.name !== 'chromium',
    'Installed extension guard integration runs in Chromium.',
  );
  test.setTimeout(120_000);
  const dir = await mkdtemp(path.join(os.tmpdir(), 'leakguard-catalog-'));
  const extension = path.resolve('dist/chromium');
  const context = await chromium.launchPersistentContext(dir, {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  try {
    let worker = context.serviceWorkers()[0];
    if (!worker) worker = await context.waitForEvent('serviceworker');
    const id = new URL(worker.url()).host;
    const workspace = await context.newPage();
    const services = PROVIDERS;
    expect(services).toHaveLength(30);
    for (const [index, service] of services.entries()) {
      const url = `https://${service.hosts[0]}/guard-catalog-test`;
      await context.route(url, (route) =>
        route.fulfill({
          contentType: 'text/html',
          body: semanticFixture(`edit-${index}`, `send-${index}`, `reply-${index}`),
        }),
      );
      const provider = await context.newPage();
      let browserDialogs = 0;
      provider.on('dialog', async (dialog) => {
        browserDialogs++;
        await dialog.dismiss();
      });
      await provider.goto(url);
      const editor = provider.getByRole('textbox', { name: 'Message' });
      await editor.fill(
        'Name: Ferdinand Testmann\nAddress: Beispielstraße 11\nPhone: +49 30 23125 000',
      );
      await provider.getByRole('button', { name: 'Send message' }).click({ force: true });
      await expect(provider.getByRole('article', { name: 'Assistant response' })).toBeEmpty();
      await expect
        .poll(() =>
          provider.evaluate(
            () =>
              Array.from(document.getElementsByTagName('*')).filter((el) =>
                el.hasAttribute('data-ai-leak-guard-root'),
              ).length,
          ),
        )
        .toBe(1);
      expect(browserDialogs).toBe(0);
      expect(
        await provider.evaluate(() => {
          const root = Array.from(document.getElementsByTagName('*')).find((el) =>
            el.hasAttribute('data-ai-leak-guard-root'),
          );
          return (
            root.shadowRoot === null && root.hidden === false && document.activeElement === root
          );
        }),
      ).toBe(true);
      await provider.keyboard.press('Escape');
      const tabId = await worker.evaluate(
        async (url) => (await chrome.tabs.query({})).find((tab) => tab.url === url).id,
        url,
      );
      await workspace.goto(`chrome-extension://${id}/src/ui/workspace.html?tab=${tabId}`);
      await expect(workspace.locator('#status')).toContainText('Ready.');
      await workspace
        .locator('#draft')
        .fill('Name: Ferdinand Testmann\nAddress: Beispielstraße 11\nPhone: +49 30 23125 000');
      await workspace.locator('#scan').click();
      await expect(workspace.locator('#send')).toBeEnabled();
      await workspace.locator('#send').click();
      await expect(workspace.locator('#status')).toContainText('handed to the provider');
      const remote = await provider
        .getByRole('article', { name: 'Assistant response' })
        .textContent();
      expect(remote).toContain('[[LG_');
      for (const value of ['Ferdinand Testmann', 'Beispielstraße', '23125'])
        expect(remote).not.toContain(value);
      await provider.close();
    }
  } finally {
    await context.close();
    await rm(dir, { recursive: true, force: true });
  }
});
