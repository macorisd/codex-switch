'use strict';
(() => {
  const vscode = acquireVsCodeApi();
  const $ = id => document.getElementById(id);
  const saved = vscode.getState() || {};
  let state;
  let provider = saved.provider;
  let model = saved.model;
  let effort = saved.effort || 'high';
  let busy = false;
  const labels = { low: 'Rápido', medium: 'Medio', high: 'Alto', xhigh: 'Muy alto', max: 'Máximo', ultra: 'Ultra' };
  const send = message => vscode.postMessage(message);
  function persist() { vscode.setState({ provider, model, effort }); }
  function notice(value) {
    $('notice').hidden = !value;
    $('notice-text').textContent = value?.text || '';
    $('notice').classList.toggle('error', value?.kind === 'error');
    $('reload').hidden = !value?.reload;
  }
  function render() {
    if (!state) return;
    if (!provider) provider = state.provider === 'deepseek' ? 'deepseek' : 'openai';
    if (!state.models.some(m => m.id === model)) model = state.models.find(m => m.id === state.model)?.id || state.models[0]?.id;
    $('current').textContent = state.provider === 'deepseek' ? state.models.find(m => m.id === state.model)?.name || state.model : state.provider === 'openai' ? 'ChatGPT · ' + state.model : state.provider + ' · ' + state.model;
    for (const id of ['openai', 'deepseek']) {
      $(id).classList.toggle('selected', provider === id);
      $(id).setAttribute('aria-pressed', String(provider === id));
    }
    $('deepseek-options').hidden = provider !== 'deepseek';
    $('chatgpt-options').hidden = provider !== 'openai';
    $('model').replaceChildren(...state.models.map(m => new Option(m.name, m.id)));
    $('model').value = model || '';
    const metadata = state.models.find(m => m.id === model);
    $('model-info').textContent = metadata?.image ? 'Texto e imágenes' : 'Solo texto';
    const supported = metadata?.efforts || [];
    if (!supported.includes(effort)) effort = supported.includes('high') ? 'high' : supported[0];
    $('efforts').replaceChildren(...supported.map(level => {
      const button = document.createElement('button');
      button.textContent = labels[level] || level;
      button.classList.toggle('selected', effort === level);
      button.setAttribute('aria-pressed', String(effort === level));
      button.addEventListener('click', () => { effort = level; render(); });
      return button;
    }));
    $('key-status').textContent = state.hasKey ? 'Clave cifrada guardada' : 'Falta tu API key';
    $('key').textContent = state.hasKey ? 'Cambiar' : 'Añadir';
    const unchanged = state.provider === provider && (provider === 'openai' || state.model === model && state.effort === effort);
    document.querySelectorAll('button, select').forEach(element => { element.disabled = busy; });
    $('verify').disabled = busy || !state.hasKey;
    $('apply').disabled = busy || unchanged || provider === 'deepseek' && (!state.hasKey || !model);
    $('apply').textContent = busy ? 'Un momento…' : unchanged ? 'Configuración actual' : provider === 'deepseek' ? 'Usar DeepSeek' : 'Volver a ChatGPT Plus';
    persist();
  }
  ['openai', 'deepseek'].forEach(id => $(id).addEventListener('click', () => { provider = id; render(); }));
  $('model').addEventListener('change', event => { model = event.target.value; render(); });
  $('key').addEventListener('click', () => send({ action: 'saveKey' }));
  $('verify').addEventListener('click', () => send({ action: 'verify' }));
  $('refresh').addEventListener('click', () => send({ action: 'refresh' }));
  $('reload').addEventListener('click', () => send({ action: 'reload' }));
  $('apply').addEventListener('click', () => send({ action: 'apply', provider, model, effort }));
  window.addEventListener('message', ({ data }) => {
    if (data.type === 'state') { state = data.state; busy = data.busy; notice(data.notice); render(); }
    else if (data.type === 'busy') { busy = data.busy; render(); }
    else if (data.type === 'notice') notice(data.notice);
  });
  send({ action: 'ready' });
})();
