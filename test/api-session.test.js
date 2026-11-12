'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {ApiSessions}=require('../api-session');
const definitions=require('../backend/providers.json');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function harness(request, extras={}){
 const calls=[],messages=[],visible=new Set(['openrouter']),inputs=[];
 const timers={setInterval:()=>1,clearInterval(){}};
 const api=new ApiSessions({definitions,request:async(m,signal)=>{calls.push(m);return request(m,signal);},visible:id=>visible.has(id),post:m=>messages.push(JSON.parse(JSON.stringify(m))),input:async o=>{inputs.push(o);return 'test-key';},apply:async work=>work(),alerts:async()=>{},timers,...extras});
 return {api,calls,messages,visible,inputs};
}
const local={hasKey:true,valid:true,model:'lab/model',effort:'',models:[{id:'lab/model',efforts:[]}]};

test('shared sessions deduplicate requests without losing cleanup on failure',async()=>{
 let finish;
 const h=harness((m)=>m.operation==='status'?new Promise(resolve=>finish=resolve):Promise.resolve(local));
 const first=h.api.refresh('openrouter',true),second=h.api.refresh('openrouter',true);
 assert.equal(first,second); await tick(); finish(local); await first;
 assert.equal(h.calls.filter(c=>c.operation==='refresh').length,1); assert(!h.api.sessions.get('openrouter').working);
});

test('rapid hide and reenable aborts the old request and starts fresh validation',async()=>{
 let count=0;
 const h=harness((m,signal)=>{
  if(m.operation==='status' && ++count===1)return new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(new Error('cancelled'))));
  return Promise.resolve(m.operation==='balance'?null:local);
 });
 const old=h.api.refresh('openrouter',true); await tick();
 h.visible.clear(); h.api.reconcile(); h.visible.add('openrouter');
 const next=h.api.refresh('openrouter',true); await Promise.all([old,next]);
 assert.equal(count,2); assert(h.api.sessions.get('openrouter').valid);
 assert.equal(h.messages.at(-1).state.error,'');
});

test('hiding while the native key dialog is open prevents saving or validating the key',async()=>{
 let finish;
 const h=harness(()=>local,{input:()=>new Promise(resolve=>finish=resolve)});
 const pending=h.api.run({provider:'openrouter',operation:'saveKey'}); await tick();
 h.visible.clear();h.api.reconcile();finish('test-key');await pending;
 assert.equal(h.calls.length,0);
});

test('model test failure retains a validated credential and offers another model',async()=>{
 const h=harness(m=>{if(m.operation==='test')throw new Error('private provider response');return m.operation==='balance'?null:local;});
 await h.api.refresh('openrouter',true); await h.api.run({provider:'openrouter',operation:'test'});
 const state=h.api.sessions.get('openrouter');assert(state.valid);assert(!state.working);assert.match(state.error,/Operation failed/);
 assert(!JSON.stringify(h.messages).includes('private provider response'));
});

test('duplicate credential actions cannot open overlapping dialogs',async()=>{
 let finish;
 const h=harness(()=>local,{input:()=>new Promise(resolve=>finish=resolve)});
 const first=h.api.run({provider:'openrouter',operation:'saveKey'});
 await h.api.run({provider:'openrouter',operation:'saveKey'});await tick();
 finish(undefined);await first;assert.equal(h.calls.length,0);
});

test('a failed refresh cannot regain Configured from stale persisted status on the next poll',async()=>{
 const h=harness(m=>{if(m.operation==='refresh')throw new Error('revoked');return local;});
 await h.api.refresh('openrouter',true);assert.equal(h.api.sessions.get('openrouter').valid,false);
 await h.api.refresh('openrouter',false);assert.equal(h.api.sessions.get('openrouter').valid,false);
 assert.equal(h.calls.filter(c=>c.operation==='refresh').length,2);
});

test('a connection check without a saved key cannot produce successful feedback', async () => {
  const h = harness(() => ({ hasKey: false, valid: false, models: [] }));
  await h.api.refresh('openrouter', true);
  const before = h.calls.length;
  await h.api.run({ provider: 'openrouter', operation: 'refresh' });
  assert.equal(h.calls.length, before);
  assert.equal(h.api.sessions.get('openrouter').valid, false);
  assert.equal(h.api.sessions.get('openrouter').feedback, null);
});

test('regional and plan-specific key setup configures the endpoint before storing or validating credentials', async () => {
  for (const provider of definitions.filter(p=>p.endpointSetup)) {
    const inputs=[];
    const url=provider.baseUrl;
    const h=harness(m=>m.operation==='balance'?null:local, {
      input:async options=>{inputs.push(options);return options.password?'test-key':url;},
    });
    h.visible.add(provider.id);
    await h.api.run({provider:provider.id,operation:'endpoint'});
    assert.equal(inputs.length,0,'unconfigured standalone endpoint action is unavailable');
    await h.api.run({provider:provider.id,operation:'saveKey'});
    assert.equal(inputs.length,2,provider.id);
    assert.equal(inputs[1].value,provider.baseUrl);
    assert.equal(h.calls[0].operation,'endpoint'); assert.equal(h.calls[0].url,url);
    assert.equal(h.calls[1].operation,'saveKey'); assert.equal(h.calls[1].key,'test-key');
    assert(h.api.sessions.get(provider.id).valid);
    assert(!JSON.stringify(h.messages).includes('test-key'));
  }
});

test('cancelling or hiding during initial endpoint setup never saves a key or starts validation', async () => {
  for (const mode of ['cancel','hide','invalid']) {
    let h;
    h=harness(()=>{throw new Error('invalid endpoint');},{input:async options=>{
      if (options.password) return 'test-key';
      if (mode==='cancel') return undefined;
      if (mode==='hide') {h.visible.clear();h.api.reconcile();}
      return 'https://invalid.example/v1';
    }});
    h.visible.add('qwen');
    await h.api.run({provider:'qwen',operation:'saveKey'});
    assert(!h.calls.some(c=>['saveKey','refresh'].includes(c.operation)),mode);
    if (mode==='invalid') assert.match(h.api.sessions.get('qwen').error,/Operation failed/);
  }
});
