'use strict';
// Static template + textContent only: upstream model names never become markup.
window.ApiCards = class {
  constructor(send) { this.send = send; this.entries = new Map(); this.buffer = new Map(); }
  card(provider) {
    if (this.entries.has(provider.id)) return this.entries.get(provider.id).card;
    const card = document.createElement('article');
    card.className = 'provider-card'; card.dataset.provider = provider.id;
    card.innerHTML = `<header class="api-header"><div class="provider-identity"><span class="provider-icon api-icon"></span><div class="provider-title"><h3></h3><p>API key</p></div></div><button class="text-button connection-link" data-role="refresh">Check connection</button></header>
      <div class="credential-row"><div class="credential-status"><span class="status-dot loading" data-role="dot" aria-hidden="true"></span><span data-role="status">Loading...</span></div><button class="text-button" data-role="key">Set API key</button></div>
      <p class="api-error" data-role="error" role="status"></p>
      <details class="model-catalog" data-role="catalog" hidden><summary>Model catalog</summary><div class="model-catalog-content">
      <input type="search" data-role="search" aria-label="Search models" placeholder="Search models...">
      <select data-role="lab" aria-label="Filter laboratory" hidden></select>
      <select data-role="model" size="6" aria-label="Select model"></select>
      <p class="usage-note" data-role="selected"></p>
      <label class="api-effort">Reasoning <select data-role="effort" aria-label="Reasoning effort"></select></label>
      <p class="usage-note" data-role="compatibility"></p>
      <button class="text-button" data-role="refresh-models">Update model catalog</button></div></details>
      <div class="usage" data-role="balance" hidden><h4>Available balance</h4><strong class="api-balance" data-role="amount"></strong></div>
      <div class="chatgpt-usage" data-role="windows" hidden></div>
      <div data-role="alerts" hidden><button class="text-button" data-role="alert-toggle">Balance alert</button><div class="balance-alert-editor" data-role="alert-panel" hidden><button class="balance-alert-close" data-role="alert-close" aria-label="Close balance alert">&times;</button><p>Notify below this USD balance. Set 0 to disable low-balance alerts.</p><input type="number" min="0" step="0.01" data-role="threshold" aria-label="Balance alert threshold"></div></div>
      <button class="text-button" data-role="endpoint">API endpoint</button>
      <button class="primary" data-role="apply">Switch provider</button>`;
    card.querySelector('h3').textContent = provider.name;
    if (provider.id === 'deepseek') card.querySelector('.api-icon').classList.add('deepseek-icon');
    const image = document.createElement('img'); image.src = provider.iconUri; image.alt = ''; image.width = 24; image.height = 24;
    card.querySelector('.api-icon').append(image);
    const get = role => card.querySelector(`[data-role="${role}"]`);
    const entry = { provider, card, get, state: { loading: true, models: [] }, active: false };
    this.entries.set(provider.id, entry);
    const send = (operation, extra = {}) => this.send({ action: 'api', provider: provider.id, operation, ...extra });
    get('key').onclick = () => send('saveKey');
    for (const role of ['refresh', 'refresh-models']) get(role).onclick = () => send('refresh', { origin: role });
    get('endpoint').onclick = () => send('endpoint');
    get('apply').onclick = () => send('apply');
    get('search').oninput = () => this.models(entry);
    get('lab').onchange = () => this.models(entry);
    get('model').onchange = () => send('select', { model: get('model').value, effort: '' });
    get('effort').onchange = () => send('select', { model: entry.state.model, effort: get('effort').value });
    get('alerts').hidden = provider.id !== 'deepseek';
    get('alert-toggle').onclick = () => { get('alert-panel').hidden = !get('alert-panel').hidden; };
    get('alert-close').onclick = () => { get('alert-panel').hidden = true; };
    get('threshold').value = '5';
    get('threshold').onchange = () => this.send({ action: 'saveBalanceAlert', threshold: Number(get('threshold').value) });
    const feedback = document.createElement('span'); feedback.className = 'action-feedback'; feedback.dataset.role = 'feedback'; feedback.setAttribute('role', 'status');
    get('refresh').after(feedback);
    const test = document.createElement('button'); test.type = 'button'; test.className = 'text-button'; test.dataset.role = 'test';
    test.textContent = 'Test selected model (uses API credits)'; test.onclick = () => send('test');
    get('catalog').querySelector('.model-catalog-content').append(test);
    this.update(provider.id, this.buffer.get(provider.id) || entry.state);
    return card;
  }
  models(entry) {
    const { get, state, provider } = entry;
    const search = get('search').value.toLowerCase();
    const lab = get('lab').value;
    const models = (state.models || []).filter(m => (!lab || m.id.split('/')[0] === lab) && `${m.id} ${m.name}`.toLowerCase().includes(search));
    get('model').replaceChildren(...models.map(m => {
      const option = document.createElement('option'); option.value = m.id; option.textContent = m.name === m.id ? m.id : `${m.name} (${m.id})`; option.selected = m.id === state.model; return option;
    }));
    const selected = state.models?.find(m => m.id === state.model);
    get('selected').textContent = selected ? `Selected: ${selected.id}` : '';
    get('effort').replaceChildren(...['', ...(selected?.efforts || [])].map(value => {
      const option = document.createElement('option'); option.value = value; option.textContent = value || 'Provider default'; option.selected = value === state.effort; return option;
    }));
    get('compatibility').textContent = state.tested ? 'Function tools and replay passed. Streaming and a full Codex session still need verification.'
      : state.needsTest ? 'No models endpoint. Documented fallback models; test one to validate the key.' : selected?.compatibility || '';
    if (provider.id === 'openrouter' && !state.tested) get('compatibility').textContent = 'Text/tool-capable models only. Function tools are used; custom tools are disabled. Test the selected model to check Responses and reasoning replay.';
    get('effort').parentElement.hidden = !selected?.efforts.length;
  }
  update(id, state) {
    const entry = this.entries.get(id); if (!entry) { this.buffer.set(id, state); return; }
    const { get, provider } = entry;
    entry.state = state;
    if (state.feedback?.ok !== null && state.feedback?.stamp && state.feedback.stamp !== entry.feedbackStamp) {
      entry.feedbackStamp = state.feedback.stamp;
      clearTimeout(entry.feedbackTimer);
      get(state.feedback.operation === 'test' ? 'test' : state.feedback.origin || 'refresh').after(get('feedback'));
      get('feedback').textContent = state.feedback.ok ? 'Success' : 'Failed';
      get('feedback').className = 'action-feedback ' + (state.feedback.ok ? 'success' : 'error');
      entry.feedbackTimer = setTimeout(() => { get('feedback').textContent = ''; }, 5000);
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
    get('amount').classList.toggle('balance-low', id === 'deepseek' && state.balance?.total < (this.threshold ?? 5));
    get('amount').classList.toggle('balance-zero', state.balance?.total <= 0);
    const disabled = state.loading || state.working;
    for (const role of ['key', 'refresh', 'refresh-models', 'endpoint', 'model', 'effort', 'test']) get(role).disabled = Boolean(disabled);
    const current = entry.active && state.model === this.appliedModel && (!state.effort || state.effort === this.appliedEffort);
    get('apply').disabled = Boolean(disabled || !state.valid || !state.model || current);
    get('apply').textContent = current ? 'Current Setting' : `Switch to ${provider.name}`;
    get('apply').classList.toggle('current-setting', current);
    get('alerts').hidden = provider.id !== 'deepseek' || !state.valid;
    if (provider.id === 'openrouter') {
      const previous = get('lab').value;
      get('lab').hidden = false;
      get('lab').replaceChildren(...['', ...new Set((state.models || []).map(m => m.id.split('/')[0]))].sort().map(lab => {
        const option = document.createElement('option'); option.value = lab; option.textContent = lab || 'All laboratories'; option.selected = lab === previous; return option;
      }));
    }
    this.models(entry);
  }
  alert(value) {
    if (!value) return;
    this.threshold = value.threshold;
    const entry = this.entries.get('deepseek');
    if (entry && document.activeElement !== entry.get('threshold')) entry.get('threshold').value = String(value.threshold);
  }
  active(provider, model, effort) {
    this.appliedModel = model; this.appliedEffort = effort;
    for (const [id, entry] of this.entries) { entry.active = id === provider; entry.card.classList.toggle('current-provider', entry.active); this.update(id, entry.state); }
  }
};
