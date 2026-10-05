import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { phoneRegionChoices } from '../src/ui/choice-modal.js';
import { COUNTRY_CODES } from '../src/core/country-codes.js';

test('phone region choices cover the offline metadata and include native CIS names', () => {
  const choices = phoneRegionChoices();
  assert.equal(choices.length, 245);
  assert.deepEqual(choices.map((choice) => choice.value).sort(), [...COUNTRY_CODES].sort());
  for (const code of ['RU', 'BY', 'KZ', 'UA', 'AM', 'AZ', 'GE', 'KG', 'TJ', 'TM', 'UZ']) {
    const choice = choices.find((item) => item.value === code);
    assert.ok(choice.label.includes(' · '), `${code} is missing its native country name.`);
    assert.equal(choice.meta, code);
  }
});

test('extension UI HTML contains no native dropdown controls', async () => {
  for (const name of ['admin', 'workspace']) {
    const html = await readFile(new URL(`../src/ui/${name}.html`, import.meta.url), 'utf8');
    assert.ok(!/<\s*(?:select|option)\b/i.test(html), `${name} contains a native dropdown.`);
  }
});
