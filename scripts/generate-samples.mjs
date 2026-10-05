#!/usr/bin/env node
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const seedPath = new URL('../data/seeds.json', import.meta.url);
const categoryLabels = {
  'phone.nanp': 'North American phone numbers',
  'phone.uk': 'United Kingdom phone numbers',
  'phone.au': 'Australian phone numbers',
  'phone.de': 'German phone numbers',
  'phone.fr': 'French phone numbers',
  'email.reserved': 'Email addresses on reserved domains',
  'email.obfuscated': 'Obfuscated email addresses',
  'email.unicode': 'Unicode email addresses',
  'card.test': 'Payment card sandbox numbers',
  'card.context': 'Labeled card security values',
  'bank.iban': 'International bank account sandbox numbers',
  'bank.account': 'Labeled bank account sandbox values',
  'id.ssn': 'Synthetic US Social Security fields',
  'id.context': 'Synthetic labeled personal identifiers',
  'id.public_test': 'Official sandbox identity values',
  'id.birth_date': 'Synthetic dates in birth-date fields',
  'secret.api': 'Synthetic API token shapes',
  'secret.assignment': 'Synthetic password and token assignments',
  'secret.authorization': 'Synthetic authorization headers',
  'secret.url': 'Synthetic URL credentials',
  'secret.jwt': 'Synthetic JSON Web Tokens',
  'secret.private_key': 'Synthetic private-key delimiters',
  'person.context': 'Invented names in personal fields',
  'address.context': 'Invented postal addresses',
  'ip.documentation': 'Reserved documentation IP addresses',
  'mixed.record': 'Synthetic records with several sensitive fields',
  'negative.prose': 'Ordinary prose',
  'negative.dates': 'Dates, times, and durations',
  'negative.versions': 'Versions and decimal quantities',
  'negative.orders': 'Ordinary order and part references',
  'negative.checksums': 'Invalid unlabeled numeric checksums',
  'negative.placeholders': 'Redaction tokens and empty forms',
  'negative.code': 'Code and documentation without credentials',
  'phone.regional': 'Synthetic Russia and neighboring-country phone shapes',
  'id.regional': 'Synthetic regional personal identifier labels',
  'person.regional': 'Invented regional names and multilingual fields',
  'address.regional': 'Invented regional streets and address fields',
  'birth.regional': 'Synthetic multilingual birth-date fields',
  'mixed.regional': 'Synthetic multilingual private records',
  'person.unlabeled': 'Invented names with common given-name tokens',
  'address.german': 'Invented unlabeled German street patterns',
  'negative.regional': 'Regional prose and ordinary nonprivate references',
  'negative.name_address': 'Capitalized technical words and incomplete street phrases',
};

export const CORPUS_POLICY = Object.freeze({
  redactEmails: true,
  redactPhones: true,
  redactCards: true,
  redactBankAccounts: true,
  redactIdentifiers: true,
  redactSecrets: true,
  redactNames: true,
  redactAddresses: true,
  redactNetwork: true,
  sensitiveTerms: [],
  blockTerms: [],
  defaultCountry: 'US',
});

export function luhnValid(value) {
  const digits = value.replace(/[^0-9]/g, '');
  let sum = 0,
    double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let digit = Number(digits[i]);
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  return digits.length >= 13 && digits.length <= 19 && sum % 10 === 0;
}

export function ibanValid(value) {
  const compact = value.replace(/\s/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(compact)) return false;
  const converted = (compact.slice(4) + compact.slice(0, 4)).replace(/[A-Z]/g, (c) =>
    String(c.charCodeAt(0) - 55),
  );
  let remainder = 0;
  for (const digit of converted) remainder = (remainder * 10 + Number(digit)) % 97;
  return remainder === 1;
}

const pad = (value, width) => String(value).padStart(width, '0');
const group = (value, size, separator = ' ') =>
  value.match(new RegExp(`.{1,${size}}`, 'g')).join(separator);
const digest = (value) => createHash('sha256').update(value).digest('hex');
const json = (value) => JSON.stringify(value, null, 2) + '\n';
// Generated records stay individually diffable while fitting browser package parser limits.
const recordsJson = (records) =>
  '[\n' + records.map((record) => JSON.stringify(record)).join(',\n') + '\n]\n';

export async function buildCorpus() {
  const seeds = JSON.parse(await readFile(seedPath, 'utf8'));
  const regional = JSON.parse(
    await readFile(new URL('../data/regional-seeds.json', import.meta.url), 'utf8'),
  );
  const positives = [],
    negatives = [],
    counters = new Map(),
    seedIds = new Map();
  const texts = new Set(),
    countries = new Set();
  const add = (category, text, expected, source = 'synthetic', seed = category, country) => {
    if (texts.has(text)) return;
    if (!Object.hasOwn(categoryLabels, category)) throw new Error(`Unknown category ${category}`);
    if (!Object.hasOwn(seeds.sources, source)) throw new Error(`Unknown source ${source}`);
    let previousEnd = 0;
    for (const finding of expected) {
      const start = text.indexOf(finding.value, previousEnd);
      if (!finding.kind || !finding.value || start < 0)
        throw new Error(`Invalid expected finding in ${category}: ${text}`);
      previousEnd = start + finding.value.length;
    }
    texts.add(text);
    const counter = (counters.get(category) || 0) + 1;
    counters.set(category, counter);
    if (!seedIds.has(category)) seedIds.set(category, new Set());
    seedIds.get(category).add(seed);
    if (country) countries.add(country);
    const sample = { id: `${category}.${pad(counter, 5)}`, category, text, expected, source, seed };
    if (country) sample.country = country;
    (expected.length ? positives : negatives).push(sample);
  };
  const labeled = (label, value, variant = 0) =>
    [
      `${label}: ${value}`,
      `Synthetic export\n${label}: ${value}\nPlease summarize the record.`,
      `${label} = ${value}; summarize the fixture`,
      `Imported private field\n${label}: ${value};\nEnd of record.`,
    ][variant % 4];
  const plain = (value, variant = 0) =>
    [
      value,
      `The synthetic record contains ${value}.`,
      `Copied fixture\n${value}\nEnd of fixture.`,
      `Value (${value}) is present in this test export.`,
    ][variant % 4];
  const one = (kind, value) => [{ kind, value }];
  const phone = (category, national, callingCode, source, country, seed) => {
    const digits = national.replace(/\D/g, '');
    const internationalDigits = `${callingCode}${callingCode === '1' ? digits : digits.slice(1)}`;
    const variants = [
      ...new Set([
        `+${internationalDigits}`,
        `+${callingCode} ${callingCode === '1' ? national : national.slice(1)}`,
        `+${callingCode}-${(callingCode === '1' ? national : national.slice(1)).replace(/ /g, '-')}`,
        national,
        national.replace(/ /g, '.'),
        national.replace(/ /g, '-'),
        `${national} ext. 42`,
      ]),
    ];
    variants.forEach((value, index) =>
      add(
        category,
        labeled(index % 2 ? 'Telephone' : 'Phone', value, index),
        one('PHONE', value),
        source,
        seed,
        country,
      ),
    );
  };

  // Official reserved ranges: never generate random subscriber numbers.
  for (const area of seeds.phones.nanpAreaCodes)
    for (let i = 0; i < 24; i++) {
      const suffix = 100 + i * 4;
      const value = `${area} 555 ${pad(suffix, 4)}`;
      const country = ['416', '604', '613', '902'].includes(area) ? 'CA' : 'US';
      phone('phone.nanp', value, '1', 'nanpa', country, `nanpa:${area}555${pad(suffix, 4)}`);
      const parenthesized = `(${area}) 555-${pad(suffix, 4)}`;
      add(
        'phone.nanp',
        labeled('Mobile', parenthesized),
        one('PHONE', parenthesized),
        'nanpa',
        `nanpa:${area}555${pad(suffix, 4)}`,
        country,
      );
    }
  for (let i = 0; i < 40; i++) {
    const value = `07700 ${pad(900000 + i * 19, 6)}`;
    phone('phone.uk', value, '44', 'ofcom', 'GB', `ofcom:${value.replace(/\D/g, '')}`);
  }
  for (const prefix of seeds.phones.ukGeographic)
    for (let i = 0; i < 12; i++) {
      const value = `${prefix} ${pad(i * 71, 4)}`;
      phone('phone.uk', value, '44', 'ofcom', 'GB', `ofcom:${value.replace(/\D/g, '')}`);
    }
  for (const prefix of seeds.phones.auGeographic)
    for (let i = 0; i < 15; i++) {
      const value = `${prefix} ${pad(i * 613, 4)}`;
      phone('phone.au', value, '61', 'acma', 'AU', `acma:${value.replace(/\D/g, '')}`);
    }
  for (const value of seeds.phones.auMobile)
    phone('phone.au', value, '61', 'acma', 'AU', `acma:${value.replace(/\D/g, '')}`);
  for (const prefix of seeds.phones.deGeographic)
    for (let i = 0; i < 20; i++) {
      const value = `${prefix} ${pad(i * 47, 3)}`;
      phone('phone.de', value, '49', 'bnetza', 'DE', `bnetza:${value.replace(/\D/g, '')}`);
    }
  for (const value of seeds.phones.deMobile)
    phone('phone.de', value, '49', 'bnetza', 'DE', `bnetza:${value.replace(/\D/g, '')}`);
  for (const prefix of ['0171 39200', '0176 040690'])
    for (let i = 0; i < 20; i++) {
      const value = `${prefix} ${pad(i * 5, 2)}`;
      phone('phone.de', value, '49', 'bnetza', 'DE', `bnetza:${value.replace(/\D/g, '')}`);
    }
  for (const prefix of seeds.phones.frPrefixes)
    for (let i = 0; i < 20; i++) {
      const suffix = pad(i * 487, 4);
      const value = `${prefix} ${suffix.slice(0, 2)} ${suffix.slice(2)}`;
      phone('phone.fr', value, '33', 'arcep', 'FR', `arcep:${value.replace(/\D/g, '')}`);
    }

  for (let i = 0; i < 72; i++) {
    const locals = [
      `fixture${pad(i, 3)}`,
      `employee.${pad(i, 3)}`,
      `sample_${pad(i, 3)}`,
      `support+case${pad(i, 3)}`,
      `test-contact-${pad(i, 3)}`,
    ];
    for (const local of locals)
      for (const domain of ['example.com', 'example.net', 'example.org', 'corp.example.com']) {
        const value = `${local}@${domain}`;
        add(
          'email.reserved',
          plain(value, i % 4),
          one('EMAIL', value),
          'iana',
          `email:${local}@${domain}`,
        );
      }
    const value = `fixture${pad(i, 3)} [at] example [dot] com`;
    add(
      'email.obfuscated',
      labeled('Email', value, i),
      one('EMAIL', value),
      'iana',
      `email:fixture${pad(i, 3)}@example.com`,
    );
    const parenthetical = `fixture${pad(i, 3)} (at) example (dot) org`;
    add(
      'email.obfuscated',
      plain(parenthetical, i),
      one('EMAIL', parenthetical),
      'iana',
      `email:fixture${pad(i, 3)}@example.org`,
    );
    for (const local of ['élodie', 'марина', 'δοκιμή', '测试']) {
      const value = `${local}${pad(i, 3)}@example.com`;
      add(
        'email.unicode',
        labeled('Email', value, i),
        one('EMAIL', value),
        'iana',
        `email:${value}`,
      );
    }
  }

  for (const card of seeds.cards) {
    if (!luhnValid(card.number)) throw new Error(`Curated card checksum failed: ${card.number}`);
    const formats = [card.number, group(card.number, 4), group(card.number, 4, '-')];
    if (card.number.length === 15)
      formats.push(
        `${card.number.slice(0, 4)} ${card.number.slice(4, 10)} ${card.number.slice(10)}`,
      );
    for (const value of formats)
      for (const variant of [0, 1]) {
        add(
          'card.test',
          variant ? labeled('Card number', value, 1) : plain(value),
          one('CARD', value),
          'stripe',
          `stripe:${card.number}`,
          card.country,
        );
      }
  }
  for (let i = 0; i < 24; i++) {
    const value = pad(100 + i * 17, 3);
    add(
      'card.context',
      labeled(i % 2 ? 'CVV' : 'CVC', value, i),
      one('CARD', value),
      'synthetic',
      `card-security:${value}`,
    );
    const pin = pad(1000 + i * 37, 4);
    add('card.context', labeled('PIN', pin, i), one('CARD', pin), 'synthetic', `card-pin:${pin}`);
  }
  for (const iban of seeds.ibans) {
    if (!ibanValid(iban.number)) throw new Error(`Curated IBAN checksum failed: ${iban.number}`);
    for (const value of [iban.number, group(iban.number, 4)])
      for (const variant of [0, 1, 2, 3]) {
        add(
          'bank.iban',
          variant < 2 ? plain(value, variant) : labeled('IBAN', value, variant),
          one('IBAN', value),
          iban.source,
          `iban:${iban.number}`,
          iban.country,
        );
      }
  }
  for (const account of seeds.bankAccounts)
    for (let i = 0; i < 4; i++) {
      add(
        'bank.account',
        labeled(account.label, account.value, i),
        one('BANK', account.value),
        account.source,
        `bank:${account.country}:${account.label}:${account.value}`,
        account.country,
      );
    }

  for (let i = 1; i <= 160; i++) {
    const value = `${900 + (i % 100)}-${pad(1 + (i % 98), 2)}-${pad(1000 + i * 17, 4)}`;
    for (const format of [value, value.replace(/-/g, ''), value.replace(/-/g, ' ')]) {
      add('id.ssn', labeled('SSN', format, i), one('ID', format), 'ssa', `ssn:${value}`, 'US');
    }
  }
  const idLabels = [
    'Passport',
    'Passport number',
    'National ID',
    'Tax ID',
    'Personal ID',
    'Employee ID',
    'Customer ID',
    'Member ID',
    'Medical record',
    "Driver's license",
    'Student ID',
    'Insurance ID',
  ];
  for (const label of idLabels)
    for (let i = 1; i <= 24; i++) {
      const value = `TEST-${label
        .replace(/[^A-Za-z]/g, '')
        .slice(0, 4)
        .toUpperCase()}-${pad(i, 6)}`;
      for (let variant = 0; variant < 3; variant++)
        add(
          'id.context',
          labeled(label, value, variant),
          one('ID', value),
          'synthetic',
          `id:${label}:${value}`,
        );
    }
  const numericIds = [
    ['SIN', '000 000 000', 'CA'],
    ['Aadhaar', '0000 0000 0000', 'IN'],
    ['INN', '000000000000', 'RU'],
    ['SNILS', '000-000-000 00', 'RU'],
    ['CPF', '000.000.000-00', 'BR'],
    ['CNPJ', '00.000.000/0000-00', 'BR'],
    ['TFN', '000 000 000', 'AU'],
    ['NHS number', '000 000 0000', 'GB'],
    ['Passport number', '0000 000000', 'RU'],
    ['National ID', 'TEST000000', 'SG'],
  ];
  for (const [label, value, country] of numericIds)
    for (let i = 0; i < 4; i++) {
      add(
        'id.context',
        labeled(label, value, i),
        one('ID', value),
        'synthetic',
        `id:${label}:${value}`,
        country,
      );
    }
  for (const [label, value, country, source] of [
    ['National ID', '05696340E', 'ES', 'adyen'],
    ['National ID', '75914068S', 'ES', 'adyen'],
    ['National ID', '198112289874', 'SE', 'gocardless'],
    ['National ID', '0101701234', 'DK', 'gocardless'],
  ])
    for (let i = 0; i < 4; i++)
      add(
        'id.public_test',
        labeled(label, value, i),
        one('ID', value),
        source,
        `id:${country}:${value}`,
        country,
      );
  for (let i = 0; i < 40; i++) {
    const value = `${1980 + (i % 30)}-${pad(1 + (i % 12), 2)}-${pad(1 + (i % 28), 2)}`;
    for (const label of ['DOB', 'Date of birth', 'Birth date'])
      add(
        'id.birth_date',
        labeled(label, value, i),
        one('ID', value),
        'synthetic',
        `birth-date:${value}`,
      );
    if (i < 8)
      add(
        'id.birth_date',
        JSON.stringify({ date_of_birth: value }),
        one('ID', value),
        'synthetic',
        `json:birth-date:${value}`,
      );
  }

  // Values use test markers or obvious synthetic digit sequences; no key is minted.
  const token = (i, length = 40) =>
    `SYNTHETICTESTONLY${pad(i, 6)}abcdefghijklmnopqrstuvwxyz`.repeat(4).slice(0, length);
  const tokenFactories = {
    openai: (i) => `sk-${token(i, 48)}`,
    openai_project: (i) => `sk-proj-${token(i, 72)}`,
    anthropic: (i) => `sk-ant-api03-${token(i, 80)}`,
    aws: (i) => `AKIA${`TESTONLY${pad(i, 8)}`.slice(0, 16)}`,
    aws_temporary: (i) => `ASIA${`TESTONLY${pad(i, 8)}`.slice(0, 16)}`,
    github: (i) => `ghp_${token(i, 36)}`,
    github_fine: (i) => `github_pat_${token(i, 72)}`,
    gitlab: (i) => `glpat-${token(i, 24)}`,
    google: (i) => `AIza${token(i, 35)}`,
    stripe: (i) => `sk_test_${token(i, 32)}`,
    stripe_restricted: (i) => `rk_test_${token(i, 32)}`,
    stripe_webhook: (i) => `whsec_${token(i, 32)}`,
    slack: (i) => `xoxb-000000000000-000000000000-${token(i, 24)}`,
    npm: (i) => `npm_${token(i, 36)}`,
    shopify: (i) => `shpat_${pad(i, 32)}`,
    twilio: (i) => `SK${pad(i, 32)}`,
    sendgrid: (i) => `SG.${token(i, 22)}.${token(i, 43)}`,
    huggingface: (i) => `hf_${token(i, 34)}`,
    digitalocean: (i) => `dop_v1_${pad(i, 64)}`,
    linear: (i) => `lin_api_${token(i, 40)}`,
    postman: (i) => `PMAK-${pad(i, 24)}-${pad(i, 34)}`,
  };
  for (const [service, factory] of Object.entries(tokenFactories))
    for (let i = 1; i <= 18; i++) {
      const value = factory(i);
      for (let variant = 0; variant < 3; variant++)
        add(
          'secret.api',
          plain(value, variant),
          one('SECRET', value),
          'synthetic',
          `secret:${service}:${i}`,
        );
    }
  for (const label of [
    'Password',
    'API key',
    'Client secret',
    'Access token',
    'Refresh token',
    'Secret',
    'Database password',
    'Session token',
  ])
    for (let i = 0; i < 18; i++) {
      const value = `TESTONLY_fixture_${pad(i, 4)}_never_real`;
      add(
        'secret.assignment',
        labeled(label, value, i),
        one('SECRET', value),
        'synthetic',
        `secret:${label}:${i}`,
      );
    }
  for (let i = 0; i < 48; i++) {
    const value = token(i, 48);
    add(
      'secret.authorization',
      `Authorization: Bearer ${value}`,
      one('SECRET', value),
      'synthetic',
      `bearer:${i}`,
    );
    const basic = Buffer.from(`fixture${i}:TESTONLY_fixture_password_${i}`).toString('base64');
    add(
      'secret.authorization',
      `Authorization: Basic ${basic}`,
      one('SECRET', basic),
      'synthetic',
      `basic:${i}`,
    );
  }
  for (let i = 0; i < 48; i++) {
    const credentials = `fixture${pad(i, 3)}:TESTONLY_password_${pad(i, 3)}`;
    add(
      'secret.url',
      `https://${credentials}@example.com/private`,
      one('SECRET', credentials),
      'synthetic',
      `url-userinfo:${i}`,
    );
    const value = `TESTONLY_query_${pad(i, 3)}_credential`;
    add(
      'secret.url',
      `https://example.com/private?api_key=${value}&view=fixture`,
      one('SECRET', value),
      'synthetic',
      `url-query:${i}`,
    );
  }
  for (let i = 0; i < 48; i++) {
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({ sub: `SYNTHETICTESTONLY${pad(i, 4)}`, fixture: true }),
    ).toString('base64url');
    const value = `${header}.${payload}.${Buffer.from('SYNTHETICTESTONLY').toString('base64url')}`;
    add('secret.jwt', plain(value, i), one('SECRET', value), 'synthetic', `jwt:${i}`);
  }
  for (const label of ['PRIVATE KEY', 'RSA PRIVATE KEY', 'EC PRIVATE KEY', 'OPENSSH PRIVATE KEY'])
    for (let i = 0; i < 8; i++) {
      const body = Buffer.from(
        `SYNTHETIC TEST ONLY, NOT A CRYPTOGRAPHIC KEY, fixture ${pad(i, 3)}`,
      ).toString('base64');
      const value = `-----BEGIN ${label}-----\n${body}\n-----END ${label}-----`;
      add(
        'secret.private_key',
        plain(value, i),
        one('SECRET', value),
        'synthetic',
        `pem:${label}:${i}`,
      );
    }

  for (const value of seeds.syntheticNames)
    for (const label of [
      'Name',
      'Full name',
      'Employee name',
      'Patient name',
      'Customer name',
      'Contact name',
    ])
      for (let i = 0; i < 3; i++) {
        add(
          'person.context',
          labeled(label, value, i),
          one('PERSON', value),
          'synthetic',
          `person:${value}`,
        );
      }
  for (let s = 0; s < seeds.syntheticStreets.length; s++)
    for (let t = 0; t < seeds.syntheticTowns.length; t++) {
      const value = `${100 + s * 37 + t} ${seeds.syntheticStreets[s]}, ${seeds.syntheticTowns[t]}`;
      for (const label of ['Address', 'Home address', 'Shipping address', 'Billing address'])
        add(
          'address.context',
          labeled(label, value, t),
          one('ADDRESS', value),
          'synthetic',
          `address:${value}`,
        );
    }
  for (const prefix of ['192.0.2', '198.51.100', '203.0.113'])
    for (let i = 1; i <= 64; i++) {
      const value = `${prefix}.${i}`;
      add('ip.documentation', plain(value, i), one('IP', value), 'rfc5737', `ip:${value}`);
    }
  for (let i = 1; i <= 64; i++)
    for (const value of [`2001:db8::${i.toString(16)}`, `2001:db8:${i.toString(16)}:1::42`]) {
      add('ip.documentation', `Host: ${value}`, one('IP', value), 'rfc3849', `ip:${value}`);
    }
  for (let i = 0; i < 96; i++) {
    const name = seeds.syntheticNames[i % seeds.syntheticNames.length];
    const email = `fixture${pad(i, 3)}@example.org`;
    const phoneValue = `+1 202 555 ${pad(100 + i, 4)}`;
    const address = `${100 + i} Synthetic Way, Exampletown`;
    const employee = `TEST-EMP-${pad(i, 6)}`;
    const text = `Employee name: ${name}\nEmail: ${email}\nPhone: ${phoneValue}\nHome address: ${address}\nEmployee ID: ${employee}\nRewrite the synthetic staff record for clarity.`;
    add(
      'mixed.record',
      text,
      [
        { kind: 'PERSON', value: name },
        { kind: 'EMAIL', value: email },
        { kind: 'PHONE', value: phoneValue },
        { kind: 'ADDRESS', value: address },
        { kind: 'ID', value: employee },
      ],
      'synthetic',
      `mixed:${i}`,
    );
    const repeated = `${email}\nAgain: ${email}`;
    add(
      'mixed.record',
      repeated,
      [
        { kind: 'EMAIL', value: email },
        { kind: 'EMAIL', value: email },
      ],
      'iana',
      `repeat:${i}`,
    );
  }
  for (let i = 0; i < 24; i++) {
    const person = seeds.syntheticNames[i % seeds.syntheticNames.length];
    const address = `${250 + i} Synthetic Way, Fixtureville`;
    const idValue = `TEST-EMP-${pad(i, 6)}`;
    const password = `TESTONLY_json_fixture_${pad(i, 4)}`;
    const phoneValue = `+1 212 555 ${pad(100 + i, 4)}`;
    const email = `json.fixture${pad(i, 3)}@example.test`;
    for (const [category, label, value, kind] of [
      ['person.context', 'employee_name', person, 'PERSON'],
      ['address.context', 'home_address', address, 'ADDRESS'],
      ['id.context', 'employee_id', idValue, 'ID'],
      ['secret.assignment', 'password', password, 'SECRET'],
      ['phone.nanp', 'phone', phoneValue, 'PHONE'],
      ['email.reserved', 'email', email, 'EMAIL'],
    ])
      add(
        category,
        JSON.stringify({ [label]: value }),
        one(kind, value),
        kind === 'EMAIL' ? 'iana' : kind === 'PHONE' ? 'nanpa' : 'synthetic',
        `json:${label}:${i}`,
        kind === 'PHONE' ? 'US' : undefined,
      );
    for (const [separator, label] of [
      ['\u00a0', 'Phone'],
      ['\u202f', 'Telephone'],
      ['\u2009', 'Mobile'],
    ]) {
      const value = phoneValue.replace(/ /g, separator);
      add(
        'phone.nanp',
        labeled(label, value),
        one('PHONE', value),
        'nanpa',
        `phone-unicode:${i}`,
        'US',
      );
    }
  }

  const prose = [
    'Explain recursion with a short example.',
    'Summarize the quarterly team priorities.',
    'Translate this paragraph into French.',
    'Write a polite reply about the delivery delay.',
    'Outline the steps for an accessibility review.',
    'Describe the difference between a queue and a stack.',
    'Create a checklist for a product launch.',
    'The customer asked for a clearer explanation of the feature.',
  ];
  for (let i = 0; i < 128; i++) {
    add(
      'negative.prose',
      `${prose[i % prose.length]}\nFixture revision ${i}.`,
      [],
      'synthetic',
      `prose:${i}`,
    );
    const month = 1 + (i % 12),
      day = 1 + (i % 28);
    add(
      'negative.dates',
      `Review date: 2026-${pad(month, 2)}-${pad(day, 2)}; start ${pad(i % 24, 2)}:${pad(i % 60, 2)}; duration ${i % 90} minutes.`,
      [],
      'synthetic',
      `date:${i}`,
    );
    add(
      'negative.versions',
      `Package v${1 + (i % 4)}.${i % 20}.${i % 16} needs ${(1 + i / 100).toFixed(2)} GB; target ratio ${(i / 128).toFixed(4)}.`,
      [],
      'synthetic',
      `version:${i}`,
    );
    add(
      'negative.orders',
      `Order ORD-${pad(i, 6)}; part SKU-${pad(600000 + i, 6)}; quantity ${i % 40}; reference ticket ${i + 100}.`,
      [],
      'synthetic',
      `order:${i}`,
    );
    add(
      'negative.placeholders',
      `Name: [REDACTED]\nEmail: <removed>\nAddress: [MASKED]\n[[LG_fixture_EMAIL_${i + 1}]]`,
      [],
      'synthetic',
      `placeholder:${i}`,
    );
    add(
      'negative.code',
      `const fixtureIndex = ${i};\nconst options = { retries: 3, timeout: 250 };\nconsole.log(options.retries);`,
      [],
      'synthetic',
      `code:${i}`,
    );
  }
  for (const card of seeds.cards) {
    const value = card.number.slice(0, -1) + ((Number(card.number.at(-1)) + 1) % 10);
    if (luhnValid(value)) throw new Error('Bad negative-card fixture');
    add(
      'negative.checksums',
      `Unlabeled checksum fixture ${value}`,
      [],
      'synthetic',
      `bad-card:${card.number}`,
    );
  }
  for (const iban of seeds.ibans) {
    const value = iban.number.slice(0, 2) + '00' + iban.number.slice(4);
    if (ibanValid(value)) throw new Error('Bad negative-IBAN fixture');
    add(
      'negative.checksums',
      `Checksum fixture ${value}`,
      [],
      'synthetic',
      `bad-iban:${iban.number}`,
    );
  }

  // These deliberately synthetic phone shapes use zero prefixes. Tajik metadata
  // validates length broadly, so its fixtures use only an all-zero placeholder.
  // These are not regulator-reserved ranges or evidence of subscriber assignment.
  for (const region of regional.regions)
    for (let i = 1; i <= 24; i++) {
      const digits =
        region.country === 'TJ'
          ? '0'.repeat(region.nationalLength)
          : '0'.repeat(region.nationalLength - 4) + pad(i, 4);
      const international = `+${region.callingCode}${digits}`;
      const grouped = `+${region.callingCode} ${group(digits, 3)}`;
      const national = `0 ${group(digits, 3)}`;
      const forms = [
        international,
        grouped,
        national,
        national.replace(/ /g, '-'),
        `${national} ext. ${i}`,
      ];
      for (const label of new Set(region.phoneLabels))
        for (const value of forms)
          add(
            'phone.regional',
            labeled(label, value, i),
            one('PHONE', value),
            'synthetic',
            `regional-phone:${region.country}:${i}:${value}`,
            region.country,
          );
      const name = region.name + String.fromCharCode(65 + (i % 26));
      for (const label of region.nameLabels)
        add(
          'person.regional',
          labeled(label, name, i),
          one('PERSON', name),
          'synthetic',
          `regional-name:${region.country}:${name}`,
          region.country,
        );
      const address = `${region.street} ${100 + i}`;
      for (const label of region.addressLabels)
        add(
          'address.regional',
          labeled(label, address, i),
          one('ADDRESS', address),
          'synthetic',
          `regional-address:${region.country}:${address}`,
          region.country,
        );
      add(
        'address.regional',
        address,
        one('ADDRESS', address),
        'synthetic',
        `regional-address:${region.country}:${address}`,
        region.country,
      );
      for (const label of region.idLabels) {
        const identifier = `TEST-${region.country}-${pad(i, 8)}`;
        add(
          'id.regional',
          labeled(label, identifier, i),
          one('ID', identifier),
          'synthetic',
          `regional-id:${region.country}:${label}:${i}`,
          region.country,
        );
      }
      const birthday = `${1980 + (i % 25)}-${pad(1 + (i % 12), 2)}-${pad(1 + (i % 28), 2)}`;
      add(
        'birth.regional',
        labeled(region.birthLabel, birthday, i),
        one('ID', birthday),
        'synthetic',
        `regional-dob:${region.country}:${i}`,
        region.country,
      );
      const jsonPhone = JSON.stringify({
        [region.phoneLabels[0].replace(/ /g, '_')]: international,
      });
      add(
        'phone.regional',
        jsonPhone,
        one('PHONE', international),
        'synthetic',
        `regional-json-phone:${region.country}:${i}`,
        region.country,
      );
      const mixed = `${region.nameLabels[0]}: ${name}\n${region.addressLabels[0]}: ${address}\n${region.phoneLabels[0]}: ${international}\n${region.idLabels[0]}: TEST-${region.country}-${pad(i, 8)}`;
      add(
        'mixed.regional',
        mixed,
        [
          { kind: 'PERSON', value: name },
          { kind: 'ADDRESS', value: address },
          { kind: 'PHONE', value: international },
          { kind: 'ID', value: `TEST-${region.country}-${pad(i, 8)}` },
        ],
        'synthetic',
        `regional-mixed:${region.country}:${i}`,
        region.country,
      );
      for (const sentence of [
        'Расскажите о форматах паспорта без номера.',
        'Телефон и адрес — названия полей, значения отсутствуют.',
        'Документ тестовой системы доступен для перевода.',
        'Название проекта: Тестовая Система.',
        'Версия пакета: 2.4.0; результат 3.14.',
        'Дата встречи: 2026-10-04.',
        'Объясните правила работы с персональными данными.',
        'Поле ИИН описано в документации без значения.',
      ])
        add(
          'negative.regional',
          `${sentence}\nSynthetic region ${region.country}; revision ${i}.`,
          [],
          'synthetic',
          `regional-negative:${region.country}:${sentence}:${i}`,
          region.country,
        );
    }
  for (const given of [
    'Ferdinand',
    'Anna',
    'Markus',
    'Julia',
    'Алексей',
    'Олексій',
    'Данияр',
    'Alina',
    'Leyla',
    'Ion',
  ])
    for (let i = 1; i <= 20; i++) {
      const surname = given.match(/[А-ЯІЇЄ]/u)
        ? `Тестфикстуров${String.fromCharCode(65 + i)}`
        : `Testfixturemann${String.fromCharCode(65 + i)}`;
      const value = `${given} ${surname}`;
      add(
        'person.unlabeled',
        plain(value, i),
        one('PERSON', value),
        'synthetic',
        `given-name:${given}:${i}`,
      );
    }
  for (const suffix of [
    'straße',
    'strasse',
    'str.',
    'weg',
    'allee',
    'platz',
    'gasse',
    'ufer',
    'ring',
  ])
    for (let i = 1; i <= 20; i++) {
      const value =
        (i % 2 ? `synthetische ${suffix}` : `Testfixture${suffix}`) +
        ` ${20 + i}${i % 3 === 0 ? 'a' : ''}`;
      add(
        'address.german',
        plain(value, i),
        one('ADDRESS', value),
        'synthetic',
        `german-street:${suffix}:${i}`,
        'DE',
      );
      if (i <= 8) {
        const name = `Ferdinand Testfixturemann${String.fromCharCode(65 + i)}`;
        const phoneValue = '+49 30 23125 ' + pad(i, 3);
        add(
          'mixed.regional',
          `${value} ${name} ${phoneValue}`,
          [
            { kind: 'ADDRESS', value },
            { kind: 'PERSON', value: name },
            { kind: 'PHONE', value: phoneValue },
          ],
          'synthetic',
          `german-private-record:${suffix}:${i}`,
          'DE',
        );
      }
    }
  for (let i = 0; i < 80; i++)
    for (const sentence of [
      'Mark Project roadmap',
      'Anna Report is a technical heading',
      'Ferdinand Version changes',
      'Unknown Capitalized Words are prose',
      'Die Straße ist gesperrt',
      'Der Weg zum Test ist dokumentiert',
      'Тестовая Улица описана без номера',
      'Улица без названия и номера',
      'Расскажите о паспорте',
      'The street and house number are absent',
    ])
      add(
        'negative.name_address',
        `${sentence}\nSynthetic negative revision ${i}.`,
        [],
        'synthetic',
        `name-address-negative:${sentence}:${i}`,
      );

  const all = [...positives, ...negatives];
  const categories = Object.keys(categoryLabels)
    .map((id) => {
      const samples = all.filter((sample) => sample.category === id);
      const positiveCount = samples.filter((sample) => sample.expected.length).length;
      return {
        id,
        label: categoryLabels[id],
        count: samples.length,
        positiveCount,
        negativeCount: samples.length - positiveCount,
        seedCount: seedIds.get(id)?.size || 0,
      };
    })
    .filter((category) => category.count);
  const files = {
    positives: {
      path: 'positives.json',
      count: positives.length,
      sha256: digest(recordsJson(positives)),
    },
    negatives: {
      path: 'negatives.json',
      count: negatives.length,
      sha256: digest(recordsJson(negatives)),
    },
  };
  const manifest = {
    schemaVersion: 1,
    version: seeds.version,
    synthetic: true,
    total: all.length,
    positiveCount: positives.length,
    negativeCount: negatives.length,
    uniqueSensitiveValues: new Set(
      positives.flatMap((sample) => sample.expected.map((finding) => finding.value)),
    ).size,
    seedCount: new Set(all.map((sample) => sample.seed)).size,
    curatedSeedCounts: {
      paymentCardNumbers: seeds.cards.length,
      ibanNumbers: seeds.ibans.length,
      bankAccountFields: seeds.bankAccounts.length,
      individuallyReservedPhoneNumbers: seeds.phones.auMobile.length + seeds.phones.deMobile.length,
      reservedPhoneRangeDefinitions:
        seeds.phones.nanpAreaCodes.length +
        seeds.phones.ukGeographic.length +
        1 +
        seeds.phones.auGeographic.length +
        seeds.phones.deGeographic.length +
        2 +
        seeds.phones.frPrefixes.length,
      syntheticNameSeeds: seeds.syntheticNames.length,
      syntheticStreetSeeds: seeds.syntheticStreets.length,
      syntheticTownSeeds: seeds.syntheticTowns.length,
      regionalCountrySeeds: regional.regions.length,
    },
    categories,
    countries: [...countries].sort(),
    files,
    policy: CORPUS_POLICY,
    provenance: 'SOURCES.md',
    sources: seeds.sources,
    limitations: [
      'Synthetic variants measure regression coverage, not real-world recall or leak prevention guarantees.',
      'Official sandbox values and reserved numbers are fixtures; supported patterns also match unseen values.',
      'Bounded given-name/street heuristics cover selected unlabeled names and addresses; unknown names, multiline addresses, images, binary documents and sensitive narrative require additional protection.',
      'Regional identifiers and nonworking national phone fixtures use contextual labels; no new country-specific checksum or production recall is claimed. Network detection is optional in normal policy.',
      'API token fixtures match syntax only and cannot authenticate; private-key bodies are not cryptographic keys.',
    ],
  };
  return { positives, negatives, manifest, seeds };
}

export async function generateSamples(destination = path.join(projectRoot, 'data')) {
  const corpus = await buildCorpus();
  await mkdir(destination, { recursive: true });
  await writeFile(path.join(destination, 'positives.json'), recordsJson(corpus.positives));
  await writeFile(path.join(destination, 'negatives.json'), recordsJson(corpus.negatives));
  await writeFile(path.join(destination, 'manifest.json'), json(corpus.manifest));
  return corpus.manifest;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const destinationArg = process.argv.indexOf('--output');
  const destination =
    destinationArg < 0 ? undefined : path.resolve(process.argv[destinationArg + 1]);
  const manifest = await generateSamples(destination);
  console.log(
    `Generated ${manifest.total} local samples (${manifest.positiveCount} positive, ${manifest.negativeCount} negative) across ${manifest.categories.length} categories.`,
  );
}
