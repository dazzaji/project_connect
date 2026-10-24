// Pure transport controls for the actual ASTRA-R2-12 regression body and frozen observation helpers.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=process.env.ORACLE197_ROOT??path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
process.env.ORACLE140_ROOT=root;
const {lib,transport,feed,receipt,join}=await import(pathToFileURL(root+'/tests/oracle140-fixtures.mjs'));
const source=fs.readFileSync(process.env.REGRESSION197_SOURCE??root+'/runner/regressions.mjs','utf8');
const start=source.indexOf('  async "ASTRA-R2-12"(host) {'),end=source.indexOf('\n  },',start);
assert(start>=0&&end>start);
const probe=new Function(...Object.keys(lib),'return ({'+source.slice(start,end+5)+'})["ASTRA-R2-12"]')(...Object.values(lib));
const row=n=>({...join(),join_request_id:`ilp:synthetic.localhost:join_request:j${n}`});
const problem=code=>({status:lib.registeredStatus(code),contentType:'application/problem+json',json:{type:'urn:ilp:error:'+code,title:code,status:lib.registeredStatus(code)}});
async function run({codes=['AUTH_MISSING','AUTH_MISSING'],side=-1,effect=null,bad=null,feedStatus=200,anonFeed='NOT_FOUND'}={}){
 let posts=0,local=0;const seen=[];
 const state={feed:{items:[feed()],next_cursor:1,latest_seq:1},receipts:{items:[receipt()],next_cursor:null},joins:[row(1),row(2)]};
 const host={name:'synthetic',base:'http://synthetic.invalid',createEvent:async()=>({id:'e'}),credential:async()=> 'op',localParticipant:async()=>{local++;return {participant_token:'own'};}};
 const out=await transport(async(method,url,options)=>{
  const auth=options.headers?.authorization;seen.push([method,url.pathname,auth??null]);
  if(method==='POST'){
   const at=posts++;
   if(at===side){
    if(effect==='late-status')state.joins[1].status='approved';
    if(effect==='late-insert')state.joins.push(row(3));
    if(effect==='feed')state.feed.items[0].data.value=99;
    if(effect==='receipt')state.receipts.items[0].action_kind='changed';
   }
   const r=problem(codes[at]);
   if(bad==='success')return {status:201,json:{ok:true}};
   if(bad==='media')r.contentType='text/html';
   if(bad==='shape')delete r.json.type;
   if(bad==='title')r.json.title='not-the-code';
   if(bad==='status')r.json.status=200;
   if(bad==='garbage')return {status:401,contentType:'application/problem+json',text:'garbage'};
   return r;
  }
  if(url.pathname.endsWith('/feed')&&auth==='Bearer own')return {status:feedStatus,json:{items:[]}};
  if(url.pathname.endsWith('/feed')&&!auth)return problem(anonFeed);
  assert.equal(auth,'Bearer op','every observation retains operator authorization');
  if(url.pathname.endsWith('/feed'))return {status:200,json:structuredClone(state.feed)};
  if(url.pathname.endsWith('/receipts'))return {status:200,json:structuredClone(state.receipts)};
  if(url.pathname.endsWith('/join-requests'))return {status:200,json:{items:structuredClone(url.searchParams.has('cursor')?state.joins.slice(1):state.joins.slice(0,1)),next_cursor:url.searchParams.has('cursor')?null:'page2'}};
  assert.fail('unexpected route '+url.pathname);
 },()=>probe(host));
 assert.equal(posts,2);assert.equal(local,1);assert.equal(out.own,200);assert.equal(out.anonymous,404);
 assert(seen.some(x=>x[1].includes('00000000-0000-7000-8000-000000000000/registrations')));
 return out;
}
const rejects=options=>options.effect?assert.rejects(run(options),/admission state changed|side effects observed/):assert.rejects(run(options));
test('197 valid AUTH_MISSING pair preserves privacy and private-feed access',async()=>assert.equal((await run()).anonymous_register,'401 AUTH_MISSING'));
test('197 valid NOT_FOUND pair preserves reference unsupported-route privacy',async()=>assert.equal((await run({codes:['NOT_FOUND','NOT_FOUND']})).anonymous_register,'404 NOT_FOUND'));
test('197 unequal valid refusal pair is rejected',()=>rejects({codes:['AUTH_MISSING','NOT_FOUND']}));
test('197 reverse unequal valid refusal pair is rejected',()=>rejects({codes:['NOT_FOUND','AUTH_MISSING']}));
test('197 unrelated registered refusal pair is rejected',()=>rejects({codes:['FORBIDDEN','FORBIDDEN']}));
test('197 success cannot masquerade as anonymous refusal',()=>rejects({bad:'success'}));
test('197 garbage response is rejected',()=>rejects({bad:'garbage'}));
test('197 wrong problem media is rejected',()=>rejects({bad:'media'}));
test('197 missing problem type is rejected',()=>rejects({bad:'shape'}));
test('197 wrong problem title is rejected',()=>rejects({bad:'title'}));
test('197 mismatched problem status is rejected',()=>rejects({bad:'status'}));
test('197 private registration late-page join mutation is rejected',()=>rejects({side:0,effect:'late-status'}));
test('197 absent registration late-page join mutation is rejected',()=>rejects({side:1,effect:'late-status'}));
test('197 private registration late-page join insertion is rejected',()=>rejects({side:0,effect:'late-insert'}));
test('197 absent registration late-page join insertion is rejected',()=>rejects({side:1,effect:'late-insert'}));
test('197 private registration same-count feed mutation is rejected',()=>rejects({side:0,effect:'feed'}));
test('197 absent registration same-count feed mutation is rejected',()=>rejects({side:1,effect:'feed'}));
test('197 private registration receipt mutation is rejected',()=>rejects({side:0,effect:'receipt'}));
test('197 absent registration receipt mutation is rejected',()=>rejects({side:1,effect:'receipt'}));
test('197 own-participant private feed must still return 200',()=>rejects({feedStatus:404}));
test('197 anonymous private feed must still return NOT_FOUND',()=>rejects({anonFeed:'AUTH_MISSING'}));
test('197 all 27 regression probe identities remain unchanged',()=>{
 const before=fs.readFileSync(root+'/runner/regressions.mjs','utf8');
 const ids=s=>{assert.match(s,/selectProbes\(\[\.\.\.Object.keys\(PROBES\), "ASTRA-R2-02"\]/);return [...[...s.matchAll(/^  async "([^"]+)"\(host\)/gm)].map(m=>m[1]),'ASTRA-R2-02'];};
 assert.deepEqual(ids(source),ids(before));assert.equal(ids(source).length,27);
});
