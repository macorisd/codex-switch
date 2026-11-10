'use strict';
(() => {
  const vscode = acquireVsCodeApi();
  const $ = id => document.getElementById(id);
  const cards = new Map(
    [...document.querySelectorAll('.provider-card')].map(card => [card.dataset.provider, card]),
  );
  let state;
  let busy = false;
  let pendingAction = null;
  let providerLayout = [];
  let layoutRevision = 0;
  const feedbackTimers = new Map();
  let balance = null;
  let balanceLoading = false;
  const send = message => vscode.postMessage(message);
  const isActive = provider => state?.provider === provider;
  const providerInfo = id => state?.providers.find(provider => provider.id === id);
  const hasDeepSeekKey = () => Boolean(state?.hasKey);
  const hasValidDeepSeekKey = () => Boolean(state?.hasValidKey);
  const isCheckingDeepSeekKey = () => Boolean(state?.keyChecking);

  function actionButton(id, text, disabled) {
    const button = $(id);
    button.textContent = text;
    button.disabled = disabled;
    button.classList.toggle('current-setting', disabled && text === 'Current Setting');
  }

  function sendLayout() {
    layoutRevision += 1;
    send({
      action: 'saveProviderLayout',
      layout: providerLayout.map(({ id, visible }) => ({ id, visible })),
      revision: layoutRevision,
    });
  }

  function adoptProviderLayout(layout, revision) {
    if (revision < layoutRevision) return;
    layoutRevision = revision;
    providerLayout = layout.map(entry => ({ ...entry }));
    const active = providerLayout.find(entry => entry.id === state?.provider);
    if (active) active.visible = true;
  }

  function renderManageList() {
    $('manage-list').replaceChildren(...providerLayout.map((entry, index) => {
      const info = providerInfo(entry.id);
      const item = document.createElement('li');
      item.className = 'manage-item';
      item.dataset.provider = entry.id;

      const label = document.createElement('label');
      label.className = 'manage-choice';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      const locked = isActive(entry.id);
      checkbox.checked = locked || entry.visible;
      checkbox.disabled = locked;
      checkbox.setAttribute('aria-label', `Show ${info.name} (${info.subtitle})`);
      checkbox.addEventListener('change', () => {
        if (locked) return;
        entry.visible = checkbox.checked;
        renderProviderOrder();
        sendLayout();
      });
      const name = document.createElement('span');
      name.textContent = `${info.name} (${info.subtitle})`;
      label.append(checkbox, name);

      const move = (offset) => {
        const target = index + offset;
        [providerLayout[index], providerLayout[target]] = [providerLayout[target], providerLayout[index]];
        renderManageList();
        renderProviderOrder();
        sendLayout();
      };
      const up = document.createElement('button');
      up.type = 'button';
      up.className = 'order-button';
      up.textContent = '\u2191';
      up.setAttribute('aria-label', `Move ${info.name} up`);
      up.disabled = index === 0;
      up.addEventListener('click', () => move(-1));
      const down = document.createElement('button');
      down.type = 'button';
      down.className = 'order-button';
      down.textContent = '\u2193';
      down.setAttribute('aria-label', `Move ${info.name} down`);
      down.disabled = index === providerLayout.length - 1;
      down.addEventListener('click', () => move(1));

      item.append(label, up, down);
      return item;
    }));
  }

  function renderProviderOrder() {
    const orderedCards = providerLayout
      .map(entry => ({ entry, card: cards.get(entry.id) }))
      .filter(({ card }) => card);
    const visible = ({ entry }) => entry.visible || isActive(entry.id);
    for (const { entry, card } of orderedCards) card.hidden = !visible({ entry });
    $('provider-list').replaceChildren(...orderedCards.filter(visible).map(({ card }) => card));
    $('provider-list').hidden = false;
  }

  function showFeedback(containerId, textId, ok, message) {
    clearTimeout(feedbackTimers.get(containerId));
    const container = $(containerId);
    container.hidden = false;
    container.classList.toggle('success', ok);
    container.classList.toggle('error', !ok);
    $(textId).textContent = message;
    feedbackTimers.set(containerId, setTimeout(() => {
      container.hidden = true;
      $(textId).textContent = '';
    }, 5000));
  }

  function clearFeedback(containerId, textId) {
    clearTimeout(feedbackTimers.get(containerId));
    $(containerId).hidden = true;
    $(textId).textContent = '';
  }

  function renderBalance() {
    const threshold = state?.balanceAlert?.threshold ?? 5;
    const level = state?.balanceAlert?.level || 'ok';
    const total = Number.isFinite(balance?.total) ? balance.total : null;
    $('balance-value').classList.toggle('low', level === 'low');
    $('balance-value').classList.toggle('zero', level === 'zero');
    $('balance-value').textContent = total === null
      ? (balance ? 'Unavailable' : '--')
      : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(total);
    $('balance-update').classList.toggle('loading', balanceLoading);
    $('balance-update').disabled = busy || !hasValidDeepSeekKey();
    $('balance-alert-toggle').disabled = busy || !hasValidDeepSeekKey();

    const input = $('balance-threshold');
    if (document.activeElement !== input) {
      input.value = String(threshold);
    }
    $('balance-threshold-copy').textContent = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(threshold);
  }

  function render() {
    if (!state) return;
    const active = providerInfo(state.provider);
    $('current').textContent = active ? `${active.name} (${active.subtitle})` : state.provider;

    for (const [id, card] of cards) card.classList.toggle('current-provider', isActive(id));
    actionButton('openai', isActive('openai') ? 'Current Setting' : 'Switch to ChatGPT', busy || isActive('openai'));
    actionButton(
      'deepseek-switch',
      isActive('deepseek') ? 'Current Setting' : 'Switch to DeepSeek',
      busy || isActive('deepseek') || !hasValidDeepSeekKey(),
    );

    const keyChecking = isCheckingDeepSeekKey();
    const hasValidKey = hasValidDeepSeekKey();
    $('key-dot').classList.toggle('configured', hasValidKey && !keyChecking);
    $('key-dot').classList.toggle('not-configured', !hasValidKey && !keyChecking);
    $('key-dot').classList.toggle('loading', keyChecking);
    $('key-status').textContent = keyChecking
      ? 'Loading...'
      : hasValidKey ? 'Configured' : 'Not configured';
    $('set-key').disabled = busy || keyChecking;
    $('model-catalog').hidden = !hasValidDeepSeekKey();
    $('usage').hidden = !hasValidDeepSeekKey();

    $('models').replaceChildren(...state.models.map(model => {
      const item = document.createElement('li');
      item.textContent = model.name;
      return item;
    }));
    $('refresh').textContent = pendingAction === 'refresh' && busy ? 'Updating...' : 'Update model catalog';
    $('refresh').disabled = busy;
    $('verify').disabled = busy || keyChecking || !hasDeepSeekKey();
    renderBalance();

    renderManageList();
    renderProviderOrder();
  }

  function setManageOpen(open) {
    const panel = $('manage-panel');
    panel.hidden = !open;
    $('manage-providers').setAttribute('aria-expanded', String(open));
  }

  $('manage-providers').addEventListener('click', () => setManageOpen($('manage-panel').hidden));
  $('close-manage').addEventListener('click', () => setManageOpen(false));
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    if (!$('manage-panel').hidden) setManageOpen(false);
    if (!$('balance-alert-editor').hidden) {
      $('balance-alert-editor').hidden = true;
      $('balance-alert-toggle').setAttribute('aria-expanded', 'false');
    }
  });
  $('set-key').addEventListener('click', () => send({ action: 'saveKey' }));
  $('openai').addEventListener('click', () => send({ action: 'apply', provider: 'openai' }));
  $('deepseek-switch').addEventListener('click', () => send({ action: 'apply', provider: 'deepseek' }));
  $('refresh').addEventListener('click', () => {
    pendingAction = 'refresh';
    clearFeedback('catalog-feedback', 'catalog-feedback-text');
    send({ action: 'refresh' });
  });
  $('verify').addEventListener('click', () => {
    pendingAction = 'verify';
    clearFeedback('connection-feedback', 'connection-feedback-text');
    send({ action: 'verify' });
  });
  $('balance-update').addEventListener('click', () => {
    if (balanceLoading) return;
    balanceLoading = true;
    clearFeedback('balance-feedback', 'balance-feedback-text');
    renderBalance();
    send({ action: 'syncBalance' });
  });
  $('balance-alert-toggle').addEventListener('click', () => {
    const editor = $('balance-alert-editor');
    editor.hidden = !editor.hidden;
    $('balance-alert-toggle').setAttribute('aria-expanded', String(!editor.hidden));
    if (!editor.hidden) $('balance-threshold').focus();
  });
  $('balance-alert-close').addEventListener('click', () => {
    $('balance-alert-editor').hidden = true;
    $('balance-alert-toggle').setAttribute('aria-expanded', 'false');
  });
  $('balance-threshold').addEventListener('keydown', event => {
    if (event.key === 'Enter') $('balance-threshold').blur();
  });
  $('balance-threshold').addEventListener('change', event => {
    const value = event.target.value.trim();
    send({ action: 'saveBalanceAlert', threshold: value === '' ? 0 : Number(value) });
  });

  window.addEventListener('message', ({ data }) => {
    if (data.type === 'state') {
      const wasValid = hasValidDeepSeekKey();
      state = data.state;
      if (wasValid && !hasValidDeepSeekKey()) balance = null;
      busy = data.busy;
      if ((state.providerLayoutRevision || 0) >= layoutRevision) {
        adoptProviderLayout(state.providerLayout, state.providerLayoutRevision || 0);
      }
      render();
    } else if (data.type === 'busy') {
      busy = data.busy;
      if (!busy) pendingAction = null;
      render();
    } else if (data.type === 'actionResult') {
      const action = data.action || pendingAction;
      pendingAction = null;
      if (action === 'verify') {
        showFeedback('connection-feedback', 'connection-feedback-text', data.ok, data.message);
      } else if (action === 'refresh') {
        showFeedback('catalog-feedback', 'catalog-feedback-text', data.ok, data.message);
      }
      render();
    } else if (data.type === 'balance') {
      balance = data.balance;
      state.balanceAlert = data.balanceAlert;
      balanceLoading = false;
      renderBalance();
    } else if (data.type === 'balanceAlert') {
      state.balanceAlert = data.balanceAlert;
      renderBalance();
    } else if (data.type === 'balanceLoading') {
      balanceLoading = data.loading;
      renderBalance();
    } else if (data.type === 'balanceError') {
      balanceLoading = false;
      balance = null;
      showFeedback('balance-feedback', 'balance-feedback-text', false, data.message);
      renderBalance();
    } else if (data.type === 'providerLayout') {
      adoptProviderLayout(data.layout, data.revision);
      renderManageList();
      renderProviderOrder();
    } else if (data.type === 'providerLayoutError') {
      adoptProviderLayout(data.layout, data.revision);
      renderManageList();
      renderProviderOrder();
    }
  });

  send({ action: 'ready' });
})();
