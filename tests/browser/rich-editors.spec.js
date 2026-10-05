import { test, expect, chromium } from '@playwright/test';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test.describe.configure({ mode: 'serial' });
let fixtureCode;
async function providerHtml(mode) {
  fixtureCode ||= build({
    entryPoints: ['tests/fixtures/rich-editor-provider.js'],
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
  }).then((result) => result.outputFiles[0].text);
  const script = (await fixtureCode).replace(/<\/script/gi, '<\\/script');
  const button =
    mode === 'chatgpt-form'
      ? '<button id="provider-send" type="submit" aria-label="Send" disabled><svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3L3 12h6v9h6v-9h6z" /></svg></button>'
      : '<button id="provider-send" type="button" aria-label="Send message" disabled>Send</button>';
  return `<!doctype html><html><body data-fixture-mode="${mode}"><form><div id="editor-mount"></div>${button}</form><article id="provider-response" aria-label="Assistant response"></article><script>${script}</script></body></html>`;
}

async function installedFixture(mode, run) {
  const profile = await mkdtemp(path.join(os.tmpdir(), 'leakguard-rich-editor-'));
  const extension = path.resolve('dist/chromium');
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  try {
    const worker = context.serviceWorkers()[0] || (await context.waitForEvent('serviceworker'));
    const extensionId = new URL(worker.url()).host;
    const host = mode === 'chatgpt-form' ? 'chatgpt.com' : 'claude.ai';
    const url = `https://${host}/local-rich-editor-${mode}`;
    const html = await providerHtml(mode);
    await context.route(url, (route) => route.fulfill({ contentType: 'text/html', body: html }));
    const provider = await context.newPage();
    await provider.goto(url);
    await expect(
      provider.getByRole('textbox', {
        name: mode === 'chatgpt-form' ? 'Message ChatGPT' : 'Message Claude',
      }),
    ).toBeVisible();
    const tabId = await worker.evaluate(
      async (url) => (await chrome.tabs.query({})).find((tab) => tab.url === url).id,
      url,
    );
    const workspace = await context.newPage();
    await workspace.goto(`chrome-extension://${extensionId}/src/ui/workspace.html?tab=${tabId}`);
    await expect(workspace.locator('#connection')).toContainText('Guard active');
    await run({ provider, workspace, context });
  } finally {
    await context.close();
    await rm(profile, { recursive: true, force: true });
  }
}

const original =
  'Name: Ferdinand Testmann\nAdresse: Beispielstraße 11, 10115 Berlin\n\nTelefon: +49 30 23125 000\nE-Mail: fixture@example.com\nMarkdown\\: keep\\this\\literal';

for (const mode of ['normal', 'replace-controls']) {
  test(`installed guard safely sends multiline rich-editor model (${mode}) and restores privately`, async ({}, info) => {
    test.skip(
      info.project.name !== 'chromium',
      'Actual installed extension regression runs in Chromium.',
    );
    await installedFixture(mode, async ({ provider, workspace }) => {
      await workspace.locator('#draft').fill(original);
      await workspace.locator('#scan').click();
      await expect(workspace.locator('#send')).toBeEnabled();
      const sanitized = await workspace.locator('#preview').textContent();
      expect(sanitized).toContain('[[LG_');
      for (const value of ['Ferdinand Testmann', 'Beispielstraße', '23125', 'fixture@example.com'])
        expect(sanitized).not.toContain(value);
      await workspace.locator('#send').click();
      await expect(workspace.locator('#status')).toContainText('handed to the provider');
      const snapshot = await provider.evaluate(() => globalThis.richEditorFixture.snapshot());
      expect(snapshot.messages).toEqual([sanitized]);
      expect(snapshot.modelText).toBe(sanitized);
      expect(snapshot.paragraphs).toBe(original.split('\n').length);
      expect(snapshot.modelText).toContain('Markdown\\: keep\\this\\literal');
      expect(snapshot.replacementCount).toBe(mode === 'replace-controls' ? 1 : 0);
      await expect(workspace.locator('#response')).toContainText('Ferdinand Testmann');
      await expect(workspace.locator('#response')).toContainText('fixture@example.com');
      await expect(provider.getByRole('article', { name: 'Assistant response' })).not.toContainText(
        'fixture@example.com',
      );
      // Native sends remain blocked after the single extension-authorized click.
      await provider.getByRole('button', { name: 'Send message' }).click({ force: true });
      expect(
        (await provider.evaluate(() => globalThis.richEditorFixture.snapshot())).messages,
      ).toHaveLength(1);
    });
  });
}

test('installed guard rejects provider changes beyond paragraph normalization', async ({}, info) => {
  test.skip(
    info.project.name !== 'chromium',
    'Actual installed extension regression runs in Chromium.',
  );
  await installedFixture('changed-content', async ({ provider, workspace }) => {
    await workspace.locator('#draft').fill(original);
    await workspace.locator('#scan').click();
    await expect(workspace.locator('#send')).toBeEnabled();
    await workspace.locator('#send').click();
    await expect(workspace.locator('#status')).toContainText(
      'changed the sanitized message content',
    );
    const snapshot = await provider.evaluate(() => globalThis.richEditorFixture.snapshot());
    expect(snapshot.changed).toBe(true);
    expect(snapshot.messages).toEqual([]);
    await expect(provider.getByRole('article', { name: 'Assistant response' })).toBeEmpty();
  });
});

test('installed ChatGPT-like rich form blocks native Enter, clicks and submit, imports the draft, then permits one sanitized form submission', async ({}, info) => {
  test.skip(
    info.project.name !== 'chromium',
    'Actual installed extension regression runs in Chromium.',
  );
  await installedFixture('chatgpt-form', async ({ provider, workspace, context }) => {
    // Initial workspace health has confirmed the document_start guard before exercising native UI.
    await workspace.close();
    const editor = provider.getByRole('textbox', { name: 'Message ChatGPT' });
    const send = provider.getByRole('button', { name: 'Send', exact: true });
    await editor.fill(original);
    await expect(send).toBeEnabled();
    await editor.press('Shift+Enter');
    expect(
      (await provider.evaluate(() => globalThis.richEditorFixture.snapshot())).messages,
    ).toEqual([]);
    await editor.press('Enter');
    let snapshot = await provider.evaluate(() => globalThis.richEditorFixture.snapshot());
    expect(snapshot.messages).toEqual([]);
    expect(snapshot.submitCount).toBe(0);
    await provider.keyboard.press('Escape');
    await send.click({ force: true });
    snapshot = await provider.evaluate(() => globalThis.richEditorFixture.snapshot());
    expect(snapshot.messages).toEqual([]);
    expect(snapshot.submitCount).toBe(0);
    await provider.keyboard.press('Escape');
    await provider.evaluate(() =>
      document
        .getElementById('provider-send')
        .form.requestSubmit(document.getElementById('provider-send')),
    );
    expect(
      (await provider.evaluate(() => globalThis.richEditorFixture.snapshot())).submitCount,
    ).toBe(0);
    const popup = context.waitForEvent('page');
    await provider.keyboard.press('Enter');
    const privateWorkspace = await popup;
    await expect
      .poll(() => privateWorkspace.locator('#draft').inputValue())
      .toContain('Ferdinand Testmann');
    await expect(privateWorkspace.locator('#connection')).toContainText('Guard active');
    await expect(privateWorkspace.locator('#send')).toBeDisabled();
    await privateWorkspace.locator('#scan').click();
    await expect(privateWorkspace.locator('#send')).toBeEnabled();
    const sanitized = await privateWorkspace.locator('#preview').textContent();
    await privateWorkspace.locator('#send').click();
    await expect(privateWorkspace.locator('#status')).toContainText('handed to the provider');
    snapshot = await provider.evaluate(() => globalThis.richEditorFixture.snapshot());
    expect(snapshot.messages).toEqual([sanitized]);
    expect(snapshot.submitCount).toBe(1);
    for (const value of ['Ferdinand Testmann', 'Beispielstraße', '23125', 'fixture@example.com'])
      expect(snapshot.messages[0]).not.toContain(value);
    await expect(privateWorkspace.locator('#response')).toContainText('fixture@example.com');
  });
});
