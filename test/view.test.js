'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const extensionRoot = path.dirname(__dirname);

class ClassList {
  constructor() {
    this.values = new Set();
  }

  toggle(name, force) {
    if (force) this.values.add(name);
    else this.values.delete(name);
  }

  contains(name) {
    return this.values.has(name);
  }
}

class Element {
  constructor(tagName = 'div', id = '') {
    this.tagName = tagName.toUpperCase();
    this.id = id;
    this.children = [];
    this.listeners = new Map();
    this.attributes = new Map();
    this.dataset = {};
    this.classList = new ClassList();
    this.hidden = false;
    this.disabled = false;
    this.checked = false;
    this.value = '';
    this.textContent = '';
  }

  append(...children) {
    this.children.push(...children);
  }

  replaceChildren(...children) {
    this.children = [...children];
  }

  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }

  dispatch(type) {
    this.listeners.get(type)?.({ target: this });
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name);
  }

  focus() {}
}

function webviewHarness(state) {
  const elements = new Map();
  const add = (id, tag = 'div') => {
    const element = new Element(tag, id);
    elements.set(id, element);
    return element;
  };
  for (const id of [
    'manage-providers', 'manage-panel', 'manage-list', 'provider-list', 'close-manage',
    'set-key', 'openai', 'deepseek-switch', 'current', 'key-dot', 'key-status',
    'models', 'refresh', 'verify', 'action-feedback', 'feedback-text',
    'balance-value', 'balance-update', 'balance-alert-toggle', 'balance-alert-editor',
    'balance-threshold',
  ]) add(id);
  elements.get('provider-list').hidden = true;
  elements.get('balance-alert-editor').hidden = true;

  const openaiCard = add('openai-card', 'article');
  openaiCard.dataset.provider = 'openai';
  const deepseekCard = add('deepseek-card', 'article');
  deepseekCard.dataset.provider = 'deepseek';
  const cards = [openaiCard, deepseekCard];

  const windowListeners = new Map();
  const messages = [];
  const timers = [];
  const document = {
    getElementById: id => elements.get(id),
    querySelectorAll: selector => selector === '.provider-card' ? cards : [],
    createElement: tag => new Element(tag),
    addEventListener() {},
  };
  const window = {
    addEventListener(type, listener) {
      windowListeners.set(type, listener);
    },
  };
  const sandbox = {
    document,
    window,
    acquireVsCodeApi: () => ({
      postMessage: message => messages.push(JSON.parse(JSON.stringify(message))),
    }),
    setTimeout: (listener, delay) => {
      timers.push({ listener, delay });
      return timers.length;
    },
    clearTimeout() {},
  };
  vm.runInNewContext(
    fs.readFileSync(path.join(extensionRoot, 'media', 'view.js'), 'utf8'),
    sandbox,
  );
  const receive = data => windowListeners.get('message')({ data });
  if (state) receive({ type: 'state', state, busy: false });
  return { elements, cards, messages, timers, receive };
}

function initialState(providerLayout = [
  { id: 'openai', visible: true },
  { id: 'deepseek', visible: true },
], provider = 'openai') {
  return {
    provider,
    hasKey: true,
    models: [{ id: 'deepseek-flash', name: 'DeepSeek-Flash' }],
    providers: [
      { id: 'openai', name: 'ChatGPT', subtitle: 'Your Plan' },
      { id: 'deepseek', name: 'DeepSeek', subtitle: 'API key' },
    ],
    providerLayout,
    providerLayoutRevision: 0,
    balanceAlert: { threshold: null, level: 'ok' },
  };
}

function manageItem(element, provider) {
  return element.children.find(item => item.dataset.provider === provider);
}

test('webview applies provider filtering before revealing the section', () => {
  const h = webviewHarness(null);
  assert.equal(h.elements.get('provider-list').hidden, true);
  h.receive({
    type: 'state',
    busy: false,
    state: initialState([
      { id: 'deepseek', visible: true },
      { id: 'openai', visible: false },
    ], 'deepseek'),
  });
  assert.equal(h.elements.get('provider-list').hidden, false);
  assert.deepEqual(h.elements.get('provider-list').children, [h.cards[1]]);
});

test('webview keeps the active card visible and formats provider labels', () => {
  const h = webviewHarness(initialState([
    { id: 'deepseek', visible: true },
    { id: 'openai', visible: false },
  ]));
  assert.equal(h.elements.get('current').textContent, 'ChatGPT (Your Plan)');
  assert.equal(h.elements.get('provider-list').children.includes(h.cards[0]), true);
  const openaiItem = manageItem(h.elements.get('manage-list'), 'openai');
  const deepseekItem = manageItem(h.elements.get('manage-list'), 'deepseek');
  assert.equal(openaiItem.children[0].children[0].disabled, true);
  assert.equal(openaiItem.children[0].children[1].textContent, 'ChatGPT (Your Plan)');
  assert.equal(deepseekItem.children[0].children[1].textContent, 'DeepSeek (API key)');
});

test('webview can uncheck and then reliably check a provider again', () => {
  const h = webviewHarness(initialState());
  const deepseekItem = manageItem(h.elements.get('manage-list'), 'deepseek');
  const checkbox = deepseekItem.children[0].children[0];

  checkbox.checked = false;
  checkbox.dispatch('change');
  assert.equal(h.elements.get('provider-list').children.includes(h.cards[1]), false);
  assert.equal(h.messages.at(-1).layout.find(entry => entry.id === 'deepseek').visible, false);

  checkbox.checked = true;
  checkbox.dispatch('change');
  assert.equal(h.elements.get('provider-list').children.includes(h.cards[1]), true);
  assert.equal(h.messages.at(-1).layout.find(entry => entry.id === 'deepseek').visible, true);
});

test('webview ignores attempts to hide the active provider and closes with X', () => {
  const h = webviewHarness(initialState());
  const openaiItem = manageItem(h.elements.get('manage-list'), 'openai');
  const checkbox = openaiItem.children[0].children[0];
  const before = h.messages.length;
  checkbox.checked = false;
  checkbox.dispatch('change');
  assert.equal(h.messages.length, before);
  assert.equal(h.elements.get('provider-list').children.includes(h.cards[0]), true);

  h.elements.get('manage-panel').hidden = false;
  h.elements.get('close-manage').dispatch('click');
  assert.equal(h.elements.get('manage-panel').hidden, true);
});

test('webview hides colored action feedback after 3000 ms without an icon', () => {
  const h = webviewHarness(initialState());
  h.receive({
    type: 'actionResult',
    ok: true,
    message: 'Connection successful.',
  });
  assert.equal(h.elements.get('action-feedback').hidden, false);
  assert.equal(h.elements.get('feedback-text').textContent, 'Connection successful.');
  assert.equal(h.timers.at(-1).delay, 3000);
  h.timers.at(-1).listener();
  assert.equal(h.elements.get('action-feedback').hidden, true);
});

test('webview renders balance states and saves the alert threshold', () => {
  const h = webviewHarness(initialState());
  h.receive({
    type: 'balance',
    balance: { available: true, currency: 'USD', total: 4.25, totalText: '4.25' },
    balanceAlert: { threshold: 5, level: 'low' },
  });
  assert.equal(h.elements.get('balance-value').textContent, '$4.25');
  assert.equal(h.elements.get('balance-value').classList.contains('low'), true);
  assert.equal(h.elements.get('balance-value').classList.contains('zero'), false);

  h.elements.get('balance-alert-toggle').dispatch('click');
  assert.equal(h.elements.get('balance-alert-editor').hidden, false);
  assert.equal(h.elements.get('balance-threshold').value, '5');
  h.elements.get('balance-threshold').value = '2.50';
  h.elements.get('balance-threshold').dispatch('change');
  assert.deepEqual(h.messages.at(-1), { action: 'saveBalanceAlert', threshold: 2.5 });

  h.receive({
    type: 'balance',
    balance: { available: true, currency: 'USD', total: 0, totalText: '0.00' },
    balanceAlert: { threshold: 5, level: 'zero' },
  });
  assert.equal(h.elements.get('balance-value').textContent, '$0.00');
  assert.equal(h.elements.get('balance-value').classList.contains('zero'), true);
  assert.equal(h.elements.get('balance-value').classList.contains('low'), false);
});
