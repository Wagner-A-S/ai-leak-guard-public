import { EDITION } from '../../src/core/edition.js';
import { test, expect } from '@playwright/test';
import { EXTENSION_VERSION } from '../../src/core/build-info.js';
import { readFile } from 'node:fs/promises';

async function mockExtension(page, guard, draft) {
  await page.addInitScript(
    ({ guard, draft }) => {
      window.guardMessages = [];
      window.tabMessages = [];
      window.chrome = {
        runtime: {
          id: 'guard-ui-fixture',
          async sendMessage(message) {
            window.guardMessages.push(message);
            return guard;
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
              return {};
            },
            async set() {},
          },
          onChanged: { addListener() {} },
        },
        tabs: {
          async get() {
            return { id: 7, url: 'https://chatgpt.com/' };
          },
          async sendMessage(tabId, message) {
            window.tabMessages.push({ tabId, message });
            if (message.type === 'take-draft') return { text: draft };
            throw new Error('No send was expected.');
          },
        },
      };
    },
    { guard, draft },
  );
}

test('a configured provider with no installed guard can scan locally but cannot send', async ({
  page,
}) => {
  await mockExtension(page, { error: 'The page guard is unavailable.' });
  await page.goto('/src/ui/workspace.html?tab=7');
  await expect(page.locator('#connection')).toHaveText('Page guard unavailable');
  await expect(page.locator('#status')).toContainText('sending is disabled');
  await page.locator('#draft').fill('Email: demo@example.com');
  await page.locator('#scan').click();
  await expect(page.locator('#preview')).toContainText('[[LG_');
  await expect(page.locator('#send')).toBeDisabled();
  expect(await page.evaluate(() => window.tabMessages)).toEqual([]);
});

test('an older tab guard requires reconnection and cannot enable sending', async ({ page }) => {
  await mockExtension(page, {
    ok: true,
    ready: true,
    configured: true,
    failed: false,
    host: 'chatgpt.com',
    version: '0.3.0',
  });
  await page.goto('/src/ui/workspace.html?tab=7');
  await expect(page.locator('#status')).toContainText('older guard');
  await expect(page.getByRole('button', { name: 'Reconnect guard' })).toBeVisible();
  await page.locator('#draft').fill('Email: demo@example.com');
  await page.locator('#scan').click();
  await expect(page.locator('#preview')).toBeVisible();
  await expect(page.locator('#send')).toBeDisabled();
});

test('blocked multiline text appears unreviewed in the original-message field', async ({
  page,
}) => {
  const original = 'Name: Мария Тестова\nAddress: Примерная улица 11\nEmail: demo@example.com';
  const handoffId = '12345678-1234-1234-1234-123456789abc';
  await mockExtension(
    page,
    {
      ok: true,
      ready: true,
      configured: true,
      failed: false,
      host: 'chatgpt.com',
      version: EXTENSION_VERSION,
    },
    original,
  );
  await page.goto(`/src/ui/workspace.html?tab=7&draft=${handoffId}`);
  await expect(page.locator('#draft')).toHaveValue(original);
  await expect(page.locator('#status')).toContainText('Your blocked message is here');
  await expect(page.locator('#connection')).toContainText('Guard active');
  await expect(page.locator('#preview')).toBeHidden();
  await expect(page.locator('#send')).toBeDisabled();
  expect(new URL(page.url()).searchParams.has('draft')).toBe(false);
  expect(await page.evaluate(() => window.guardMessages)).toEqual([
    { type: 'guard-status', tabId: 7 },
  ]);
  expect(await page.evaluate(() => window.tabMessages)).toEqual([
    { tabId: 7, message: { type: 'take-draft', handoffId } },
  ]);
});

test('saved support details exclude the original draft, tokens and transfer identity', async ({
  page,
}) => {
  const original = 'Email: private-demo@example.com\nPhone: +1 202-555-0123';
  const handoffId = '12345678-1234-1234-1234-123456789abc';
  await mockExtension(
    page,
    {
      ok: true,
      ready: true,
      configured: true,
      failed: false,
      host: 'chatgpt.com',
      version: EXTENSION_VERSION,
      editor: { composer: 'ready', send: 'disabled', attachments: 'none' },
    },
    original,
  );
  await page.goto(`/src/ui/workspace.html?tab=7&draft=${handoffId}`);
  await expect(page.locator('#draft')).toHaveValue(original);
  await page.locator('#scan').click();
  await expect(page.locator('#preview')).toContainText('[[LG_');
  await page.getByText('Connection & support details', { exact: true }).click();
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save support details' }).click();
  const download = await pending;
  expect(download.suggestedFilename()).toBe(`${EDITION.slug}-support.json`);
  const value = await readFile(await download.path(), 'utf8');
  const report = JSON.parse(value);
  expect(report.version).toBe(EXTENSION_VERSION);
  expect(report.provider).toBe('chatgpt.com');
  expect(report.protection).toBe('Guard verified');
  for (const secret of ['private-demo@example.com', '202-555-0123', '[[LG_', handoffId])
    expect(value).not.toContain(secret);
  expect(Object.keys(report)).not.toContain('tab');
});
