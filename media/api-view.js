'use strict';
// Static template + textContent only: upstream model names never become markup.
window.ApiCards = class {
  constructor(send) { this.send = send; this.entries = new Map(); this.buffer = new Map(); this.alerts = {}; }
  card(provider) {
    if (this.entries.has(provider.id)) return this.entries.get(provider.id).card;
    const card = document.createElement('article');
    card.className = 'provider-card'; card.dataset.provider = provider.id;
    card.classList.toggle('provider-aggregator', Boolean(provider.modelFilters?.laboratory));
    card.innerHTML = `<header class="provider-header">
        <div class="provider-identity">
          <span class="provider-icon api-icon"></span>
          <div class="provider-title"><h3></h3><p>API key</p></div>
        </div>
      </header>
      <div class="credential-row"><div class="credential-status"><span class="status-dot loading" data-role="dot" aria-hidden="true"></span><span data-role="status">Loading...</span></div><button class="text-button" data-role="key">Set API key</button></div>
      <div class="action-row connection-action">
        <div class="connection-controls">
          <button class="text-button" data-role="refresh">Check connection</button>
          <button class="text-button" data-role="endpoint" hidden>API endpoint</button>
        </div>
        <span class="action-feedback" data-role="feedback" role="status" hidden></span>
      </div>
      <p class="api-error" data-role="error" role="status"></p>
      <details class="model-catalog" data-role="catalog" hidden><summary>Model catalog</summary><div class="model-catalog-content">
      <input type="search" data-role="search" aria-label="Search models" placeholder="Search models...">
      <select data-role="lab" aria-label="Filter laboratory" hidden></select>
      <label class="model-free-filter" data-role="free-filter" hidden><input type="checkbox" data-role="free">Free models only</label>
      <select data-role="model" size="6" aria-label="Select model"></select>
      <p class="usage-note model-selection" data-role="selected"></p>
      <p class="usage-note" data-role="compatibility"></p>
      <div class="action-row">
        <button class="text-button" data-role="refresh-models">Update model catalog</button>
        <span class="action-feedback" data-role="feedback-catalog" role="status" hidden></span>
      </div>
      <div class="model-test">
        <div class="action-row">
          <button class="text-button" data-role="test">Test model</button>
          <span class="action-feedback" data-role="feedback-test" role="status" hidden></span>
        </div>
        <p class="usage-note">Uses API credits</p>
      </div>
      </div></details>
      <div class="usage" data-role="balance" hidden><h4>Available balance</h4><strong class="api-balance" data-role="amount"></strong></div>
      <div class="chatgpt-usage" data-role="windows" hidden></div>
      <div data-role="alerts" hidden><button class="text-button" data-role="alert-toggle">Balance alert</button><div class="balance-alert-editor" data-role="alert-panel" hidden><button class="balance-alert-close" data-role="alert-close" aria-label="Close balance alert">&times;</button><p data-role="alert-description"></p><input type="number" min="0" step="0.01" data-role="threshold" aria-label="Balance alert threshold"></div></div>
      <button class="primary" data-role="apply">Switch provider</button>`;
    card.querySelector('h3').textContent = provider.name;
    if (provider.id === 'deepseek') card.querySelector('.api-icon').classList.add('deepseek-icon');
    const image = document.createElement('img'); image.src = provider.iconUri; image.alt = ''; image.width = 24; image.height = 24;
    card.querySelector('.api-icon').append(image);
    const get = role => card.querySelector(`[data-role="${role}"]`);
    const entry = { provider, card, get, state: { loading: true, models: [] }, active: false };
    this.entries.set(provider.id, entry);
    for (const role of ['key', 'refresh', 'refresh-models', 'endpoint', 'model', 'test', 'apply']) {
      for (const type of ['click', 'keydown', 'pointerdown', 'mousedown', 'change']) {
        get(role).addEventListener(type, event => {
          if (!this.refreshing) return;
          if (type === 'keydown' && (['Tab', 'Escape'].includes(event.key)
            || (role !== 'model' && !['Enter', ' '].includes(event.key)))) return;
          event.preventDefault(); event.stopImmediatePropagation();
        }, true);
      }
    }
    const send = (operation, extra = {}) => {
      if (!this.refreshing) this.send({ action: 'api', provider: provider.id, operation, ...extra });
    };
    get('key').onclick = () => send('saveKey');
    for (const role of ['refresh', 'refresh-models']) get(role).onclick = () => send('refresh', { origin: role });
    get('endpoint').onclick = () => send('endpoint');
    get('apply').onclick = () => send('apply');
    get('search').oninput = () => this.models(entry);
    get('lab').onchange = () => this.models(entry);
    get('free-filter').hidden = !provider.modelFilters?.free;
    get('free').onchange = () => this.models(entry);
    get('model').onchange = () => send('select', { model: get('model').value });
    get('alert-panel').id = `${provider.id}-balance-alert`;
    get('alert-toggle').setAttribute('aria-controls', get('alert-panel').id);
    get('alert-toggle').setAttribute('aria-expanded', 'false');
    get('alert-toggle').onclick = () => {
      get('alert-panel').hidden = !get('alert-panel').hidden;
      get('alert-toggle').setAttribute('aria-expanded', String(!get('alert-panel').hidden));
    };
    get('alert-close').onclick = () => {
      get('alert-panel').hidden = true;
      get('alert-toggle').setAttribute('aria-expanded', 'false');
    };
    get('threshold').value = String(this.alerts[provider.id]?.threshold ?? 0);
    const saveThreshold = () => {
      const threshold = window.BalanceAlerts.threshold(get('threshold').value);
      get('threshold').value = String(threshold);
      if (threshold === (this.alerts[provider.id]?.threshold ?? 0)) return;
      this.alerts[provider.id] = { threshold };
      this.renderBalance(entry);
      this.send({ action: 'saveBalanceAlert', provider: provider.id, threshold });
    };
    get('threshold').onchange = saveThreshold;
    get('threshold').onblur = saveThreshold;
    get('test').onclick = () => send('test');
    this.update(provider.id, this.buffer.get(provider.id) || entry.state);
    this.lock(entry);
    return card;
  }
  lock(entry) {
    for (const role of ['key', 'refresh', 'refresh-models', 'endpoint', 'model', 'test', 'apply']) {
      const control = entry.get(role);
      // Keep native disabled/focus styling unchanged while rejecting activation.
      if (this.refreshing) control.setAttribute('aria-disabled', 'true');
      else control.removeAttribute('aria-disabled');
    }
  }
  setRefreshing(value) {
    this.refreshing = value;
    for (const entry of this.entries.values()) this.lock(entry);
  }
  models(entry, preserveScroll = false) {
    const { get, state, provider } = entry;
    const search = get('search').value.toLowerCase();
    const lab = get('lab').value;
    const scrollTop = preserveScroll ? get('model').scrollTop : 0;
    const models = (state.models || []).filter(m => (!lab || m.id.split('/')[0] === lab)
      && (!get('free').checked || m.free === true) && `${m.id} ${m.name}`.toLowerCase().includes(search));
    get('model').replaceChildren(...models.map(m => {
      const option = document.createElement('option'); option.value = m.id; option.textContent = m.name === m.id ? m.id : `${m.name} (${m.id})`; option.selected = m.id === state.model; return option;
    }));
    get('model').scrollTop = scrollTop;
    const selected = state.models?.find(m => m.id === state.model);
    get('selected').textContent = selected ? `Selected: ${selected.id}` : '';
    get('selected').title = selected?.id || '';
    get('compatibility').textContent = state.tested ? 'Function tools and replay passed. Streaming and a full Codex session still need verification.'
      : state.needsTest ? 'No models endpoint. Documented fallback models; test one to validate the key.' : selected?.compatibility || '';
    if (provider.id === 'openrouter' && !state.tested) get('compatibility').textContent = 'Text/tool-capable models only. Function tools are used; custom tools are disabled. Test the selected model to check Responses and reasoning replay.';
  }
  renderBalance(entry) {
    const { get, state, provider } = entry;
    const threshold = this.alerts[provider.id]?.threshold ?? 0;
    const level = window.BalanceAlerts.level(state.balance, threshold);
    for (const [name, target] of [['balance-low', 'low'], ['balance-zero', 'zero']]) {
      get('amount').classList.toggle(name, level === target);
      get('windows').classList.toggle(name, level === target);
    }
    const metric = window.BalanceAlerts.metric(state.balance);
    get('alert-description').textContent = metric
      ? `Notify on downward crossings below this ${metric.unit === '%' ? 'remaining quota (%)' : metric.unit + ' balance'}. Set 0 to disable all alerts.`
      : 'Alerts need a reported balance or remaining quota. No reliable reading is available. Set 0 to disable all alerts.';
    get('threshold').setAttribute('aria-label', `Balance alert threshold${metric ? ` (${metric.unit})` : ''}`);
  }
  clearFeedback(entry) {
    clearTimeout(entry.feedbackTimer);
    for (const role of ['feedback', 'feedback-catalog', 'feedback-test']) {
      entry.get(role).hidden = true;
      entry.get(role).textContent = '';
    }
  }
  update(id, state) {
    const entry = this.entries.get(id); if (!entry) { this.buffer.set(id, state); return; }
    const { get, provider } = entry;
    entry.state = state;
    if (!state.hasKey) this.clearFeedback(entry);
    if (state.hasKey && typeof state.feedback?.ok === 'boolean' && state.feedback.stamp && state.feedback.stamp !== entry.feedbackStamp) {
      entry.feedbackStamp = state.feedback.stamp;
      this.clearFeedback(entry);
      const feedbackRole = state.feedback.operation === 'test' ? 'feedback-test'
        : state.feedback.origin === 'refresh-models' ? 'feedback-catalog' : 'feedback';
      const feedback = get(feedbackRole);
      feedback.textContent = state.feedback.ok ? 'Success' : 'Failed';
      feedback.className = 'action-feedback ' + (state.feedback.ok ? 'success' : 'error');
      feedback.hidden = false;
      entry.feedbackTimer = setTimeout(() => {
        feedback.hidden = true;
        feedback.textContent = '';
      }, 5000);
    }
    get('status').textContent = state.loading ? 'Loading...' : state.valid ? 'Configured' : 'Not configured';
    get('dot').className = 'status-dot ' + (state.loading ? 'loading' : state.valid ? 'configured' : 'not-configured');
    get('error').textContent = state.error || state.balanceError || '';
    get('catalog').hidden = !state.hasKey || !state.models?.length || !(state.valid || state.needsTest);
    get('balance').hidden = !state.valid || !Number.isFinite(state.balance?.total);
    get('windows').hidden = !state.valid || !state.balance?.windows?.length;
    get('windows').replaceChildren(...(state.balance?.windows || []).map(value => {
      const row = document.createElement('div'); row.className = 'usage-window';
      const label = document.createElement('p'); label.textContent = `${value.label}: ${value.remaining.toFixed(1)}%`;
      const bar = document.createElement('progress'); bar.max = Math.max(100, value.remaining); bar.value = value.remaining; bar.setAttribute('aria-label', value.label);
      row.append(label, bar);
      if (value.resetsAt) { const reset = document.createElement('p'); reset.className = 'usage-note'; reset.textContent = `Resets ${new Intl.DateTimeFormat(undefined, {dateStyle:'short',timeStyle:'medium'}).format(new Date(value.resetsAt * 1000))}`; row.append(reset); }
      return row;
    }));
    get('amount').textContent = Number.isFinite(state.balance?.total) && ['USD', 'CNY'].includes(state.balance.currency) ? new Intl.NumberFormat('en-US', { style: 'currency', currency: state.balance.currency, currencyDisplay: 'code' }).format(state.balance.total) : '';
    this.renderBalance(entry);
    const disabled = state.loading || state.working;
    for (const role of ['key', 'refresh', 'refresh-models', 'endpoint', 'model', 'test']) get(role).disabled = Boolean(disabled);
    get('refresh').disabled = Boolean(disabled || !state.hasKey);
    get('endpoint').hidden = !state.valid;
    const current = entry.active && state.model === this.appliedModel;
    get('apply').disabled = Boolean(disabled || !state.valid || !state.model || current);
    get('apply').textContent = current ? 'Current Setting' : `Switch to ${provider.name}`;
    get('apply').classList.toggle('current-setting', current);
    get('alerts').hidden = !state.valid;
    if (provider.modelFilters?.laboratory) {
      const previous = get('lab').value;
      get('lab').hidden = false;
      get('lab').replaceChildren(...['', ...new Set((state.models || []).map(m => m.id.split('/')[0]))].sort().map(lab => {
        const option = document.createElement('option'); option.value = lab; option.textContent = lab || 'All laboratories'; option.selected = lab === previous; return option;
      }));
    }
    this.models(entry, true);
  }
  alert(value) {
    if (!value) return;
    this.alerts = value;
    for (const [id, entry] of this.entries) {
      if (document.activeElement !== entry.get('threshold')) entry.get('threshold').value = String(value[id]?.threshold ?? 0);
      this.renderBalance(entry);
    }
  }
  closePanels() {
    for (const entry of this.entries.values()) {
      entry.get('alert-panel').hidden = true;
      entry.get('alert-toggle').setAttribute('aria-expanded', 'false');
    }
  }
  active(provider, model) {
    if (this.activeProvider === provider && this.appliedModel === model) return;
    this.activeProvider = provider;
    this.appliedModel = model;
    for (const [id, entry] of this.entries) { entry.active = id === provider; entry.card.classList.toggle('current-provider', entry.active); this.update(id, entry.state); }
  }
};
