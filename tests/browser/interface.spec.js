import { test, expect } from '@playwright/test';
import { PROVIDERS } from '../../src/core/providers.js';
import { DEFAULT_POLICY } from '../../src/core/policy.js';
import { EDITION } from '../../src/core/edition.js';
const settingsName = EDITION.customSites ? 'Policy settings' : 'Personal settings';
test('dashboard and searchable local library render without errors', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/admin.html');
  await expect(page.locator('#sample-count')).toHaveText(/\d/);
  await expect(page.getByRole('link', { name: EDITION.title, exact: true })).toBeVisible();
  await expect(page.locator('#provider-count')).toHaveText('30');
  await page.screenshot({
    path: `test-results/dashboard-${test.info().project.name}.png`,
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Sample library', exact: true }).click();
  await page.getByLabel('Search samples').fill('phone.nanp');
  await expect(page.locator('#sample-list .sample-row').first()).toBeVisible();
  await page.locator('#sample-list .sample-row').first().click();
  await expect(page.locator('#sample-redacted')).toContainText('[[LG_');
  await expect(page.locator('#sample-note')).toContainText('PHONE');
  await page.screenshot({
    path: `test-results/admin-${test.info().project.name}.png`,
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Providers', exact: true }).click();
  await page.screenshot({
    path: `docs/previews/providers-${test.info().project.name}.png`,
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
test('private worker redacts data and clearing destroys the session view', async ({ page }) => {
  await page.goto('/workspace.html');
  await expect(page.locator('#scan')).toBeEnabled();
  await page
    .locator('#draft')
    .fill(
      'Name: Jane Testerton\nEmail: jane@example.com\nPhone: +1 202-555-0123\nPassword: synthetic-private-password',
    );
  await page.locator('#scan').click();
  await expect(page.locator('#preview')).toBeVisible();
  const value = await page.locator('#preview').textContent();
  expect(value).not.toContain('jane@example.com');
  expect(value).not.toContain('Jane Testerton');
  expect(value).not.toContain('202-555-0123');
  expect(value).not.toContain('synthetic-private-password');
  await expect(page.locator('#send')).toBeDisabled();
  await page.screenshot({
    path: `test-results/workspace-${test.info().project.name}.png`,
    fullPage: true,
  });
  await page.locator('#clear').click();
  await expect(page.locator('#draft')).toHaveValue('');
  await expect(page.locator('#preview')).toBeHidden();
});
test('admin changes persist and prohibited content cannot be sent', async ({ page }) => {
  await page.goto('/admin.html');
  await page.getByRole('button', { name: settingsName, exact: true }).click();
  await page.locator('#blocked').fill('DO NOT EXPORT');
  await page.locator('#save').click();
  await expect(page.locator('#status')).toHaveText(
    EDITION.customSites ? 'Policy saved.' : 'Settings saved.',
  );
  await page.goto('/workspace.html');
  await page.locator('#draft').fill('This note says DO NOT EXPORT.');
  await page.locator('#scan').click();
  await expect(page.locator('#status')).toContainText('Blocked by policy');
  await expect(page.locator('#send')).toBeDisabled();
});
test('narrow layouts keep navigation and composer usable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/workspace.html');
  await expect(page.locator('#draft')).toBeVisible();
  const overflows = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(overflows).toBe(false);
});

test('edition respects managed-policy capability and keeps unsupported protection blocked', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const policy = {
      sites: [{ host: 'example.com' }],
      redactEmails: true,
      redactPhones: true,
      redactCards: true,
      redactIdentifiers: true,
      sensitiveTerms: ['Internal Test Fixture'],
      blockTerms: [],
    };
    window.chrome = {
      runtime: { id: 'test-fixture' },
      storage: {
        managed: {
          async get() {
            return { policy: JSON.stringify(policy) };
          },
        },
        local: {
          async get() {
            return { policy: JSON.stringify({ sites: [{ host: 'chatgpt.com' }] }) };
          },
          async set() {
            throw new Error('Managed policy must not write local storage.');
          },
        },
        onChanged: { addListener() {} },
      },
    };
  });
  await page.goto('/admin.html');
  await page.getByRole('button', { name: settingsName, exact: true }).click();
  await expect(page.locator('#save')).toBeDisabled();
  await expect(page.locator('#add-catalog')).toBeDisabled();
  if (EDITION.managedPolicies) {
    await expect(page.locator('#mode')).toHaveText('Company managed');
    await expect(page.locator('#policy')).toBeDisabled();
    await expect(page.locator('#sensitive')).toHaveValue('Internal Test Fixture');
  } else {
    await expect(page.locator('#mode')).toHaveText('Protection blocked');
    await expect(page.locator('#policy')).toHaveCount(0);
    await expect(page.locator('#status')).toContainText(
      'does not support company-managed policies',
    );
    await expect(page.locator('#sensitive')).toBeDisabled();
    await page.goto('/workspace.html');
    await expect(page.locator('#scan')).toBeDisabled();
    await expect(page.locator('#send')).toBeDisabled();
    await expect(page.locator('#connection')).toHaveText('Protection blocked');
    await expect(page.locator('#status')).toContainText(
      'does not support company-managed policies',
    );
  }
});

test('enabling curated providers preserves saved private terms and is idempotent', async ({
  page,
}) => {
  await page.addInitScript(
    (policy) => localStorage.setItem('guard-policy', JSON.stringify(policy)),
    {
      ...DEFAULT_POLICY,
      sites: [{ host: EDITION.customSites ? 'example.ai' : 'chatgpt.com' }],
      sensitiveTerms: ['ACME_PRIVATE'],
      blockTerms: ['DO_NOT_EXPORT'],
    },
  );
  await page.goto('/admin.html');
  await page.getByRole('button', { name: 'Providers', exact: true }).click();
  await page.getByRole('button', { name: `Enable all ${PROVIDERS.length} providers` }).click();
  await expect(page.locator('#provider-count')).toHaveText(
    String(PROVIDERS.length + (EDITION.customSites ? 1 : 0)),
  );
  const policy = await page.evaluate(() => JSON.parse(localStorage.getItem('guard-policy')));
  expect(policy.sensitiveTerms).toEqual(['ACME_PRIVATE']);
  expect(policy.blockTerms).toEqual(['DO_NOT_EXPORT']);
  expect(policy.sites.some((site) => site.host === 'example.ai')).toBe(EDITION.customSites);
  await expect(page.locator('.provider-card')).toHaveCount(
    PROVIDERS.length + (EDITION.customSites ? 1 : 0),
  );
  await expect(page.getByRole('button', { name: 'Show more providers' })).toBeHidden();
  await page
    .getByRole('searchbox', { name: 'Search configured providers' })
    .fill(EDITION.customSites ? 'example.ai' : 'claude');
  await expect(page.locator('.provider-card')).toHaveCount(1);
  await expect(page.locator('.provider-card')).toContainText(
    EDITION.customSites ? 'example.ai' : 'claude.ai',
  );
  await page.locator('#add-catalog').click();
  const repeated = await page.evaluate(() => JSON.parse(localStorage.getItem('guard-policy')));
  expect(repeated.sites).toEqual(policy.sites);
});

test('public preferences choose curated providers without an advanced policy editor', async ({
  page,
}) => {
  test.skip(EDITION.customSites, 'The Corporate edition supports its advanced policy editor.');
  await page.goto('/admin.html');
  await page.getByRole('button', { name: settingsName, exact: true }).click();
  await expect(page.locator('#policy')).toHaveCount(0);
  await expect(page.locator('#site-controls input')).toHaveCount(30);
  await page.getByRole('checkbox', { name: 'Enable Claude', exact: true }).uncheck();
  await page.locator('#sensitive').fill('PERSONAL_PRIVATE_TERM');
  await page.locator('#save').click();
  await expect(page.locator('#status')).toHaveText('Settings saved.');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('guard-policy')));
  expect(saved.sites.some((site) => site.host === 'claude.ai')).toBe(false);
  expect(saved.sites.every((site) => Object.keys(site).length === 1)).toBe(true);
  expect(saved.sensitiveTerms).toEqual(['PERSONAL_PRIVATE_TERM']);
  await page.reload();
  await page.getByRole('button', { name: settingsName, exact: true }).click();
  await expect(
    page.getByRole('checkbox', { name: 'Enable Claude', exact: true }),
  ).not.toBeChecked();
  await page.screenshot({
    path: `docs/previews/personal-settings-${test.info().project.name}.png`,
    fullPage: true,
  });
});

test('private scanner catches unlabelled German contacts and Cyrillic regional records', async ({
  page,
}) => {
  await page.goto('/workspace.html');
  await expect(page.locator('#scan')).toBeEnabled();
  await page
    .locator('#draft')
    .fill(
      'beispielstraße 11  Ferdinand Testmann +49 30 23125 000\nИван Примеров\nул. Тестовая 42\nИИН: 000000000000',
    );
  await page.locator('#scan').click();
  await expect(page.locator('#preview')).toBeVisible();
  const redacted = await page.locator('#preview').textContent();
  for (const privateValue of [
    'beispielstraße',
    'Ferdinand Testmann',
    '23125',
    'Иван Примеров',
    'Тестовая',
    '000000000000',
  ])
    expect(redacted).not.toContain(privateValue);
  for (const kind of ['ADDRESS', 'PERSON', 'PHONE', 'ID'])
    expect(redacted).toContain('_' + kind + '_');
});
