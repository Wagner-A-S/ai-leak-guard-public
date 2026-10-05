import { test, expect } from '@playwright/test';
import { EDITION } from '../../src/core/edition.js';

test('phone region uses a searchable modal with every supported region and persists the choice', async ({
  page,
}) => {
  await page.goto('/admin.html');
  await expect(page.locator('select')).toHaveCount(0);
  await page.getByRole('button', { name: 'Detection rules', exact: true }).click();
  const trigger = page.getByRole('button', {
    name: 'Local phone number region: United States',
    exact: true,
  });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Choose phone region' });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.choice-option')).toHaveCount(245);
  await expect(dialog.getByLabel('Search regions')).toBeFocused();
  await dialog.getByLabel('Search regions').fill('Россия');
  await expect(dialog.locator('.choice-option')).toHaveCount(1);
  await dialog.getByRole('button', { name: 'Россия · Russia RU', exact: true }).click();
  await expect(dialog).toBeHidden();
  const russian = page.getByRole('button', {
    name: 'Local phone number region: Россия · Russia',
    exact: true,
  });
  await expect(russian).toBeFocused();
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() => JSON.parse(localStorage.getItem('guard-policy')).defaultCountry),
    )
    .toBe('RU');
  await page.reload();
  await page.getByRole('button', { name: 'Detection rules', exact: true }).click();
  await expect(russian).toBeVisible();
});

test('choice modal traps focus, supports keyboard choices, and cancels without changes', async ({
  page,
}) => {
  await page.goto('/admin.html');
  await page.getByRole('button', { name: 'Detection rules', exact: true }).click();
  const trigger = page.getByRole('button', {
    name: 'Local phone number region: United States',
    exact: true,
  });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Choose phone region' });
  await dialog.getByLabel('Search regions').fill('DE');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).focus();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Close choice dialog' })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
  await expect(trigger).toHaveAttribute('value', 'US');
  await trigger.click();
  await dialog.getByLabel('Search regions').fill('Germany');
  await page.keyboard.press('ArrowDown');
  await expect(dialog.getByRole('button', { name: 'Germany DE', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(dialog).toBeHidden();
  await expect(
    page.getByRole('button', { name: 'Local phone number region: Germany', exact: true }),
  ).toHaveAttribute('value', 'DE');
});

test('sample category and case type filters open modals and update the local library', async ({
  page,
}) => {
  await page.goto('/admin.html');
  await page.getByRole('button', { name: 'Sample library', exact: true }).click();
  await expect(page.locator('#sample-list .sample-row').first()).toBeVisible();
  await page.getByRole('button', { name: 'Sample category: All categories', exact: true }).click();
  const categories = page.getByRole('dialog', { name: 'Choose sample category' });
  await categories.getByLabel('Search categories').fill('phone.nanp');
  await categories.getByRole('button', { name: 'phone.nanp', exact: true }).click();
  await expect(page.locator('#sample-list .sample-row strong').first()).toHaveText('phone.nanp');
  await page.getByRole('button', { name: 'Sample case type: All cases', exact: true }).click();
  const types = page.getByRole('dialog', { name: 'Choose case type' });
  await types.getByRole('button', { name: 'Safe text', exact: true }).click();
  await expect(page.locator('#sample-results')).toHaveText('0 cases');
  await page.getByRole('button', { name: 'Sample category: phone.nanp', exact: true }).click();
  await categories.getByRole('button', { name: 'All categories', exact: true }).click();
  await expect(page.locator('#sample-list .sample-row.safe').first()).toBeVisible();
  await expect(page.locator('#sample-list .sample-row:not(.safe)')).toHaveCount(0);
});

test('choice modal remains usable on a narrow screen and retains managed-policy locking', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/admin.html');
  await page.getByRole('button', { name: 'Detection rules', exact: true }).click();
  await page
    .getByRole('button', { name: 'Local phone number region: United States', exact: true })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Choose phone region' });
  await expect(dialog.getByLabel('Search regions')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.screenshot({
    path: `test-results/phone-region-modal-${test.info().project.name}.png`,
    fullPage: false,
  });
  await page.keyboard.press('Escape');
  await page.addInitScript(() => {
    window.chrome = {
      runtime: { id: 'managed-fixture' },
      storage: {
        managed: {
          async get() {
            return {
              policy: JSON.stringify({
                sites: [{ host: 'example.com' }],
                redactEmails: true,
                redactPhones: true,
                redactCards: true,
                redactIdentifiers: true,
                defaultCountry: 'KZ',
                sensitiveTerms: [],
                blockTerms: [],
              }),
            };
          },
        },
        local: {
          async get() {
            return {};
          },
        },
        onChanged: { addListener() {} },
      },
    };
  });
  await page.reload();
  await page.getByRole('button', { name: 'Detection rules', exact: true }).click();
  await expect(
    page.getByRole('button', {
      name: EDITION.managedPolicies
        ? 'Local phone number region: Қазақстан · Kazakhstan'
        : 'Local phone number region: United States',
      exact: true,
    }),
  ).toBeDisabled();
  if (!EDITION.managedPolicies)
    await expect(page.locator('#mode')).toHaveText('Protection blocked');
  await expect(page.locator('select')).toHaveCount(0);
});
