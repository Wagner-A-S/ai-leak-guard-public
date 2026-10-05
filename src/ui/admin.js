import { DEFAULT_POLICY, validatePolicy } from '../core/policy.js';
import { EDITION } from '../core/edition.js';
import { getPolicy, savePolicy } from '../platform/policy-repository.js';
import { api, isExtension } from '../platform/webextension.js';
import { PROVIDERS, DEFAULT_SITES, providerForHost } from '../core/providers.js';
import { RULES } from '../core/detectors/rules.js';
import { redact } from '../core/redaction.js';
import { bindChoiceControl, createChoiceModal, phoneRegionChoices } from './choice-modal.js';
const $ = (id) => document.getElementById(id);
const catalogCount = PROVIDERS.length.toLocaleString('en-US');
$('catalog-title').textContent = `${catalogCount} curated AI providers, one private workflow`;
$('add-catalog').textContent = `Enable all ${catalogCount} providers`;
let providerVisible = 60;
const choiceModal = createChoiceModal(document);
const countryControl = bindChoiceControl($('country'), choiceModal, {
  title: 'Choose phone region',
  label: 'Local phone number region',
  description:
    'Choose the region used to recognize local phone numbers. International numbers use their own country code.',
  searchLabel: 'Search regions',
  searchPlaceholder: 'Search country name or region code…',
  choices: phoneRegionChoices(),
  value: 'US',
});
const categoryControl = bindChoiceControl($('sample-category'), choiceModal, {
  title: 'Choose sample category',
  label: 'Sample category',
  description: 'Explore one detection category or browse the complete local sample library.',
  searchLabel: 'Search categories',
  searchPlaceholder: 'Search detection categories…',
  choices: [{ value: '', label: 'All categories' }],
});
bindChoiceControl($('sample-type'), choiceModal, {
  title: 'Choose case type',
  label: 'Sample case type',
  description: 'Compare sensitive examples with ordinary text that should pass the local checks.',
  searchLabel: 'Search case types',
  choices: [
    { value: 'all', label: 'All cases' },
    { value: 'positive', label: 'Sensitive data' },
    { value: 'negative', label: 'Safe text' },
  ],
});
const groups = [
  ['redactEmails', 'Email addresses', 'Standard, Unicode, internal & obfuscated formats', '@'],
  ['redactPhones', 'Phone numbers', 'International metadata & contextual local numbers', '☎'],
  ['redactCards', 'Payment cards', 'Checksums, contextual PANs & security codes', '▤'],
  ['redactBankAccounts', 'Banking details', 'IBAN checksums, accounts & routing numbers', '≋'],
  [
    'redactIdentifiers',
    'Personal identifiers',
    'National, tax, passport & employee identifiers',
    '◇',
  ],
  ['redactSecrets', 'Credentials & secrets', 'API keys, passwords, tokens & private keys', '⌘'],
  ['redactNames', 'Personal names', 'Common given names & labeled person records', '○'],
  ['redactAddresses', 'Postal addresses', 'Street formats & labeled postal records', '⌖'],
  ['redactNetwork', 'Network identifiers', 'Optional IP, IPv6 & hardware addresses', '⌗'],
];
let policy,
  locked = true,
  manifest,
  samples = [],
  filtered = [],
  page = 0,
  selected,
  selectedHosts = new Set();
const pageSize = 12;
let toastTimer;
function toast(message, error = false) {
  $('toast').textContent = message;
  $('toast').classList.toggle('error', error);
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($('toast').hidden = true), 5000);
}
const uiElements = () => Array.from(document.getElementsByTagName('*'));
function show(view) {
  uiElements()
    .filter((el) => el.dataset.panel)
    .forEach((el) => (el.hidden = el.dataset.panel !== view));
  uiElements()
    .filter((el) => el.dataset.view)
    .forEach((el) => el.classList.toggle('active', el.dataset.view === view));
  $('crumb').textContent = {
    overview: 'Overview',
    detectors: 'Detection rules',
    library: 'Sample library',
    providers: 'Providers',
    settings: EDITION.managedPolicies ? 'Policy settings' : 'Personal settings',
  }[view];
  if (view === 'library') loadSamples();
  window.scrollTo(0, 0);
}
uiElements()
  .filter((el) => el.dataset.view || el.dataset.goto)
  .forEach((el) => (el.onclick = () => show(el.dataset.view || el.dataset.goto)));
function render() {
  $('provider-count').textContent = new Set(
    policy.sites.map((site) => providerForHost(site.host)?.id || site.host),
  ).size;
  $('rule-count').textContent = RULES.length;
  $('rules-badge').textContent = `${RULES.length} local rules`;
  $('mode').textContent = locked
    ? 'Company managed'
    : isExtension
      ? EDITION.managedPolicies
        ? 'Local policy'
        : 'Personal settings'
      : 'UI preview';
  if (EDITION.customSites) {
    $('policy').value = JSON.stringify(policy, null, 2);
    $('policy').disabled = locked;
  } else {
    renderPersonalProviders();
  }
  $('sensitive').value = policy.sensitiveTerms.join('\n');
  $('blocked').value = policy.blockTerms.join('\n');
  for (const id of [
    'sensitive',
    'blocked',
    'country',
    'save',
    'save-detection',
    'add-catalog',
    ...(EDITION.customSites ? ['reset'] : []),
  ])
    $(id).disabled = locked;
  countryControl.setValue(policy.defaultCountry || 'US');
  $('detection-controls').replaceChildren();
  $('coverage-list').replaceChildren();
  for (const [key, title, description, symbol] of groups) {
    const row = document.createElement('label');
    row.className = 'detection-row';
    const mark = document.createElement('span');
    mark.className = 'coverage-icon';
    mark.textContent = symbol;
    const body = document.createElement('div'),
      strong = document.createElement('strong'),
      small = document.createElement('small');
    strong.textContent = title;
    small.textContent = description;
    body.append(strong, small);
    const toggle = document.createElement('input');
    toggle.type = 'checkbox';
    toggle.className = 'toggle';
    toggle.id = `toggle-${key}`;
    toggle.checked = policy[key] ?? key !== 'redactNetwork';
    toggle.disabled = locked;
    toggle.setAttribute('aria-label', title);
    row.append(mark, body, toggle);
    $('detection-controls').append(row);
    if (['redactEmails', 'redactPhones', 'redactCards', 'redactSecrets'].includes(key)) {
      const cover = row.cloneNode(true);
      cover.className = 'coverage-row';
      Array.from(cover.getElementsByTagName('input')).forEach((input) => input.remove());
      const state = document.createElement('span');
      state.className = `coverage-state ${toggle.checked ? '' : 'off'}`;
      const dot = document.createElement('i');
      dot.className = 'pulse';
      state.append(dot, document.createTextNode(toggle.checked ? 'Enabled' : 'Disabled'));
      cover.append(state);
      $('coverage-list').append(cover);
    }
  }
  renderProviders();
}
function renderPersonalProviders() {
  selectedHosts = new Set(policy.sites.map((site) => site.host));
  $('site-controls').replaceChildren();
  for (const provider of PROVIDERS) {
    const row = document.createElement('label');
    row.className = 'detection-row personal-provider-row';
    const body = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = provider.name;
    const hosts = document.createElement('small');
    hosts.textContent = provider.hosts.join(' · ');
    body.append(title, hosts);
    const toggle = document.createElement('input');
    toggle.type = 'checkbox';
    toggle.className = 'toggle';
    toggle.checked = provider.hosts.some((host) => selectedHosts.has(host));
    toggle.disabled = locked;
    toggle.setAttribute('aria-label', `Enable ${provider.name}`);
    toggle.onchange = () => {
      for (const host of provider.hosts) {
        if (toggle.checked) selectedHosts.add(host);
        else selectedHosts.delete(host);
      }
    };
    row.append(body, toggle);
    $('site-controls').append(row);
  }
}
function renderProviders() {
  $('provider-grid').replaceChildren();
  const configured = new Map();
  for (const site of policy.sites) {
    const provider = providerForHost(site.host);
    const key = provider?.id || site.host;
    if (!configured.has(key)) configured.set(key, { name: provider?.name || site.host, sites: [] });
    configured.get(key).sites.push(site);
  }
  const query = $('provider-search').value.trim().toLowerCase();
  const matches = [...configured.values()].filter(
    (provider) =>
      provider.name.toLowerCase().includes(query) ||
      provider.sites.some((site) => site.host.includes(query)),
  );
  $('provider-results').textContent =
    `Showing ${Math.min(providerVisible, matches.length)} of ${matches.length.toLocaleString('en-US')} providers`;
  $('provider-more').hidden = providerVisible >= matches.length;
  for (const provider of matches.slice(0, providerVisible)) {
    const card = document.createElement('article');
    card.className = 'provider-card';
    const logo = document.createElement('div');
    logo.className = 'provider-logo';
    logo.textContent = provider.name[0].toUpperCase();
    const name = document.createElement('h2');
    name.textContent = provider.name;
    const host = document.createElement('p');
    host.textContent = provider.sites.map((site) => site.host).join(' · ');
    const badge = document.createElement('span');
    badge.className = 'status-pill light';
    badge.textContent = 'Guard configured';
    const note = document.createElement('small');
    note.textContent = 'Automatic semantic discovery. Live provider validation pending.';
    card.append(logo, name, host, badge, note);
    $('provider-grid').append(card);
  }
}
$('provider-search').oninput = () => {
  providerVisible = 60;
  renderProviders();
};
$('provider-more').onclick = () => {
  providerVisible += 60;
  renderProviders();
};
$('rules-table').replaceChildren();
for (const rule of RULES) {
  const row = document.createElement('tr');
  for (const [i, value] of [rule.title, rule.category, rule.method].entries()) {
    const cell = document.createElement('td');
    cell.textContent = value;
    if (i === 0) {
      const sub = document.createElement('small');
      sub.textContent = rule.id;
      cell.append(sub);
    }
    row.append(cell);
  }
  $('rules-table').append(row);
}
async function persist(next) {
  if (locked || (await getPolicy()).locked)
    throw new Error('Company policy is managed and cannot be edited here.');
  validatePolicy(next);
  await savePolicy(next);
  policy = next;
  render();
  toast('Policy saved. Reload provider tabs to verify protection.');
}
$('add-catalog').onclick = async () => {
  try {
    const next = structuredClone(policy);
    const existing = new Set(next.sites.map((site) => site.host));
    next.sites.push(
      ...DEFAULT_SITES.filter((site) => !existing.has(site.host)).map((site) => ({ ...site })),
    );
    await persist(next);
    toast(
      `All ${catalogCount} curated providers enabled. Detection settings and private terms retained.`,
    );
  } catch (error) {
    toast(error.message, true);
  }
};
$('save-detection').onclick = async () => {
  try {
    const next = structuredClone(policy);
    for (const [key] of groups) next[key] = $(`toggle-${key}`).checked;
    next.defaultCountry = $('country').value;
    await persist(next);
  } catch (e) {
    toast(e.message, true);
  }
};
$('save').onclick = async () => {
  try {
    const next = EDITION.customSites
      ? JSON.parse($('policy').value)
      : {
          ...structuredClone(policy),
          sites: DEFAULT_SITES.filter((site) => selectedHosts.has(site.host)).map((site) => ({
            ...site,
          })),
        };
    next.sensitiveTerms = $('sensitive')
      .value.split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    next.blockTerms = $('blocked')
      .value.split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    await persist(next);
    $('status').textContent = EDITION.customSites ? 'Policy saved.' : 'Settings saved.';
  } catch (e) {
    $('status').textContent = e.message;
    toast(e.message, true);
  }
};
if (EDITION.customSites)
  $('reset').onclick = () => {
    const next = structuredClone(DEFAULT_POLICY);
    $('policy').value = JSON.stringify(next, null, 2);
    $('sensitive').value = '';
    $('blocked').value = '';
    toast('Defaults loaded into the editor. Save to apply.');
  };
async function loadSamples() {
  if (samples.length) return;
  try {
    const [positive, negative] = await Promise.all(
      ['positives', 'negatives'].map(async (name) => {
        const r = await fetch(new URL(`../../data/${name}.json`, import.meta.url));
        if (!r.ok) throw new Error('The local library could not be loaded.');
        return r.json();
      }),
    );
    samples = [...positive, ...negative];
    const categories = [...new Set(samples.map((s) => s.category))].sort();
    categoryControl.setChoices([
      { value: '', label: 'All categories' },
      ...categories.map((category) => ({ value: category, label: category })),
    ]);
    filterSamples();
  } catch (e) {
    toast(e.message, true);
  }
}
function filterSamples() {
  const query = $('sample-search').value.toLowerCase(),
    category = $('sample-category').value,
    type = $('sample-type').value;
  filtered = samples.filter(
    (s) =>
      (!category || s.category === category) &&
      (!query || `${s.category} ${s.text} ${s.id}`.toLowerCase().includes(query)) &&
      (type === 'all' || (type === 'positive' ? s.expected.length > 0 : s.expected.length === 0)),
  );
  page = 0;
  renderSamples();
}
for (const id of ['sample-search', 'sample-category', 'sample-type'])
  $(id).addEventListener(id === 'sample-search' ? 'input' : 'change', filterSamples);
function renderSamples() {
  $('sample-results').textContent = `${filtered.length.toLocaleString()} cases`;
  $('sample-list').replaceChildren();
  for (const sample of filtered.slice(page * pageSize, (page + 1) * pageSize)) {
    const row = document.createElement('button');
    row.className = `sample-row ${sample.expected.length ? '' : 'safe'} ${selected?.id === sample.id ? 'active' : ''}`;
    const dot = document.createElement('span');
    dot.className = 'sample-indicator';
    const body = document.createElement('div'),
      title = document.createElement('strong'),
      text = document.createElement('small'),
      code = document.createElement('code');
    title.textContent = sample.category;
    text.textContent = sample.text;
    code.textContent = sample.id;
    body.append(title, text);
    row.append(dot, body, code);
    row.onclick = () => {
      selectSample(sample);
      renderSamples();
    };
    $('sample-list').append(row);
  }
  if (!filtered.length) {
    const empty = document.createElement('p');
    empty.className = 'muted';
    empty.style.padding = '20px';
    empty.textContent = 'No cases match your search.';
    $('sample-list').append(empty);
  }
  $('sample-page').textContent =
    `${filtered.length ? page + 1 : 0} / ${Math.ceil(filtered.length / pageSize)}`;
  $('sample-prev').disabled = page === 0;
  $('sample-next').disabled = (page + 1) * pageSize >= filtered.length;
  if (!selected && filtered.length) selectSample(filtered[0]);
}
$('sample-prev').onclick = () => {
  page--;
  renderSamples();
};
$('sample-next').onclick = () => {
  page++;
  renderSamples();
};
function selectSample(sample) {
  selected = sample;
  $('sample-original').textContent = sample.text;
  $('sample-kind').textContent = sample.expected.length ? 'SENSITIVE' : 'SAFE TEXT';
  const result = redact(sample.text, { ...policy, ...sample.policy }, {}, 'preview');
  $('sample-redacted').textContent = result.blocked ? 'Blocked by current policy' : result.text;
  $('sample-finding-list').replaceChildren();
  for (const f of result.findings) {
    const chip = document.createElement('span');
    chip.className = 'finding-tag';
    chip.textContent = f.kind;
    $('sample-finding-list').append(chip);
  }
  $('sample-note').textContent =
    `${result.findings.length} match(es) under the current policy. Expected test kinds: ${[...new Set(sample.expected.map((e) => e.kind))].join(', ') || 'none'}. Source: ${sample.source || 'synthetic local fixture'}.${sample.policy?.defaultCountry ? ' Sample region override: ' + sample.policy.defaultCountry + '.' : ''}`;
  $('sample-use').disabled = false;
}
$('sample-use').onclick = () => {
  if (!selected) return;
  sessionStorage.setItem('guard-demo-draft', selected.text);
  window.open('workspace.html?sample=1', '_blank');
};
try {
  const state = await getPolicy();
  policy = { ...DEFAULT_POLICY, ...state.policy };
  locked = state.locked;
  render();
  if (!isExtension) toast('UI preview. Install the extension to connect a browser tab.');
} catch (e) {
  $('mode').textContent = 'Protection blocked';
  $('status').textContent = e.message;
  toast(`Protection policy unavailable: ${e.message}`, true);
}
try {
  const r = await fetch(new URL('../../data/manifest.json', import.meta.url));
  if (r.ok) {
    manifest = await r.json();
    $('sample-count').textContent = manifest.total.toLocaleString();
  }
} catch {}
