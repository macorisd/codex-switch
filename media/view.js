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
  let feedbackTimer;
  const send = message => vscode.postMessage(message);
  const isActive = provider => state?.provider === provider;
  const providerInfo = id => state?.providers.find(provider => provider.id === id);
  const hasDeepSeekKey = () => Boolean(state?.hasKey);

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
  }

  function showFeedback(ok, message) {
    clearTimeout(feedbackTimer);
    $('action-feedback').hidden = false;
    $('action-feedback').classList.toggle('success', ok);
    $('action-feedback').classList.toggle('error', !ok);
    $('feedback-text').textContent = message;
    feedbackTimer = setTimeout(() => {
      $('action-feedback').hidden = true;
      $('feedback-text').textContent = '';
    }, 3000);
  }

  function clearFeedback() {
    clearTimeout(feedbackTimer);
    $('action-feedback').hidden = true;
    $('feedback-text').textContent = '';
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
      busy || isActive('deepseek') || !hasDeepSeekKey(),
    );

    $('key-dot').classList.toggle('configured', hasDeepSeekKey());
    $('key-dot').classList.toggle('not-configured', !hasDeepSeekKey());
    $('key-status').textContent = hasDeepSeekKey() ? 'Configured' : 'Not configured';
    $('set-key').disabled = busy;

    $('models').replaceChildren(...state.models.map(model => {
      const item = document.createElement('li');
      item.textContent = model.name;
      return item;
    }));
    $('refresh').textContent = pendingAction === 'refresh' && busy ? 'Updating...' : 'Update model catalog';
    $('refresh').disabled = busy;
    $('verify').textContent = pendingAction === 'verify' && busy ? 'Checking...' : 'Check connection';
    $('verify').disabled = busy || !hasDeepSeekKey();

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
    if (event.key === 'Escape' && !$('manage-panel').hidden) setManageOpen(false);
  });
  $('set-key').addEventListener('click', () => send({ action: 'saveKey' }));
  $('openai').addEventListener('click', () => send({ action: 'apply', provider: 'openai' }));
  $('deepseek-switch').addEventListener('click', () => send({ action: 'apply', provider: 'deepseek' }));
  $('refresh').addEventListener('click', () => {
    pendingAction = 'refresh';
    clearFeedback();
    send({ action: 'refresh' });
  });
  $('verify').addEventListener('click', () => {
    pendingAction = 'verify';
    clearFeedback();
    send({ action: 'verify' });
  });

  window.addEventListener('message', ({ data }) => {
    if (data.type === 'state') {
      state = data.state;
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
      pendingAction = null;
      showFeedback(data.ok, data.message);
      render();
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
