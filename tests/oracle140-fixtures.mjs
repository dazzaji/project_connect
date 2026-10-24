// Synthetic transport only. Production helper/probe bodies execute unchanged; no server/DB/network.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {dirname,resolve} from 'node:path';
export const root=process.env.ORACLE140_ROOT||resolve(dirname(fileURLToPath(import.meta.url)),'..');
export const lib=await import(pathToFileURL(root+'/runner/lib.mjs'));
const {b64u}=await import(pathToFileURL(root+'/lib/jws.mjs'));
const source=readFileSync(process.env.ORACLE122_SOURCE||root+'/runner/regressions.mjs','utf8');
const start=source.indexOf('async function joinState('),end=source.indexOf('\n}',start);
const joinState=new Function('http','check','observeJoins',`return (${source.slice(start,end+2)})`)(lib.http,lib.check,lib.observeJoins);
export function probe(id,extra={}){const at=source.indexOf(`  async "${id}"(host) {`);assert(at>=0);const end=source.indexOf('\n  },',at);const scope={...lib,joinState,b64u,...extra};return new Function(...Object.keys(scope),`return ({${source.slice(at,end+5)}})[${JSON.stringify(id)}]`)(...Object.values(scope));}
export const problem=code=>({status:lib.registeredStatus(code),contentType:'application/problem+json',json:{type:'urn:ilp:error:'+code,title:code,status:lib.registeredStatus(code)},text:'synthetic'});
export const feed=(seq=1)=>({seq,occurred_at:'2026-10-23T12:00:00.000Z',kind:'action.accepted',resource_global_id:`ilp:synthetic.localhost:action:a${seq}`,summary:'Synthetic',data:{value:seq}});
export const receipt=(n=1)=>({id:`ilp:synthetic.localhost:receipt:r${n}`,event:'ilp:synthetic.localhost:event:e',action_kind:'unconference.proposal',subject_human:'ilp:synthetic.localhost:human:h',subject_agent:null,license_plate:null,mandate:'human_directed',resource:`ilp:synthetic.localhost:action:a${n}`,occurred_at:'2026-10-23T12:00:00.000Z',prev_receipt_hash:'0'.repeat(64),hash:String(n).repeat(64)});
export const join=(status='pending')=>({join_request_id:'ilp:synthetic.localhost:join_request:j',status,subject:'ilp:synthetic.localhost:human:h'});
export const empty=()=>({feed:{items:[],next_cursor:null,latest_seq:0},receipts:{items:[],next_cursor:null},joins:{items:[],next_cursor:null}});
export async function transport(handler,body){const saved=globalThis.fetch;globalThis.fetch=async(url,options={})=>{
 const r=await handler(options.method||'GET',new URL(url),options);
 assert(r,'unexpected synthetic HTTP request');return new Response(r.text===undefined?JSON.stringify(r.json):r.text,{status:r.status,headers:{'content-type':r.contentType||'application/json'}});
 };try{return await body();}finally{globalThis.fetch=saved;}}
const wire=r=>({...r,text:JSON.stringify(r.json)});
export const host={name:'synthetic',base:'http://synthetic.invalid',createEvent:async()=>({id:'e',global_id:'ilp:synthetic.localhost:event:e'}),credential:async()=> 'operator-fixture'};
function observation(url,options){if(url.pathname.endsWith('/feed'))return 'feed';if(url.pathname.endsWith('/receipts'))return 'receipts';if(url.pathname.endsWith('/join-requests')&&options.headers?.authorization==='Bearer operator-fixture')return 'joins';return null;}
export async function joinOrder(answer=()=>problem('AUTH_INVALID')){let count=0;return transport(async(_method,url,o)=>{const k=observation(url,o);if(k)return {status:200,json:empty()[k]};return wire(o.headers?.cookie?answer(count++):problem(o.headers?.authorization?'AUTH_INVALID':'AUTH_MISSING'));},()=>probe('SG2R2-JOIN-ORDER')(host));}
export async function oversize({effect=()=>{},observer=()=>{},answer=problem('PAYLOAD_TOO_LARGE'),initial=empty()}={}){const state=structuredClone(initial);let posted=false;return transport(async(method,url,o)=>{
 if(method==='POST'){posted=true;effect(state);return wire(answer);}
 const k=observation(url,o);assert(k);const response={status:200,json:structuredClone(state[k])};observer(response,k,posted,url);return response;
 },()=>probe('ASTRA-R2-09')(host));}
export async function local4a({effect=()=>{},side=-1}={}){const state=empty();let requests=0,events=0;const h={...host,createEvent:async()=>({id:'e'+(++events)}),localParticipant:async()=>({participant_token:'local-fixture'})};
 return transport(async(method,url,o)=>{if(method==='POST'){const n=requests++;if(n===side)effect(state);return wire(problem(n===0?'SIGNATURE_INVALID':'FORBIDDEN'));}const k=observation(url,o);assert(k);return {status:200,json:state[k]};},()=>probe('SG2R2-LOCAL-4A',{admitted:async()=>({ev:{id:'a'}}),retrieve:async()=>({json:{grant:'e30.'+Buffer.from('{"role":"participant"}').toString('base64url')+'.eA'}})})(h));}
export async function observations(handler,kind='public'){return transport(async(method,url,o)=>{assert.equal(method,'GET');return handler(url,o);},()=>kind==='joins'?lib.observeJoins(host,'e','operator-fixture'):lib.observe(host,'e','operator-fixture'));}
export async function sg3Refusal(id,{effect=()=>{},side=-1}={}){
 const {SG3_TESTS}=await import(pathToFileURL(root+'/runner/tests-sg3.mjs'));
 const states=new Map(),state=e=>{if(!states.has(e))states.set(e,empty());return states.get(e);};let n=0,stops=0,starts=0;
 const ctx={host,home:{...host,base:'http://home.invalid',kind:'beta',adminHuman:'ilp:home.localhost:human:h',stop:async()=>{stops++;},start:async()=>{starts++;}},aux:{base:'http://aux.invalid'},homeEvent:{id:'home'},
 events:{E1:{id:'e1',global_id:'ilp:synthetic.localhost:event:e1'},E2:{id:'e2'},E_short:{id:'short'},E_local:{id:'local'}},creds:{provisioning:'provision-fixture',operator:{E1:'operator-fixture',E2:'operator-fixture',E_short:'operator-fixture'}},
 short:{token:'short-fixture',payload:{status:{uri:host.base+'/status'}}},token:'remote-fixture',local:{participant_token:'local-fixture'},second:{subject:{human:'ilp:home.localhost:human:h',agent:{id:'ilp:home.localhost:agent:a'}}},profile:{parameters:{fail_closed_after_s:-15}}};
 try{return await transport(async(method,url,o)=>{
  const e=url.pathname.split('/')[4],k=observation(url,o);if(method==='GET'&&k)return {status:200,json:state(e)[k]};
  if(url.pathname==='/status')return {status:200,json:{status:'expired'}};
  if(id==='PC-REV-4'&&url.hostname==='home.invalid')return {status:201,json:{claim:'synthetic-claim'}};
  if(id==='PC-REV-4'&&starts>0)return {status:201,json:{id:'recovered-action'}};
  if(id==='PC-REV-4'&&e==='local'){state(e).feed.items.push(feed());state(e).feed.latest_seq=1;return {status:201,json:{id:'local-action'}};}
  assert.equal(method,'POST');if(n++===side)effect(state(e||'home'));
  const answer=problem(id==='PC-PROV-1'?'FORBIDDEN':id==='PC-REV-4'?'REVOCATION_STATE_UNKNOWN':'GRANT_EXPIRED');if(id==='PC-REV-4')answer.json.retry_after=1;return wire(answer);
 },()=>SG3_TESTS[id](ctx));}finally{if(id==='PC-REV-4'){assert.equal(stops,1);assert.equal(starts,1);}}
}
