import { COUNTRY_CODES } from '../core/country-codes.js';

const nativeRegionNames = Object.freeze({
  RU: 'Россия',
  BY: 'Беларусь',
  KZ: 'Қазақстан',
  UA: 'Україна',
  AM: 'Հայաստան',
  AZ: 'Azərbaycan',
  GE: 'საქართველო',
  KG: 'Кыргызстан',
  TJ: 'Тоҷикистон',
  TM: 'Türkmenistan',
  UZ: 'Oʻzbekiston',
});

export function phoneRegionChoices() {
  const names = new Intl.DisplayNames(['en'], { type: 'region' });
  return COUNTRY_CODES.map((value) => {
    const name = names.of(value) || value;
    return {
      value,
      label: nativeRegionNames[value] ? `${nativeRegionNames[value]} · ${name}` : name,
      meta: value,
    };
  }).sort((a, b) => names.of(a.value).localeCompare(names.of(b.value), 'en'));
}

let modalSequence = 0;
const searchableText = (text) => text.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase();

/** A shared, extension-owned modal. Choices never become native dropdown controls. */
export function createChoiceModal(document) {
  const make = (tag, className, text) => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  };
  const dialog = make('dialog', 'choice-dialog');
  const surface = make('div', 'choice-surface');
  const header = make('div', 'choice-heading');
  const headingBody = make('div');
  const eyebrow = make('div', 'eyebrow', 'WORKSPACE PREFERENCES');
  const title = make('h2');
  title.id = `choice-title-${++modalSequence}`;
  const description = make('p', 'choice-description');
  description.id = `choice-description-${modalSequence}`;
  dialog.setAttribute('aria-labelledby', title.id);
  dialog.setAttribute('aria-describedby', description.id);
  const close = make('button', 'choice-close', '×');
  close.type = 'button';
  close.setAttribute('aria-label', 'Close choice dialog');
  headingBody.append(eyebrow, title);
  header.append(headingBody, close);
  const searchWrap = make('div', 'choice-search');
  const searchMark = make('span', 'choice-search-mark', '⌕');
  searchMark.setAttribute('aria-hidden', 'true');
  const search = make('input');
  search.type = 'text';
  search.autocomplete = 'off';
  search.spellcheck = false;
  searchWrap.append(searchMark, search);
  const results = make('div', 'choice-results');
  results.setAttribute('role', 'group');
  results.setAttribute('aria-label', 'Available choices');
  const footer = make('div', 'choice-footer');
  const count = make('span', 'choice-count');
  count.setAttribute('role', 'status');
  const cancel = make('button', 'button secondary', 'Cancel');
  cancel.type = 'button';
  footer.append(count, cancel);
  surface.append(header, description, searchWrap, results, footer);
  dialog.append(surface);
  document.body.append(dialog);
  let active,
    buttons = [];

  function finish(choice) {
    if (!active) return;
    const current = active;
    active = undefined;
    if (dialog.open) dialog.close();
    current.opener.setAttribute('aria-expanded', 'false');
    current.opener.focus();
    if (choice) current.onChoose(choice.value);
    results.replaceChildren();
    buttons = [];
  }

  function focusChoice(button) {
    for (const candidate of buttons) candidate.tabIndex = candidate === button ? 0 : -1;
    button?.focus();
  }

  function renderChoices() {
    const query = searchableText(search.value.trim());
    const choices = active.choices.filter((choice) =>
      searchableText(`${choice.label} ${choice.meta || ''} ${choice.value}`).includes(query),
    );
    results.replaceChildren();
    buttons = choices.map((choice) => {
      const button = make('button', 'choice-option');
      button.type = 'button';
      button.dataset.value = choice.value;
      const chosen = choice.value === active.value;
      button.classList.toggle('chosen', chosen);
      button.setAttribute('aria-pressed', String(chosen));
      button.append(make('span', 'choice-option-label', choice.label));
      if (choice.meta) button.append(make('span', 'choice-option-meta', choice.meta));
      const check = make('span', 'choice-check', chosen ? '✓' : '');
      check.setAttribute('aria-hidden', 'true');
      button.append(check);
      button.onclick = () => finish(choice);
      button.addEventListener('focus', () => {
        for (const candidate of buttons) candidate.tabIndex = candidate === button ? 0 : -1;
      });
      results.append(button);
      return button;
    });
    const current = buttons.find((button) => button.dataset.value === active.value) || buttons[0];
    for (const button of buttons) button.tabIndex = button === current ? 0 : -1;
    count.textContent = `${choices.length.toLocaleString()} ${choices.length === 1 ? 'choice' : 'choices'}`;
    if (!choices.length)
      results.append(make('p', 'choice-empty', 'No matches. Try another search term.'));
  }

  search.oninput = renderChoices;
  close.onclick = () => finish();
  cancel.onclick = () => finish();
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    finish();
  });
  dialog.addEventListener('close', () => {
    if (!dialog.open) finish();
  });
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) finish();
  });
  dialog.addEventListener('keydown', (event) => {
    if (!active) return;
    const focused = document.activeElement;
    const index = buttons.indexOf(focused);
    if (event.key === 'Tab') {
      const row = buttons.find((button) => button.tabIndex === 0);
      const focusable = [close, search, row, cancel].filter(Boolean);
      const next = event.shiftKey ? focusable.at(-1) : focusable[0];
      if (
        (event.shiftKey && focused === focusable[0]) ||
        (!event.shiftKey && focused === focusable.at(-1))
      ) {
        event.preventDefault();
        next.focus();
      }
    } else if (
      buttons.length &&
      ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) &&
      (focused === search || index >= 0)
    ) {
      event.preventDefault();
      let next;
      if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = buttons.length - 1;
      else if (index < 0) next = event.key === 'ArrowUp' ? buttons.length - 1 : 0;
      else next = (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
      focusChoice(buttons[next]);
    } else if (event.key === 'Enter' && focused === search && buttons.length === 1) {
      event.preventDefault();
      buttons[0].click();
    }
  });

  return {
    open(config) {
      finish();
      active = config;
      title.textContent = config.title;
      description.textContent = config.description;
      search.value = '';
      search.setAttribute('aria-label', config.searchLabel || 'Search choices');
      search.placeholder = config.searchPlaceholder || 'Search available choices…';
      config.opener.setAttribute('aria-expanded', 'true');
      renderChoices();
      dialog.showModal();
      search.focus();
    },
    close: () => finish(),
  };
}

export function bindChoiceControl(button, modal, config) {
  let choices = config.choices;
  const document = button.ownerDocument;
  button.setAttribute('aria-haspopup', 'dialog');
  button.setAttribute('aria-expanded', 'false');
  const label = document.createElement('span');
  label.className = 'choice-value';
  const mark = document.createElement('span');
  mark.className = 'choice-open';
  mark.textContent = '↗';
  mark.setAttribute('aria-hidden', 'true');
  button.replaceChildren(label, mark);
  function setValue(value, notify = false) {
    const choice = choices.find((item) => item.value === value);
    if (!choice) throw new Error(`Unknown choice: ${value}`);
    button.value = value;
    label.textContent = choice.label;
    button.setAttribute('aria-label', `${config.label}: ${choice.label}`);
    if (notify) button.dispatchEvent(new document.defaultView.Event('change', { bubbles: true }));
  }
  button.onclick = () => {
    if (button.disabled) return;
    modal.open({
      ...config,
      choices,
      value: button.value,
      opener: button,
      onChoose: (value) => setValue(value, true),
    });
  };
  setValue(config.value ?? choices[0].value);
  return {
    setValue,
    setChoices(next) {
      choices = next;
      setValue(
        choices.some((item) => item.value === button.value) ? button.value : choices[0].value,
      );
    },
  };
}
