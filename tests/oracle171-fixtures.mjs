// Finite synthetic transport; actual SG2/SG3/helper bodies. No listeners or database.
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {root,lib,transport,feed,receipt,join} from './oracle140-fixtures.mjs';
export {root,lib,feed,receipt,join};
const {SG3_TESTS}=await import(pathToFileURL(root+'/runner/tests-sg3.mjs'));
const {TESTS}=await import(pathToFileURL(root+'/runner/tests.mjs'));
const {generateKey}=await import(pathToFileURL(root+'/lib/jws.mjs'));
const key=generateKey('oracle171').privateJwk;
const row=n=>({...join(),join_request_id:`ilp:synthetic.localhost:join_request:j${n}`});
const fresh=()=>({feed:{items:[feed()],next_cursor:1,latest_seq:1},receipts:{items:[receipt()],next_cursor:null},joins:{items:[row(1),row(2)],next_cursor:null}});
const ok=json=>({status:200,json});
const problem=code=>({status:lib.registeredStatus(code),json:{type:'urn:ilp:error:'+code,title:code,status:lib.registeredStatus(code)},contentType:'application/problem+json'});
export async function caller(id,{side=-1,mutation='status',numeric=false}={}){
 const host={name:'synthetic',base:'http://synthetic.invalid'};
 const events={E1:{id:'e1',global_id:'ilp:synthetic.localhost:event:e1'},E2:{id:'e2',global_id:'ilp:synthetic.localhost:event:e2'},E_private:{id:'private',global_id:'ilp:synthetic.localhost:event:private'},E_nonfed:{global_id:'ilp:synthetic.localhost:event:nonfed'}};
 const ctx={host,home:{base:'http://home.invalid'},aux:{base:'http://aux.invalid',key},tag:'oracle171',events,
  creds:{operator:{E1:'op',E2:'op',E_private:'op'},provisioning:'prov',peering:{synthetic:'peer'}},
  privLocal:{participant_token:'local'},subject:{human:'ilp:home.invalid:human:h',agent:{id:'ilp:home.invalid:agent:a'}},
  token:'remote',grantPayload:{status:{uri:host.base+'/status'}},claim:'replayed',auxEvent:{global_id:'ilp:aux.invalid:event:aux'}};
 const states=new Map();const state=e=>{if(!states.has(e))states.set(e,fresh());return states.get(e);};
 let n=0,resumed=false,claims=0;
 function effect(s){
  if(mutation==='status')s.joins.items[0].status='approved';
  if(mutation==='subject')s.joins.items[0].subject='ilp:synthetic.localhost:human:other';
  if(mutation==='late-status')s.joins.items[1].status='denied';
  if(mutation==='late-insert')s.joins.items.push(row(3));
  if(mutation==='feed')s.feed.items[0].data.value=99;
  if(mutation==='receipt')s.receipts.items[0].action_kind='changed';
 }
 return transport(async(method,u,o)=>{
  const p=u.pathname,e=p.split('/')[4];
  if(p.endsWith('/claims')){claims++;return {status:201,json:{claim:'e30.'+Buffer.from(JSON.stringify({display_name:'Synthetic',n:claims})).toString('base64url')+'.eA'}};}
  if(p.endsWith('/admin/synthetic/humans'))return {status:201,json:{human:'ilp:home.invalid:human:race'}};
  if(p.endsWith('/suspend')){state('e1').receipts.items.push(receipt(2));state('e2').receipts.items.push(receipt(2));return ok({});}
  if(p.endsWith('/reinstate')){resumed=true;return ok({});}
  if(p==='/status')return ok({status:resumed?'active':'suspended'});
  if(p.endsWith('/federation/peers'))return ok({items:[{host:'home.invalid',state:'suspended'}],next_cursor:null});
  if(p.endsWith('/federation/events'))return ok({items:[],next_cursor:null});
  const kind=p.endsWith('/feed')?'feed':p.endsWith('/receipts')?'receipts':p.endsWith('/join-requests')?'joins':null;
  if(id==='PC-REV-3'&&resumed&&method==='POST')return {status:201,json:{id:'resumed'}};
  const refusal=method==='POST'||id==='PC-DIR-2'&&!o.headers?.authorization;
  if(refusal){
   const index=n++;
   if(id==='PC-IDC-3'&&index>=5){if(index===5){state(e).joins.items.push(row(100));return {status:202,json:{join_request_id:row(100).join_request_id}};}return problem('CLAIM_REPLAYED');}
   if(index===side)effect(state(e));
   const codes=id==='PC-IDC-3'?['CLAIM_REPLAYED','CLAIM_AUDIENCE_MISMATCH','CLAIM_EXPIRED','SIGNATURE_INVALID','SIGNATURE_INVALID']:id==='PC-CORE-3'?['SIGNATURE_INVALID','SIGNATURE_INVALID','UNKNOWN_SIGNER']:null;
   return problem(codes?codes[index]:id==='PC-PEER-2'?'NOT_A_PEER':id==='PC-REV-3'?'PEER_SUSPENDED':'NOT_FOUND');
  }
  assert(kind,'unhandled fixture request '+p);
  const q=structuredClone(state(e)[kind]);
  if(kind==='feed'&&!numeric)q.next_cursor=null;
  if(kind==='joins'){
   if(mutation==='malformed'){q.items=[{}];q.next_cursor=null;}
   else if(u.searchParams.has('cursor')){assert.equal(u.searchParams.get('cursor'),'page2');q.items=q.items.slice(1).filter(j=>j.join_request_id!==row(100).join_request_id);q.next_cursor=null;}
   else{
    // The accepted race row appears on page1. Old count-only controls can pass their legitimate +1 check,
    // so the isolated refusal mutants cannot be hidden by an unrelated positive-control failure.
    q.items=[q.items[0],...q.items.filter(j=>j.join_request_id===row(100).join_request_id)];q.next_cursor='page2';
   }
  }
  return ok(q);
 },()=>id==='PC-IDC-3'?TESTS[id](ctx):SG3_TESTS[id](ctx));
}

export async function media(type,invalid=false){
 lib.seenProblems().splice(0);
 const r=problem('AUTH_INVALID');r.contentType=type;r.text=JSON.stringify(r.json);
 if(invalid){lib.seenProblems().push({what:'synthetic-ledger',status:r.status,contentType:type,body:r.json});}
 else lib.expectProblem(r,'AUTH_INVALID','171 media');
 return SG3_TESTS['PC-CORE-1']();
}

export async function feedCase(mode){
 const seen=[];let calls=0;
 const result=await transport(async(method,u)=>{
  assert.equal(method,'GET');seen.push(u.href);
  if(!u.pathname.endsWith('/feed'))return ok({items:[],next_cursor:null});
  calls++;
  const since=Number(u.searchParams.get('since'));
  let body={items:[feed(1)],latest_seq:1,next_cursor:1};
  if(mode==='reference')body.next_cursor=null;
  if(mode==='empty')body={items:[],latest_seq:0,next_cursor:null};
  if(mode==='multipage'||mode==='drift'||mode==='repeat'||mode==='malformed-late'){
   assert.equal(u.searchParams.has('cursor'),false,'numeric feed must use since');
   body={items:[feed(since===0?3:7)],latest_seq:7,next_cursor:since===0?3:7};
   if(mode==='drift'&&since>0)body.latest_seq=8;
   if(mode==='repeat'&&since>0)body={items:[feed(3)],latest_seq:7,next_cursor:3};
   if(mode==='malformed-late'&&since>0)body.items=[{}];
  }
  if(mode==='truncated')body={items:[feed(1)],latest_seq:2,next_cursor:null};
  if(mode==='missing')delete body.next_cursor;
  if(mode==='cursor-mismatch')body.next_cursor=0;
  if(mode==='unsafe')body.next_cursor=Number.MAX_SAFE_INTEGER+1;
  if(mode==='negative')body.next_cursor=-1;
  if(mode==='fraction')body.next_cursor=0.5;
  if(mode==='nonmonotonic')body.items=[feed(1),feed(1)];
  if(mode==='malformed')body.items=[{}];
  if(mode==='empty-numeric')body={items:[],latest_seq:0,next_cursor:0};
  if(mode==='empty-truncated')body={items:[],latest_seq:2,next_cursor:null};
  return ok(body);
 },()=>lib.observe({name:'synthetic',base:'http://synthetic.invalid'},'e'));
 if(mode==='multipage'){assert.equal(calls,2);assert.equal(result.latest_seq,7);assert.equal(result.actions,2);assert.match(seen[1],/since=3/);}
 if(mode==='beta'){assert.equal(calls,1);assert.equal(result.latest_seq,1);}
 return result;
}
