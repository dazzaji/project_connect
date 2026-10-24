import test from 'node:test';
import assert from 'node:assert/strict';
import {caller,media,feedCase,lib} from './oracle171-fixtures.mjs';
const admissionError=e=>e instanceof lib.TestFailure&&/admission state changed|observe join requests/.test(e.message);
const observerError=e=>e instanceof lib.TestFailure&&/observe|cursor|feed/.test(e.message);
// R15 residual: exercise the actual full PC-DIR-2 through the maintained signed-claim fixture, for BOTH response pairs.
const mediaDifference=e=>e instanceof lib.TestFailure&&/private vs absent (?:join|malformed-envelope) refusals differ/.test(e.message);
const mediaPairs253=[
 ['quoted-pair charset','charset=utf-8','charset="utf\\-8"',true],
 ['quoted semicolon space','charset=utf-8; x="a;b=c"','charset=utf-8; x="a; b=c"',false],
 ['quoted semicolon order','charset=utf-8; x="a;b=c"; y=d','y=d; x="a;b=c"; charset=utf-8',true],
 ['quoted equals','x="a=b"','x="a=c"',false],
 ['quote escape','x="a\\\"b"','x="a\\\"c"',false],
 ['backslash escape','x="a\\\\b"','x="ab"',false],
 ['noncharset case','x=VALUE','x=value',false],
 ['charset and parameter-name case','CHARSET="UTF-8"; X=value','charset=utf-8; x=value',true],
 ['quoted token equivalence','x="va\\lue"','x=value',true],
 ['quoted boundary spaces','x=" value "','x=value',false],
 ['structured value boundaries','x="a;b=c"','x=a; b=c',false],
];
test("253 PC-DIR-2 quoted-pair charset pair 2 equivalent",()=>{
 const [name,a,b,equivalent]=mediaPairs253[0]; const first=2;
 const run=caller('PC-DIR-2',{problemMedia:(n,original)=>n===first?'Application/Problem+JSON; '+a:n===first+1?'application/problem+json; '+b:original});
 return equivalent?run:assert.rejects(run,mediaDifference);
});
test("253 PC-DIR-2 quoted-pair charset pair 4 equivalent",()=>{
 const [name,a,b,equivalent]=mediaPairs253[0]; const first=4;
 const run=caller('PC-DIR-2',{problemMedia:(n,original)=>n===first?'Application/Problem+JSON; '+a:n===first+1?'application/problem+json; '+b:original});
 return equivalent?run:assert.rejects(run,mediaDifference);
});
test("253 PC-DIR-2 quoted semicolon space pair 2 distinct",()=>{
 const [name,a,b,equivalent]=mediaPairs253[1]; const first=2;
 const run=caller('PC-DIR-2',{problemMedia:(n,original)=>n===first?'Application/Problem+JSON; '+a:n===first+1?'application/problem+json; '+b:original});
 return equivalent?run:assert.rejects(run,mediaDifference);
});
test("253 PC-DIR-2 quoted semicolon space pair 4 distinct",()=>{
 const [name,a,b,equivalent]=mediaPairs253[1]; const first=4;
 const run=caller('PC-DIR-2',{problemMedia:(n,original)=>n===first?'Application/Problem+JSON; '+a:n===first+1?'application/problem+json; '+b:original});
 return equivalent?run:assert.rejects(run,mediaDifference);
});
test("253 PC-DIR-2 quoted semicolon order pair 2 equivalent",()=>{
 const [name,a,b,equivalent]=mediaPairs253[2]; const first=2;
 const run=caller('PC-DIR-2',{problemMedia:(n,original)=>n===first?'Application/Problem+JSON; '+a:n===first+1?'application/problem+json; '+b:original});
 return equivalent?run:assert.rejects(run,mediaDifference);
});
test("253 PC-DIR-2 quoted semicolon order pair 4 equivalent",()=>{
 const [name,a,b,equivalent]=mediaPairs253[2]; const first=4;
 const run=caller('PC-DIR-2',{problemMedia:(n,original)=>n===first?'Application/Problem+JSON; '+a:n===first+1?'application/problem+json; '+b:original});
 return equivalent?run:assert.rejects(run,mediaDifference);
});
test("253 PC-DIR-2 quoted equals pair 2 distinct",()=>{
 const [name,a,b,equivalent]=mediaPairs253[3]; const first=2;
 const run=caller('PC-DIR-2',{problemMedia:(n,original)=>n===first?'Application/Problem+JSON; '+a:n===first+1?'application/problem+json; '+b:original});
 return equivalent?run:assert.rejects(run,mediaDifference);
});
test("253 PC-DIR-2 quoted equals pair 4 distinct",()=>{
 const [name,a,b,equivalent]=mediaPairs253[3]; const first=4;
 const run=caller('PC-DIR-2',{problemMedia:(n,original)=>n===first?'Application/Problem+JSON; '+a:n===first+1?'application/problem+json; '+b:original});
 return equivalent?run:assert.rejects(run,mediaDifference);
});
test("253 PC-DIR-2 quote escape pair 2 distinct",()=>{
 const [name,a,b,equivalent]=mediaPairs253[4]; const first=2;
 const run=caller('PC-DIR-2',{problemMedia:(n,original)=>n===first?'Application/Problem+JSON; '+a:n===first+1?'application/problem+json; '+b:original});
 return equivalent?run:assert.rejects(run,mediaDifference);
});
test("253 PC-DIR-2 quote escape pair 4 distinct",()=>{
 const [name,a,b,equivalent]=mediaPairs253[4]; const first=4;
 const run=caller('PC-DIR-2',{problemMedia:(n,original)=>n===first?'Application/Problem+JSON; '+a:n===first+1?'application/problem+json; '+b:original});
 return equivalent?run:assert.rejects(run,mediaDifference);
});
test("253 PC-DIR-2 backslash escape pair 2 distinct",()=>{
 const [name,a,b,equivalent]=mediaPairs253[5]; const first=2;
 const run=caller('PC-DIR-2',{problemMedia:(n,original)=>n===first?'Application/Problem+JSON; '+a:n===first+1?'application/problem+json; '+b:original});
 return equivalent?run:assert.rejects(run,mediaDifference);
});
test("253 PC-DIR-2 backslash escape pair 4 distinct",()=>{
 const [name,a,b,equivalent]=mediaPairs253[5]; const first=4;
 const run=caller('PC-DIR-2',{problemMedia:(n,original)=>n===first?'Application/Problem+JSON; '+a:n===first+1?'application/problem+json; '+b:original});
 return equivalent?run:assert.rejects(run,mediaDifference);
});
test("253 PC-DIR-2 noncharset case pair 2 distinct",()=>{
 const [name,a,b,equivalent]=mediaPairs253[6]; const first=2;
 const run=caller('PC-DIR-2',{problemMedia:(n,original)=>n===first?'Application/Problem+JSON; '+a:n===first+1?'application/problem+json; '+b:original});
 return equivalent?run:assert.rejects(run,mediaDifference);
});
test("253 PC-DIR-2 noncharset case pair 4 distinct",()=>{
 const [name,a,b,equivalent]=mediaPairs253[6]; const first=4;
 const run=caller('PC-DIR-2',{problemMedia:(n,original)=>n===first?'Application/Problem+JSON; '+a:n===first+1?'application/problem+json; '+b:original});
 return equivalent?run:assert.rejects(run,mediaDifference);
});
test("253 PC-DIR-2 charset and parameter-name case pair 2 equivalent",()=>{
 const [name,a,b,equivalent]=mediaPairs253[7]; const first=2;
 const run=caller('PC-DIR-2',{problemMedia:(n,original)=>n===first?'Application/Problem+JSON; '+a:n===first+1?'application/problem+json; '+b:original});
 return equivalent?run:assert.rejects(run,mediaDifference);
});
test("253 PC-DIR-2 charset and parameter-name case pair 4 equivalent",()=>{
 const [name,a,b,equivalent]=mediaPairs253[7]; const first=4;
 const run=caller('PC-DIR-2',{problemMedia:(n,original)=>n===first?'Application/Problem+JSON; '+a:n===first+1?'application/problem+json; '+b:original});
 return equivalent?run:assert.rejects(run,mediaDifference);
});
test("253 PC-DIR-2 quoted token equivalence pair 2 equivalent",()=>{
 const [name,a,b,equivalent]=mediaPairs253[8]; const first=2;
 const run=caller('PC-DIR-2',{problemMedia:(n,original)=>n===first?'Application/Problem+JSON; '+a:n===first+1?'application/problem+json; '+b:original});
 return equivalent?run:assert.rejects(run,mediaDifference);
});
test("253 PC-DIR-2 quoted token equivalence pair 4 equivalent",()=>{
 const [name,a,b,equivalent]=mediaPairs253[8]; const first=4;
 const run=caller('PC-DIR-2',{problemMedia:(n,original)=>n===first?'Application/Problem+JSON; '+a:n===first+1?'application/problem+json; '+b:original});
 return equivalent?run:assert.rejects(run,mediaDifference);
});
test("253 PC-DIR-2 quoted boundary spaces pair 2 distinct",()=>{
 const [name,a,b,equivalent]=mediaPairs253[9]; const first=2;
 const run=caller('PC-DIR-2',{problemMedia:(n,original)=>n===first?'Application/Problem+JSON; '+a:n===first+1?'application/problem+json; '+b:original});
 return equivalent?run:assert.rejects(run,mediaDifference);
});
test("253 PC-DIR-2 quoted boundary spaces pair 4 distinct",()=>{
 const [name,a,b,equivalent]=mediaPairs253[9]; const first=4;
 const run=caller('PC-DIR-2',{problemMedia:(n,original)=>n===first?'Application/Problem+JSON; '+a:n===first+1?'application/problem+json; '+b:original});
 return equivalent?run:assert.rejects(run,mediaDifference);
});
test("253 PC-DIR-2 structured value boundaries pair 2 distinct",()=>{
 const [name,a,b,equivalent]=mediaPairs253[10]; const first=2;
 const run=caller('PC-DIR-2',{problemMedia:(n,original)=>n===first?'Application/Problem+JSON; '+a:n===first+1?'application/problem+json; '+b:original});
 return equivalent?run:assert.rejects(run,mediaDifference);
});
test("253 PC-DIR-2 structured value boundaries pair 4 distinct",()=>{
 const [name,a,b,equivalent]=mediaPairs253[10]; const first=4;
 const run=caller('PC-DIR-2',{problemMedia:(n,original)=>n===first?'Application/Problem+JSON; '+a:n===first+1?'application/problem+json; '+b:original});
 return equivalent?run:assert.rejects(run,mediaDifference);
});
test("171 PC-CORE-3 stable complete admissions and intentional transitions pass",()=>caller("PC-CORE-3"));
test("171 PC-CORE-3 Beta numeric feed envelope passes",()=>caller("PC-CORE-3",{numeric:true}));
test("171 PC-CORE-3 identical malformed admissions fail",()=>assert.rejects(caller("PC-CORE-3",{mutation:'malformed'}),admissionError));
test("171 PC-CORE-3 refusal 0 rejects status",()=>assert.rejects(caller("PC-CORE-3",{side:0,mutation:"status"}),admissionError));
test("171 PC-CORE-3 refusal 0 rejects late-status",()=>assert.rejects(caller("PC-CORE-3",{side:0,mutation:"late-status"}),admissionError));
test("171 PC-CORE-3 refusal 0 rejects late-insert",()=>assert.rejects(caller("PC-CORE-3",{side:0,mutation:"late-insert"}),admissionError));
test("171 PC-CORE-3 refusal 1 rejects status",()=>assert.rejects(caller("PC-CORE-3",{side:1,mutation:"status"}),admissionError));
test("171 PC-CORE-3 refusal 1 rejects late-status",()=>assert.rejects(caller("PC-CORE-3",{side:1,mutation:"late-status"}),admissionError));
test("171 PC-CORE-3 refusal 1 rejects late-insert",()=>assert.rejects(caller("PC-CORE-3",{side:1,mutation:"late-insert"}),admissionError));
test("171 PC-CORE-3 refusal 2 rejects status",()=>assert.rejects(caller("PC-CORE-3",{side:2,mutation:"status"}),admissionError));
test("171 PC-CORE-3 refusal 2 rejects late-status",()=>assert.rejects(caller("PC-CORE-3",{side:2,mutation:"late-status"}),admissionError));
test("171 PC-CORE-3 refusal 2 rejects late-insert",()=>assert.rejects(caller("PC-CORE-3",{side:2,mutation:"late-insert"}),admissionError));
test("171 PC-PEER-2 stable complete admissions and intentional transitions pass",()=>caller("PC-PEER-2"));
test("171 PC-PEER-2 Beta numeric feed envelope passes",()=>caller("PC-PEER-2",{numeric:true}));
test("171 PC-PEER-2 identical malformed admissions fail",()=>assert.rejects(caller("PC-PEER-2",{mutation:'malformed'}),admissionError));
test("171 PC-PEER-2 refusal 0 rejects status",()=>assert.rejects(caller("PC-PEER-2",{side:0,mutation:"status"}),admissionError));
test("171 PC-PEER-2 refusal 0 rejects late-status",()=>assert.rejects(caller("PC-PEER-2",{side:0,mutation:"late-status"}),admissionError));
test("171 PC-PEER-2 refusal 0 rejects late-insert",()=>assert.rejects(caller("PC-PEER-2",{side:0,mutation:"late-insert"}),admissionError));
test("171 PC-DIR-2 stable complete admissions and intentional transitions pass",()=>caller("PC-DIR-2"));
test("171 PC-DIR-2 Beta numeric feed envelope passes",()=>caller("PC-DIR-2",{numeric:true}));
test("171 PC-DIR-2 identical malformed admissions fail",()=>assert.rejects(caller("PC-DIR-2",{mutation:'malformed'}),admissionError));
test("171 PC-DIR-2 refusal 0 rejects status",()=>assert.rejects(caller("PC-DIR-2",{side:0,mutation:"status"}),admissionError));
test("171 PC-DIR-2 refusal 0 rejects late-status",()=>assert.rejects(caller("PC-DIR-2",{side:0,mutation:"late-status"}),admissionError));
test("171 PC-DIR-2 refusal 0 rejects late-insert",()=>assert.rejects(caller("PC-DIR-2",{side:0,mutation:"late-insert"}),admissionError));
test("171 PC-DIR-2 refusal 1 rejects status",()=>assert.rejects(caller("PC-DIR-2",{side:1,mutation:"status"}),admissionError));
test("171 PC-DIR-2 refusal 1 rejects late-status",()=>assert.rejects(caller("PC-DIR-2",{side:1,mutation:"late-status"}),admissionError));
test("171 PC-DIR-2 refusal 1 rejects late-insert",()=>assert.rejects(caller("PC-DIR-2",{side:1,mutation:"late-insert"}),admissionError));
test("171 PC-DIR-2 refusal 2 rejects status",()=>assert.rejects(caller("PC-DIR-2",{side:2,mutation:"status"}),admissionError));
test("171 PC-DIR-2 refusal 2 rejects late-status",()=>assert.rejects(caller("PC-DIR-2",{side:2,mutation:"late-status"}),admissionError));
test("171 PC-DIR-2 refusal 2 rejects late-insert",()=>assert.rejects(caller("PC-DIR-2",{side:2,mutation:"late-insert"}),admissionError));
// repair233: PC-DIR-2 has six refusals (feed, receipts, private join, absent join, malformed private, malformed absent); positions 3-5 now covered too
test("233 PC-DIR-2 refusal 3 rejects status",()=>assert.rejects(caller("PC-DIR-2",{side:3,mutation:"status"}),admissionError));
test("233 PC-DIR-2 refusal 3 rejects late-status",()=>assert.rejects(caller("PC-DIR-2",{side:3,mutation:"late-status"}),admissionError));
test("233 PC-DIR-2 refusal 3 rejects late-insert",()=>assert.rejects(caller("PC-DIR-2",{side:3,mutation:"late-insert"}),admissionError));
test("233 PC-DIR-2 refusal 4 rejects status",()=>assert.rejects(caller("PC-DIR-2",{side:4,mutation:"status"}),admissionError));
test("233 PC-DIR-2 refusal 4 rejects late-status",()=>assert.rejects(caller("PC-DIR-2",{side:4,mutation:"late-status"}),admissionError));
test("233 PC-DIR-2 refusal 4 rejects late-insert",()=>assert.rejects(caller("PC-DIR-2",{side:4,mutation:"late-insert"}),admissionError));
test("233 PC-DIR-2 refusal 5 rejects status",()=>assert.rejects(caller("PC-DIR-2",{side:5,mutation:"status"}),admissionError));
test("233 PC-DIR-2 refusal 5 rejects late-status",()=>assert.rejects(caller("PC-DIR-2",{side:5,mutation:"late-status"}),admissionError));
test("233 PC-DIR-2 refusal 5 rejects late-insert",()=>assert.rejects(caller("PC-DIR-2",{side:5,mutation:"late-insert"}),admissionError));
test("171 PC-REV-3 stable complete admissions and intentional transitions pass",()=>caller("PC-REV-3"));
test("171 PC-REV-3 Beta numeric feed envelope passes",()=>caller("PC-REV-3",{numeric:true}));
test("171 PC-REV-3 identical malformed admissions fail",()=>assert.rejects(caller("PC-REV-3",{mutation:'malformed'}),admissionError));
test("171 PC-REV-3 refusal 0 rejects status",()=>assert.rejects(caller("PC-REV-3",{side:0,mutation:"status"}),admissionError));
test("171 PC-REV-3 refusal 0 rejects late-status",()=>assert.rejects(caller("PC-REV-3",{side:0,mutation:"late-status"}),admissionError));
test("171 PC-REV-3 refusal 0 rejects late-insert",()=>assert.rejects(caller("PC-REV-3",{side:0,mutation:"late-insert"}),admissionError));
test("171 PC-REV-3 refusal 1 rejects status",()=>assert.rejects(caller("PC-REV-3",{side:1,mutation:"status"}),admissionError));
test("171 PC-REV-3 refusal 1 rejects late-status",()=>assert.rejects(caller("PC-REV-3",{side:1,mutation:"late-status"}),admissionError));
test("171 PC-REV-3 refusal 1 rejects late-insert",()=>assert.rejects(caller("PC-REV-3",{side:1,mutation:"late-insert"}),admissionError));
test("171 PC-IDC-3 stable complete admissions and intentional transitions pass",()=>caller("PC-IDC-3"));
test("171 PC-IDC-3 Beta numeric feed envelope passes",()=>caller("PC-IDC-3",{numeric:true}));
test("171 PC-IDC-3 identical malformed admissions fail",()=>assert.rejects(caller("PC-IDC-3",{mutation:'malformed'}),admissionError));
test("171 PC-IDC-3 refusal 0 rejects status",()=>assert.rejects(caller("PC-IDC-3",{side:0,mutation:"status"}),admissionError));
test("171 PC-IDC-3 refusal 0 rejects late-status",()=>assert.rejects(caller("PC-IDC-3",{side:0,mutation:"late-status"}),admissionError));
test("171 PC-IDC-3 refusal 0 rejects late-insert",()=>assert.rejects(caller("PC-IDC-3",{side:0,mutation:"late-insert"}),admissionError));
test("171 PC-IDC-3 refusal 1 rejects status",()=>assert.rejects(caller("PC-IDC-3",{side:1,mutation:"status"}),admissionError));
test("171 PC-IDC-3 refusal 1 rejects late-status",()=>assert.rejects(caller("PC-IDC-3",{side:1,mutation:"late-status"}),admissionError));
test("171 PC-IDC-3 refusal 1 rejects late-insert",()=>assert.rejects(caller("PC-IDC-3",{side:1,mutation:"late-insert"}),admissionError));
test("171 PC-IDC-3 refusal 2 rejects status",()=>assert.rejects(caller("PC-IDC-3",{side:2,mutation:"status"}),admissionError));
test("171 PC-IDC-3 refusal 2 rejects late-status",()=>assert.rejects(caller("PC-IDC-3",{side:2,mutation:"late-status"}),admissionError));
test("171 PC-IDC-3 refusal 2 rejects late-insert",()=>assert.rejects(caller("PC-IDC-3",{side:2,mutation:"late-insert"}),admissionError));
test("171 PC-IDC-3 refusal 3 rejects status",()=>assert.rejects(caller("PC-IDC-3",{side:3,mutation:"status"}),admissionError));
test("171 PC-IDC-3 refusal 3 rejects late-status",()=>assert.rejects(caller("PC-IDC-3",{side:3,mutation:"late-status"}),admissionError));
test("171 PC-IDC-3 refusal 3 rejects late-insert",()=>assert.rejects(caller("PC-IDC-3",{side:3,mutation:"late-insert"}),admissionError));
test("171 PC-IDC-3 refusal 4 rejects status",()=>assert.rejects(caller("PC-IDC-3",{side:4,mutation:"status"}),admissionError));
test("171 PC-IDC-3 refusal 4 rejects late-status",()=>assert.rejects(caller("PC-IDC-3",{side:4,mutation:"late-status"}),admissionError));
test("171 PC-IDC-3 refusal 4 rejects late-insert",()=>assert.rejects(caller("PC-IDC-3",{side:4,mutation:"late-insert"}),admissionError));
test("171 PC-CORE-1 legal application/problem+json",()=>media("application/problem+json"));
test("171 PC-CORE-1 legal Application/Problem+JSON",()=>media("Application/Problem+JSON"));
test("171 PC-CORE-1 legal APPLICATION/PROBLEM+JSON; charset=\"utf-8\"",()=>media("APPLICATION/PROBLEM+JSON; charset=\"utf-8\""));
test("171 PC-CORE-1 rejects ledger application/problem+jsonjunk",()=>assert.rejects(media("application/problem+jsonjunk",true),/content-type/));
test("171 PC-CORE-1 rejects ledger application/problem+json/extra",()=>assert.rejects(media("application/problem+json/extra",true),/content-type/));
test("171 PC-CORE-1 rejects ledger application/problem+json; x=",()=>assert.rejects(media("application/problem+json; x=",true),/content-type/));
test("171 feed beta complete positive",()=>feedCase("beta"));
test("171 feed reference complete positive",()=>feedCase("reference"));
test("171 feed empty complete positive",()=>feedCase("empty"));
test("171 feed multipage complete positive",()=>feedCase("multipage"));
test("171 feed rejects drift",()=>assert.rejects(feedCase("drift"),observerError));
test("171 feed rejects repeat",()=>assert.rejects(feedCase("repeat"),observerError));
test("171 feed rejects malformed-late",()=>assert.rejects(feedCase("malformed-late"),observerError));
test("171 feed rejects truncated",()=>assert.rejects(feedCase("truncated"),observerError));
test("171 feed rejects missing",()=>assert.rejects(feedCase("missing"),observerError));
test("171 feed rejects cursor-mismatch",()=>assert.rejects(feedCase("cursor-mismatch"),observerError));
test("171 feed rejects unsafe",()=>assert.rejects(feedCase("unsafe"),observerError));
test("171 feed rejects negative",()=>assert.rejects(feedCase("negative"),observerError));
test("171 feed rejects fraction",()=>assert.rejects(feedCase("fraction"),observerError));
test("171 feed rejects nonmonotonic",()=>assert.rejects(feedCase("nonmonotonic"),observerError));
test("171 feed rejects malformed",()=>assert.rejects(feedCase("malformed"),observerError));
test("171 feed rejects empty-numeric",()=>assert.rejects(feedCase("empty-numeric"),observerError));
test("171 feed rejects empty-truncated",()=>assert.rejects(feedCase("empty-truncated"),observerError));
