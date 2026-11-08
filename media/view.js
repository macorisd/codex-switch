'use strict';
(() => {
  const vscode = acquireVsCodeApi();
  const $ = id => document.getElementById(id);
  let state;
  let busy = false;
  let pendingAction = null;
  let successAction = null;
  let successTimer;
  const defaultButtonText = {
    refresh: 'Update model catalog',
    verify: 'Check connection',
  };
  const busyButtonText = {
    refresh: 'Updating...',
    verify: 'Checking...',
  };
  const send = message => vscode.postMessage(message);
  const isActive = provider => state?.provider === provider;
  const pendingKey = () => $('key').value.trim();
  const canUseDeepSeek = () => Boolean(state?.hasKey || pendingKey());

  function withKey(message) {
    const key = pendingKey();
    return key ? { ...message, key } : message;
  }

  function actionButton(id, text, disabled) {
    const button = $(id);
    button.textContent = text;
    button.disabled = disabled;
    button.classList.toggle('current-setting', disabled && text === 'Current Setting');
  }

  function render() {
    if (!state) return;
    $('current').textContent = isActive('deepseek') ? 'DeepSeek' : 'ChatGPT';

    actionButton('openai', isActive('openai') ? 'Current Setting' : 'Switch to ChatGPT', busy || isActive('openai'));
    actionButton(
      'deepseek-switch',
      isActive('deepseek') ? 'Current Setting' : 'Switch to DeepSeek',
      busy || isActive('deepseek') || !canUseDeepSeek(),
    );

    $('models').replaceChildren(...state.models.map(model => {
      const item = document.createElement('li');
      item.textContent = model.name;
      return item;
    }));
    $('key').disabled = busy;
    $('refresh').textContent = pendingAction === 'refresh' && busy
      ? busyButtonText.refresh
      : successAction === 'refresh' ? 'Updated' : defaultButtonText.refresh;
    $('refresh').disabled = busy;
    $('verify').textContent = pendingAction === 'verify' && busy
      ? busyButtonText.verify
      : successAction === 'verify' ? 'Connected' : defaultButtonText.verify;
    $('verify').disabled = busy || !canUseDeepSeek();
  }

  function completeAction(action) {
    clearTimeout(successTimer);
    successAction = action;
    render();
    successTimer = setTimeout(() => {
      successAction = null;
      render();
    }, 1200);
  }

  $('key').addEventListener('input', render);
  $('key').addEventListener('keydown', event => {
    if (event.key !== 'Enter' || !pendingKey()) return;
    event.preventDefault();
    send(withKey({ action: 'saveKey' }));
  });
  $('openai').addEventListener('click', () => send({ action: 'apply', provider: 'openai' }));
  $('deepseek-switch').addEventListener('click', () => send(withKey({ action: 'apply', provider: 'deepseek' })));
  $('refresh').addEventListener('click', () => {
    successAction = null;
    pendingAction = 'refresh';
    send({ action: 'refresh' });
  });
  $('verify').addEventListener('click', () => {
    successAction = null;
    pendingAction = 'verify';
    send(withKey({ action: 'verify' }));
  });

  window.addEventListener('message', ({ data }) => {
    if (data.type === 'state') {
      state = data.state;
      busy = data.busy;
      render();
    } else if (data.type === 'busy') {
      busy = data.busy;
      if (!busy) pendingAction = null;
      render();
    } else if (data.type === 'keySaved') {
      $('key').value = '';
      render();
    } else if (data.type === 'actionSuccess') {
      pendingAction = null;
      completeAction(data.action);
    }
  });

  send({ action: 'ready' });
})();
