'use strict';
(() => {
  const vscode = acquireVsCodeApi();
  const $ = id => document.getElementById(id);
  const cards = new Map(
    [...document.querySelectorAll('.provider-card')].map(card => [card.dataset.provider, card]),
  );
  let state;
  let busy = false;
  let providerLayout = [];
  let layoutRevision = 0;
  let syncLoading = false;
  let account = { loading: true };
  let countdownTimer = null;
  let manageListKey = '';
  const send = message => vscode.postMessage(message);
  const isActive = provider => state?.provider === provider;
  const providerInfo = id => {
    const info = state?.providers.find(provider => provider.id === id);
    return info && id === 'openai' ? { ...info, subtitle: account.configured && account.plan ? `Your ${account.plan} Plan` : 'Your Plan' } : info;
  };
  const apiCards = new window.ApiCards(send);
  function actionButton(id, text, disabled) {
    $(id).textContent = text;
    $(id).disabled = disabled;
    $(id).classList.toggle('current-setting', isActive(id));
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
    const nextKey = JSON.stringify(providerLayout.map(entry => [
      entry.id, entry.visible, isActive(entry.id), providerInfo(entry.id)?.name, providerInfo(entry.id)?.subtitle,
    ]));
    if (nextKey === manageListKey) return;
    manageListKey = nextKey;
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
    const list = $('provider-list');
    const nextCards = orderedCards.filter(visible).map(({ card }) => card);
    const currentCards = [...list.children];
    if (nextCards.length !== currentCards.length || nextCards.some((card, index) => card !== currentCards[index])) {
      list.replaceChildren(...nextCards);
    }
    list.hidden = false;
  }

  function renderAccount() {
    $('chatgpt-plan').textContent = providerInfo('openai')?.subtitle || 'Your Plan';
    $('chatgpt-dot').classList.toggle('configured', account.configured === true);
    $('chatgpt-dot').classList.toggle('not-configured', account.configured === false);
    $('chatgpt-dot').classList.toggle('loading', Boolean(account.loading));
    $('chatgpt-dot').classList.toggle('unavailable', !account.loading && account.configured === undefined);
    $('chatgpt-status').textContent = account.loading ? 'Loading...'
      : account.configured === true ? (account.stale ? 'Configured (out of date)' : 'Configured')
        : account.configured === false ? (account.stale ? 'Not configured (out of date)' : 'Not configured') : 'Unavailable';
    $('chatgpt-usage').hidden = !account.configured;
    $('chatgpt-stale').hidden = !account.stale && account.usageAvailable !== false;
    for (const [prefix, value] of [['five-hour', account.fiveHour], ['weekly', account.weekly]]) {
      const remaining = Number.isFinite(value?.remaining) ? value.remaining : null;
      $(prefix + '-value').textContent = remaining === null ? 'Unavailable' : `${Math.round(remaining)}%`;
      $(prefix + '-bar').hidden = remaining === null;
      $(prefix + '-bar').value = remaining ?? 0;
      const reset = value?.resetsAt ? new Date(value.resetsAt * 1000) : null;
      const validReset = reset && Number.isFinite(reset.getTime());
      $(prefix + '-reset').textContent = validReset
        ? `Resets ${new Intl.DateTimeFormat(undefined, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(reset)}`
        : 'Reset: Unavailable';
      const minutes = validReset ? Math.max(0, Math.floor((reset.getTime() - Date.now()) / 60000)) : null;
      const units = prefix === 'weekly'
        ? [[Math.floor(minutes / 1440), 'd'], [Math.floor(minutes / 60) % 24, 'h'], [minutes % 60, 'm']]
        : [[Math.floor(minutes / 60), 'h'], [minutes % 60, 'm']];
      const countdown = units.filter(([amount]) => amount > 0).map(([amount, unit]) => `${amount}${unit}`).join(' ');
      $(prefix + '-countdown').textContent = minutes === null ? '' : countdown
        ? `Resets in ${countdown}` : "Resets in a few seconds. Blink and you'll miss it!";
    }
    $('banked-resets').textContent = Number.isInteger(account.bankedResets) ? String(account.bankedResets) : 'Unavailable';
  }

  function updateCountdownTimer() {
    clearInterval(countdownTimer);
    countdownTimer = null;
    if (!document.hidden) countdownTimer = setInterval(renderAccount, 60_000);
  }
  document.addEventListener('visibilitychange', updateCountdownTimer);
  window.addEventListener('pagehide', () => clearInterval(countdownTimer));
  updateCountdownTimer();

  function render() {
    if (!state) return;
    for (const provider of state.providers.filter(p => p.id !== 'openai')) cards.set(provider.id, apiCards.card(provider));
    const active = providerInfo(state.provider);
    $('current').textContent = active ? `${active.name} (${active.subtitle})` : state.provider;
    cards.get('openai').classList.toggle('current-provider', isActive('openai'));
    actionButton('openai', isActive('openai') ? 'Current Setting' : 'Switch to ChatGPT', busy || isActive('openai'));
    $('sync-all').classList.toggle('loading', syncLoading);
    $('sync-all').disabled = syncLoading || busy;
    apiCards.active(state.provider, state.model);
    apiCards.alert(state.balanceAlerts);
    renderAccount(); renderManageList(); renderProviderOrder();
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
    apiCards.closePanels();
  });
  $('openai').addEventListener('click', () => send({ action: 'apply', provider: 'openai' }));
  $('sync-all').addEventListener('click', () => {
    if (syncLoading || busy) return;
    syncLoading = true; render(); send({ action: 'syncAll' });
  });
  window.addEventListener('message', ({ data }) => {
    if (data.type === 'state') {
      state = data.state; account = state.chatgpt || account; busy = data.busy;
      adoptProviderLayout(state.providerLayout, state.providerLayoutRevision || 0); render();
    } else if (data.type === 'apiState') {
      apiCards.update(data.provider, data.state);
    } else if (data.type === 'balanceAlerts') {
      if (state) state.balanceAlerts = data.balanceAlerts;
      apiCards.alert(data.balanceAlerts);
    } else if (data.type === 'chatgpt') { account = data.account; render();
    } else if (data.type === 'syncLoading') { syncLoading = data.loading; render();
    } else if (data.type === 'providerLayout' || data.type === 'providerLayoutError') {
      adoptProviderLayout(data.layout, data.revision); render();
    }
  });
  send({ action: 'ready' });
})();
