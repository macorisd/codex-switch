'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { parseHTML } = require('linkedom');
const definitions = require('../backend/providers.json');
const root = path.dirname(__dirname);
const providers = [{id:'openai',name:'ChatGPT',subtitle:'Your Plan'}, ...definitions.map(p=>({...p,iconUri:`local/${p.icon}`}))];
const layout = visible => providers.map(p=>({id:p.id,visible:visible.includes(p.id)}));
function harness({provider='openai',visible=['openai','deepseek'],chatgpt={loading:true}}={}) {
  const {window,document}=parseHTML(fs.readFileSync(path.join(root,'media/index.html'),'utf8'));
  const messages=[],timers=[];
  const sandbox={window,document,acquireVsCodeApi:()=>({postMessage:m=>messages.push(m)}),setInterval:()=>1,clearInterval(){},setTimeout:(fn,delay)=>{timers.push({fn,delay});return timers.length;},clearTimeout(){}};
  const context=vm.createContext(sandbox);
  for(const file of ['balance-alerts.js','api-view.js','view.js']) vm.runInContext(fs.readFileSync(path.join(root,'media',file),'utf8'),context);
  const receive=data=>{const event=new window.Event('message');event.data=data;window.dispatchEvent(event);};
  receive({type:'state',busy:false,state:{provider,model:'test-model',effort:'high',providers,providerLayout:layout(visible),providerLayoutRevision:0,chatgpt,balanceAlerts:{}}});
  return {window,document,messages,timers,receive,$:id=>document.getElementById(id),card:id=>document.querySelector(`article[data-provider="${id}"]`),api:(id,state)=>receive({type:'apiState',provider:id,state})};
}
const configured={loading:false,hasKey:true,valid:true,model:'test-model',effort:'high',models:[{id:'test-model',name:'Test model',efforts:['low','high']}],balance:{total:8,currency:'USD'}};
const field=(card,role)=>card.querySelector(`[data-role="${role}"]`);

test('real HTML and shared card template apply filtering before revealing providers',()=>{
  const h=harness({visible:['openai','openrouter','mimo']});
  assert.equal(h.$('provider-list').hidden,false);
  assert.deepEqual([...h.$('provider-list').children].map(c=>c.dataset.provider),['openai','openrouter','mimo']);
  assert.equal(h.document.querySelectorAll('.provider-card').length,3);
  assert.equal(h.messages[0].action,'ready');
  for(const id of ['openrouter','mimo']) {
    assert(field(h.card(id),'catalog').hidden);
    assert.equal(field(h.card(id),'status').textContent,'Loading...');
    assert(field(h.card(id),'key').disabled);
    assert(h.card(id).querySelector('.provider-icon img').src.startsWith('local/'));
  }
});

test('all nine API cards share configuration, errors and model controls without reasoning',()=>{
  const h=harness({visible:providers.map(p=>p.id)});
  for(const p of definitions){
    const card=h.card(p.id); h.api(p.id,configured);
    assert.equal(field(card,'status').textContent,'Configured'); assert(!field(card,'catalog').hidden);
    assert(!field(card,'catalog').hasAttribute('open'));
    assert.equal(field(card,'model').children.length,1); assert.equal(field(card,'effort'),null);
    field(card,'key').click(); assert.equal(h.messages.at(-1).provider,p.id);
    h.api(p.id,{...configured,valid:false,error:'Invalid key'});
    assert.equal(field(card,'status').textContent,'Not configured'); assert(!field(card,'key').disabled);
    assert(field(card,'apply').disabled);
  }
});

test('API feedback stays hidden until a completed action and disappears fully after expiry', () => {
  const h = harness({ visible: providers.map(provider => provider.id) });
  for (const provider of definitions) {
    const feedback = field(h.card(provider.id), 'feedback');
    assert.equal(feedback.hidden, true, provider.id);
    h.api(provider.id, configured);
    assert.equal(feedback.hidden, true, `${provider.id} configured`);

    h.api(provider.id, { ...configured, feedback: { stamp: 1, ok: null } });
    assert.equal(feedback.hidden, true, `${provider.id} pending`);
    h.api(provider.id, { ...configured, feedback: { stamp: 2 } });
    assert.equal(feedback.hidden, true, `${provider.id} incomplete`);

    for (const [stamp, ok] of [[3, true], [4, false]]) {
      const state = { ...configured, feedback: { stamp, ok } };
      h.api(provider.id, state);
      assert.equal(feedback.hidden, false);
      assert.equal(feedback.textContent, ok ? 'Success' : 'Failed');
      assert.equal(h.timers.at(-1).delay, 5000);
      h.timers.at(-1).fn();
      assert.equal(feedback.hidden, true);
      assert.equal(feedback.textContent, '');
      h.api(provider.id, state);
      assert.equal(feedback.hidden, true, `${provider.id} repeated result`);
    }
  }
});

test('each action keeps its own feedback slot and provider headers contain only identity', () => {
  const h = harness({ visible: providers.map(provider => provider.id) });
  for (const provider of definitions) {
    const card = h.card(provider.id);
    assert.equal(card.querySelector('header button'), null);
    for (const [operation, origin, buttonRole, feedbackRole] of [
      ['refresh', 'refresh', 'refresh', 'feedback'],
      ['refresh', 'refresh-models', 'refresh-models', 'feedback-catalog'],
      ['test', undefined, 'test', 'feedback-test'],
    ]) {
      const slot = field(card, feedbackRole);
      const row = slot.parentElement;
      assert(row.classList.contains('action-row'));
      assert.equal(field(card, buttonRole).closest('.action-row'), row);
      h.api(provider.id, { ...configured, feedback: { operation, origin, ok: true, stamp: h.timers.length + 1 } });
      assert.equal(slot.parentElement, row);
      assert.equal(slot.hidden, false);
      h.timers.at(-1).fn();
      assert.equal(slot.parentElement, row);
      assert.equal(slot.hidden, true);
    }
  }
});

test('endpoint actions follow connection checks and are absent until each API provider is configured', () => {
  const h=harness({visible:providers.map(p=>p.id)});
  for (const {id} of definitions) {
    const card=h.card(id), endpoint=field(card,'endpoint');
    const controls=card.querySelector('.connection-controls');
    assert.equal(field(card,'refresh').parentElement,controls);
    assert.equal(endpoint.parentElement,controls);
    assert.equal(controls.children[0],field(card,'refresh'));
    assert.equal(controls.children[1],endpoint);
    assert(endpoint.hidden,`${id} initial`);
    h.api(id,{...configured,valid:false}); assert(endpoint.hidden,`${id} not configured`);
    h.api(id,configured); assert(!endpoint.hidden,`${id} configured`);
    endpoint.click(); assert.equal(h.messages.at(-1).operation,'endpoint');
    assert.equal(h.messages.at(-1).provider,id);
    h.api(id,{...configured,valid:false,error:'Invalid key'}); assert(endpoint.hidden,`${id} failed validation`);
  }
});

test('missing keys disable connection checks and account refreshes preserve model browsing', () => {
  const h = harness({ visible: ['openai', 'openrouter'] });
  const card = h.card('openrouter');
  h.api('openrouter', { hasKey: false, valid: false, loading: false, models: [] });
  assert.equal(field(card, 'refresh').disabled, true);
  assert.equal(field(card, 'key').disabled, false);
  h.api('openrouter', { hasKey: false, valid: false, loading: false, models: [], feedback: { ok: true, stamp: 1 } });
  assert.equal(field(card, 'feedback').hidden, true);
  h.api('openrouter', configured);
  const model = field(card, 'model');
  model.scrollTop = 100;
  const option = model.firstChild;
  let listReplacements = 0;
  const replaceProviders = h.$('provider-list').replaceChildren.bind(h.$('provider-list'));
  h.$('provider-list').replaceChildren = (...nodes) => { listReplacements++; replaceProviders(...nodes); };
  h.receive({ type: 'chatgpt', account: { configured: true, loading: false, plan: 'Plus' } });
  assert.equal(model.firstChild, option);
  assert.equal(model.scrollTop, 100);
  h.receive({ type: 'chatgpt', account: { configured: true, loading: false, plan: 'Plus', bankedResets: 2 } });
  const stableChoice = h.$('manage-list').querySelector('input');
  h.receive({ type: 'chatgpt', account: { configured: true, loading: false, plan: 'Plus', bankedResets: 3 } });
  assert.equal(h.$('manage-list').querySelector('input'), stableChoice);
  assert.equal(listReplacements, 0);
  h.api('openrouter', { ...configured, balance: { total: 3, currency: 'USD' } });
  assert.equal(model.scrollTop, 100);
});

test('OpenRouter search/lab filters retain one card and render upstream names as text',()=>{
  const h=harness({visible:['openai','openrouter']});
  const card=h.card('openrouter');
  h.api('openrouter',{...configured,model:'anthropic/claude',models:[{id:'anthropic/claude',name:'Claude',efforts:['high']},{id:'google/gemini',name:'Gemini',efforts:[]},{id:'openai/gpt',name:'<img src=x onerror=attack()>',efforts:[]}]});
  assert.equal(field(card,'model').children.length,3); assert.equal(card.querySelectorAll('img').length,1);
  assert.equal(field(card,'lab').children.length,4);
  field(card,'search').value='gem'; field(card,'search').dispatchEvent(new h.window.Event('input'));
  assert.equal(field(card,'model').children.length,1); assert.equal(field(card,'model').firstChild.value,'google/gemini');
  field(card,'search').value='';
  [...field(card,'lab').children].find(o=>o.value==='anthropic').selected=true;
  field(card,'lab').dispatchEvent(new h.window.Event('change'));
  assert.equal(field(card,'model').firstChild.value,'anthropic/claude');
  field(card,'test').click(); assert.equal(h.messages.at(-1).operation,'test');
  assert.match(field(card,'test').closest('.model-test').textContent,/credits/);
});

test('selection sends only the model; native reasoning does not change the active card',()=>{
  const h=harness({provider:'openrouter',visible:['openai','openrouter']});
  h.api('openrouter',configured); const card=h.card('openrouter');
  assert.equal(field(card,'apply').textContent,'Current Setting'); assert(field(card,'apply').disabled);
  field(card,'model').dispatchEvent(new h.window.Event('change'));
  assert.equal(h.messages.at(-1).operation,'select'); assert.equal(h.messages.at(-1).model,'test-model');
  h.api('openrouter',{...configured,model:'other',models:[{id:'other',name:'Other',efforts:[]}]});
  assert(!field(card,'apply').disabled); assert.equal(field(card,'effort'),null);
  assert.equal(h.messages.at(-1).effort,undefined);
});

test('aggregators combine free, laboratory and search filters without changing selection', () => {
  const h = harness({visible:['openai','openrouter','deepseek']});
  const card = h.card('openrouter');
  const models = [
    {id:'lab/paid',name:'Paid',free:false},
    {id:'lab/model:free',name:'Model (free)',free:true},
    {id:'other/zero',name:'Zero price',free:true},
    {id:'other/unknown',name:'Unknown price',free:false},
  ];
  h.api('openrouter', {...configured,model:'lab/paid',models});
  assert(card.classList.contains('provider-aggregator'));
  assert(!h.card('deepseek').classList.contains('provider-aggregator'));
  assert(!field(card,'free-filter').hidden);
  field(card,'free').checked = true;
  field(card,'free').dispatchEvent(new h.window.Event('change'));
  assert.equal(field(card,'model').children.length,2);
  [...field(card,'lab').children].find(o=>o.value==='lab').selected=true;
  field(card,'lab').dispatchEvent(new h.window.Event('change'));
  assert.equal(field(card,'model').children.length,1);
  assert.equal(field(card,'model').firstChild.value,'lab/model:free');
  assert.match(field(card,'selected').textContent,/lab\/paid/);
  field(card,'search').value='missing'; field(card,'search').dispatchEvent(new h.window.Event('input'));
  assert.equal(field(card,'model').children.length,0);
  assert(!h.messages.some(m=>m.operation==='select'), 'filters never select or switch implicitly');
  const css=fs.readFileSync(path.join(root,'media/style.css'),'utf8');
  assert.match(css.slice(css.indexOf('@media (min-width: 550px)')), /\.provider-aggregator\s*\{ grid-column: 1 \/ -1;/);
  assert.match(css.slice(css.indexOf('@media (min-width: 550px)')), /\.provider-list\s*\{ grid-auto-flow: row dense;/);
  h.receive({type:'providerLayout',revision:1,layout:[{id:'openai',visible:true},{id:'openrouter',visible:true},{id:'deepseek',visible:true},...definitions.filter(p=>!['openrouter','deepseek'].includes(p.id)).map(p=>({id:p.id,visible:false}))]});
  assert.deepEqual([...h.$('provider-list').children].map(c=>c.dataset.provider),['openai','openrouter','deepseek'], 'narrow layout retains the managed order; wide CSS fills gaps');
});

test('all API cards clamp thresholds on blur and update colors independently without extra requests', () => {
  const h = harness({visible:providers.map(p=>p.id)});
  for (const {id} of definitions) {
    const card = h.card(id);
    h.api(id, {...configured,balance:{total:0,currency:'USD'}});
    assert(!field(card,'alerts').hidden);
    assert.equal(field(card,'threshold').value,'0');
    assert(!field(card,'amount').classList.contains('balance-zero'));
    field(card,'threshold').value='5'; field(card,'threshold').dispatchEvent(new h.window.Event('blur'));
    assert.equal(h.messages.at(-1).provider,id);
    assert.equal(h.messages.at(-1).threshold,5);
    assert(field(card,'amount').classList.contains('balance-zero'));
    h.api(id, {...configured,balance:{total:2,currency:'CNY'}});
    assert(field(card,'amount').classList.contains('balance-low'));
    assert(!field(card,'amount').classList.contains('balance-zero'));
    assert.match(field(card,'alert-description').textContent,/CNY/);
    assert.doesNotMatch(field(card,'alert-description').textContent,/Initial readings are silent/);
    field(card,'threshold').value='-3'; field(card,'threshold').dispatchEvent(new h.window.Event('blur'));
    assert.equal(field(card,'threshold').value,'0');
    assert.equal(h.messages.at(-1).threshold,0);
    assert(!field(card,'amount').classList.contains('balance-low'));
    h.api(id, {...configured,balance:null});
    assert(field(card,'balance').hidden);
    assert.match(field(card,'alert-description').textContent,/No reliable reading/);
  }
  const card=h.card('minimax');
  h.api('minimax', {...configured,balance:{windows:[{label:'Weekly',remaining:2}]}});
  field(card,'threshold').value='4'; field(card,'threshold').dispatchEvent(new h.window.Event('blur'));
  assert(field(card,'windows').classList.contains('balance-low'));
  assert.match(field(card,'alert-description').textContent,/%/);
  h.receive({type:'balanceAlerts',balanceAlerts:{minimax:{threshold:0},openrouter:{threshold:3}}});
  h.receive({type:'chatgpt',account:{loading:false,configured:true}});
  assert(!field(card,'windows').classList.contains('balance-low'));
  assert.equal(field(h.card('openrouter'),'threshold').value,'3');
});

test('provider manager reliably hides, reenables and reorders without hiding the active provider',()=>{
  const h=harness(); h.$('manage-providers').click(); assert(!h.$('manage-panel').hidden);
  const checks=()=>[...h.$('manage-list').querySelectorAll('input')];
  assert(checks()[0].disabled);
  checks()[1].checked=false; checks()[1].dispatchEvent(new h.window.Event('change'));
  assert.deepEqual([...h.$('provider-list').children].map(c=>c.dataset.provider),['openai']);
  checks()[1].checked=true; checks()[1].dispatchEvent(new h.window.Event('change'));
  assert.deepEqual([...h.$('provider-list').children].map(c=>c.dataset.provider),['openai','deepseek']);
  h.$('close-manage').click(); assert(h.$('manage-panel').hidden);
});

test('provider manager edits the current layout after unchanged host acknowledgements', () => {
  const h=harness({visible:providers.map(p=>p.id)});
  const choice=id=>h.$('manage-list').querySelector(`[data-provider="${id}"] input`);
  const initialChoice=choice('deepseek');
  h.receive({type:'providerLayout',revision:0,layout:layout(providers.map(p=>p.id))});
  assert.equal(choice('deepseek'),initialChoice, 'unchanged manager retains controls');
  for (const {id} of definitions) {
    choice(id).checked=false;
    choice(id).dispatchEvent(new h.window.Event('change'));
    const sent=h.messages.at(-1);
    assert.equal(sent.action,'saveProviderLayout');
    assert.equal(sent.layout.find(p=>p.id===id).visible,false,id);
    assert(![...h.$('provider-list').children].some(c=>c.dataset.provider===id),id);
    h.receive({type:'providerLayout',revision:sent.revision,layout:JSON.parse(JSON.stringify(sent.layout))});
    // Another host snapshot may have identical values but new layout objects.
    h.receive({type:'providerLayout',revision:sent.revision,layout:JSON.parse(JSON.stringify(sent.layout))});
  }
  assert.deepEqual([...h.$('provider-list').children].map(c=>c.dataset.provider),['openai']);
  choice('openrouter').checked=true; choice('openrouter').dispatchEvent(new h.window.Event('change'));
  assert.deepEqual([...h.$('provider-list').children].map(c=>c.dataset.provider),['openai','openrouter']);
});

test('balance currency, alert preferences and five-second feedback remain consistent',()=>{
  const h=harness(); const card=h.card('deepseek');
  h.api('deepseek',{...configured,balance:{total:2,currency:'USD'},feedback:{stamp:1,ok:true}});
  assert.match(field(card,'amount').textContent,/USD/); assert(!field(card,'amount').classList.contains('balance-low'));
  h.receive({type:'balanceAlerts',balanceAlerts:{deepseek:{threshold:5}}});
  assert(field(card,'amount').classList.contains('balance-low'));
  assert.equal(field(card,'feedback').textContent,'Success'); assert.equal(h.timers.at(-1).delay,5000);
  h.timers.at(-1).fn(); assert.equal(field(card,'feedback').textContent,'');
  field(card,'alert-toggle').click(); assert(!field(card,'alert-panel').hidden);
  assert.equal(field(card,'alert-toggle').getAttribute('aria-expanded'),'true');
  const escape = new h.window.Event('keydown'); escape.key = 'Escape'; h.document.dispatchEvent(escape);
  assert(field(card,'alert-panel').hidden);
  assert.equal(field(card,'alert-toggle').getAttribute('aria-expanded'),'false');
  field(card,'alert-toggle').click();
  field(card,'threshold').value='2'; field(card,'threshold').dispatchEvent(new h.window.Event('change'));
  assert.equal(h.messages.at(-1).threshold,2);
  h.receive({type:'balanceAlerts',balanceAlerts:{deepseek:{threshold:3}}}); assert.equal(field(card,'threshold').value,'3');
  field(card,'alert-close').click(); assert(field(card,'alert-panel').hidden);
  h.api('deepseek',{...configured,balance:null,balanceError:'Balance unavailable.'}); assert(field(card,'balance').hidden);
});

test('ChatGPT keeps plan/usage independent, omits timezone suffix and zero countdown units',()=>{
  const seconds=Math.floor(Date.now()/1000);
  const h=harness({provider:'deepseek',chatgpt:{configured:true,plan:'Pro',loading:false,fiveHour:{remaining:72,resetsAt:seconds+7260},weekly:{remaining:45,resetsAt:seconds+90060},bankedResets:3}});
  assert.equal(h.$('chatgpt-plan').textContent,'Your Pro Plan');
  assert.equal(h.$('five-hour-value').textContent,'72%'); assert.equal(h.$('banked-resets').textContent,'3');
  assert.doesNotMatch(h.$('weekly-reset').textContent,/GMT|UTC/);
  assert.match(h.$('weekly-countdown').textContent,/Resets in 1d 1h/);
  h.receive({type:'chatgpt',account:{configured:true,plan:'Business',loading:false,fiveHour:{remaining:0,resetsAt:seconds+25},weekly:{remaining:100,resetsAt:seconds+3600}}});
  assert.equal(h.$('five-hour-value').textContent,'0%'); assert.match(h.$('five-hour-countdown').textContent,/Blink/);
  assert.doesNotMatch(h.$('weekly-countdown').textContent,/0d|0h|0m/);
  assert.equal(h.$('banked-resets').textContent,'Unavailable');
  assert(h.$('manage-list').textContent.includes('Your Business Plan'));
  h.receive({type:'chatgpt',account:{loading:false,stale:true}}); assert.equal(h.$('chatgpt-status').textContent,'Unavailable');
});

test('global sync is deduplicated and re-enabled after errors',()=>{
  const h=harness(); h.$('sync-all').click(); h.$('sync-all').click();
  assert.equal(h.messages.filter(m=>m.action==='syncAll').length,1);
  h.receive({type:'syncLoading',loading:false}); assert(!h.$('sync-all').disabled);
});

test('responsive styles retain 550px columns, equal row heights and narrow natural heights',()=>{
  const css=fs.readFileSync(path.join(root,'media/style.css'),'utf8');
  assert.match(css,/@media \(min-width: 550px\)/);
  const wide=css.slice(css.indexOf('@media (min-width: 550px)'));
  assert.match(wide,/grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(wide,/align-items: stretch/); assert.match(wide,/flex: 1 0 0/);
  assert.match(wide,/\.provider-card > \.primary.*order: 2/s);
  assert.match(css,/\[hidden\] \{ display: none !important/);
});
