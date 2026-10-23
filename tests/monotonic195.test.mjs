// Pure controls execute extracted actual runner bodies. Fake clocks exist only here.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseStrict} from '../lib/json.mjs';
const here=path.dirname(fileURLToPath(import.meta.url));
const root=process.env.TIMING195_SOURCE??path.resolve(here,'..');
const run=fs.readFileSync(path.join(root,'runner/run.mjs'),'utf8');
const sg3=fs.readFileSync(path.join(root,'runner/tests-sg3.mjs'),'utf8');
const between=(s,a,b)=>{assert.equal(s.split(a).length,2);return s.slice(s.indexOf(a),s.indexOf(b,s.indexOf(a)));};
const compile=(source,names,values,expression)=>new Function(...names,source+'\nreturn '+expression)(...values);
function clock(){const c={wall:1700000000000,mono:0};c.Date=class extends Date{constructor(...args){super(...(args.length?args:[c.wall]));}static now(){return c.wall;}};c.performance={now:()=>c.mono};return c;}
async function duration(jump){
 const c=clock(),rows=[];const body=between(run,'async function runTests','// ---------------- SG-4');
 const fn=compile(body,['Date','performance','byId','ALL','TestFailure','results','log'],[c.Date,c.performance,{'PC-X-1':{traces:[]}}, {'PC-X-1':async()=>{c.wall+=jump;c.mono+=23.75;return {actual:true};}},Error,rows,()=>{}],'runTests');
 await fn({scenario:{id:'SC-1'},rep:1},['PC-X-1']);
 assert.equal(rows.length,1);assert.equal(rows[0].status,'pass');assert.equal(rows[0].elapsed_ms,23);
 assert.equal(rows[0].started_at,new Date(1700000000000).toISOString());
}
async function timeout(jump){
 const c=clock();let calls=0;
 const body=between(sg3,'async function waitFor','async function pauseHome');
 const fn=compile(body,['Date','performance','sleep'],[c.Date,c.performance,async ms=>{c.mono+=ms;}],'waitFor');
 const result=await fn(async()=>{if(++calls>10)throw Error('wall clock extended bounded wait');c.mono+=10;c.wall+=jump;return {done:false,calls};},{timeoutMs:50,stepMs:10});
 assert.equal(calls,3);assert.equal(result.calls,3);assert.equal(c.mono,60);
}
async function propagation(jump,delta=25){
 const c=clock();const body=between(sg3,'  async "PC-REV-2"','  async "PC-REV-3"');
 const method='const methods={'+body+'};';
 const payload={iat:1699999999,exp:1700000600,status:{uri:'http://fixture.invalid/status'}};
 const fn=compile(method,['Date','performance','admit','expectOk','act','proposal','http','local','waitFor','check','observe','expectProblem','expectNoSideEffects','expectRefusal'],[
  c.Date,c.performance,async()=>({token:'t',subject:{agent:{id:'a'}},payload}),r=>r,async()=>({}),()=>({}),async()=>({claim:'c'}),s=>s,
  async()=>{c.wall+=jump;c.mono+=delta;return {done:true};},(v,m)=>assert.ok(v,m),async()=>({}),()=>{},async()=>{},async()=>{}
 ],'methods["PC-REV-2"]');
 const out=await fn({events:{E1:{id:'1'},E2:{id:'2',global_id:'e2'}},host:{base:'http://host.invalid'},home:{base:'http://home.invalid'},creds:{provisioning:'p',operator:{E2:'op'}},profile:{parameters:{revocation_bound_s:1}}});
 assert.equal(out.propagation_ms,Math.floor(delta));assert.equal(out.elapsed_clock,'monotonic');assert.equal(out.grant_iat,payload.iat);assert.equal(out.grant_exp,payload.exp);
 assert.deepEqual(parseStrict(JSON.stringify(out)),out);
 assert.equal(out.requested_at,new Date(1700000000000).toISOString());
}
test('195 row duration survives a forward wall-clock jump',()=>duration(3600000));
test('195 row duration survives a backward wall-clock jump',()=>duration(-3600000));
test('195 polling deadline survives a forward wall-clock jump',()=>timeout(3600000));
test('195 polling deadline survives a backward wall-clock jump',()=>timeout(-3600000));
test('195 revocation bound measures monotonic time on forward jump',()=>propagation(3600000));
test('195 revocation bound measures monotonic time on backward jump',()=>propagation(-3600000));
test('236 fractional revocation observations serialize strictly; raw bound still enforced',async()=>{
 for(const delta of [0.125,25.75,999.999,1000])await propagation(3600000,delta);
 await assert.rejects(propagation(0,1000.01),/propagation took/);
});
test('195 signed timestamp and real expiry-skew wait remain wall-clock based',()=>{
 assert.match(sg3,/const nowS = \(\) => Math.floor\(Date.now\(\) \/ 1000\)/);
 assert.match(run,/const until = Math.max\(\.\.\.lateCtxs.map\(\(c\) => c.shortExp\)\) \+ profile.parameters.clock_skew_s \+ 5/);
 assert.match(run,/const waitMs = Math.max\(0, until \* 1000 - Date.now\(\)\)/);
 assert.match(run,/await sleep\(waitMs\)/);
 assert.doesNotMatch(run+sg3,/mock|fake|TIMING195_SOURCE/);
});
test('195 export row duration and actual outage wait use monotonic measurement',()=>{
 const block=run.slice(run.indexOf('// ---------------- SG-4'));
 assert.match(block,/const startedMono = performance.now\(\)/);
 assert.match(block,/r.elapsed_ms = Math.floor\(performance.now\(\) - startedMono\)/);
 assert.match(sg3,/await sleep\(waitS \* 1000\);\n\s+out.outage_elapsed_ms = Math.floor\(performance.now\(\) - outageStarted\)/);
});
test('236 actual outage statement keeps the requested sleep and floors only its observation',async()=>{
 let mono=0,wait=null;const out={};
 const body=between(sg3,'      const outageStarted = performance.now();','      const j = await expectRefusal');
 await compile('return (async()=>{'+body+'})();',['performance','sleep','out','waitS'],[{now:()=>mono},async ms=>{wait=ms;mono=135000.875;},out,135],'undefined');
 assert.equal(wait,135000);assert.equal(out.outage_elapsed_ms,135000);assert.deepEqual(parseStrict(JSON.stringify(out)),out);
});
