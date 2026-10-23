// Pure catalog controls: no variants, processes, databases, deletion or network.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {resolve,join} from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
const verifierRoot=process.env.NEGATIVE236_VERIFIER_SOURCE??root;
const source=readFileSync(join(root,'runner/sg4.mjs'),'utf8');
const sha=b=>createHash('sha256').update(b).digest('hex');
const hashOf=rel=>sha(readFileSync(join(verifierRoot,rel)));
const start=source.indexOf('export const NEGATIVE_VERIFIER_BINDING'),end=source.indexOf('/** Close E1');
assert(start>=0&&end>start);
const body=source.slice(start,end).replaceAll('export ','').replaceAll('import.meta.url',JSON.stringify(pathToFileURL(join(verifierRoot,'runner/sg4.mjs')).href));
const {binding,guard}=new Function('sha','readFileSync',body+';return {binding:NEGATIVE_VERIFIER_BINDING,guard:assertNegativeVerifierBinding};')(sha,readFileSync);
test('236 negative catalog binds actual reviewed verifier and schema; either drift is refused',()=>{
 assert.equal(Object.keys(binding).length,2);
 guard();guard(hashOf);
 for(const changed of Object.keys(binding))assert.throws(()=>guard(rel=>rel===changed?'0'.repeat(64):hashOf(rel)),/verifier\/schema drift/);
 assert(source.indexOf('  assertNegativeVerifierBinding();')<source.indexOf('  const firstExport ='));
});
test('236 public catalog has exactly eleven expected reasons and unchanged traversal mutation shape',()=>{
 const actual=[...source.matchAll(/\{ id: "([^"]+)", expect: "([^"]+)"/g)].map(m=>[m[1],m[2]]);
 assert.deepEqual(actual,[['NEG-1 deleted required file','files'],['NEG-2 removed result (re-hashed)','attestations'],['NEG-3 removed grant link','files'],['NEG-3b removed grant link (re-hashed)','exports'],['NEG-4 altered signed byte','attestations'],['NEG-5 changed signer','attestations'],['NEG-6 changed profile','profile'],['NEG-7 changed build','subjects'],['NEG-8 path traversal entry','content-manifest'],['NEG-9 duplicate entry','files'],['NEG-10 substituted self-signed key set','subjects']]);
 const line=source.split('\n').find(l=>l.includes('id: "NEG-8 path traversal entry"'));
 const mutation=line.slice(line.indexOf('(d) => {'),line.lastIndexOf(') },'));
 const content={files:[]};let wrote=null,rehashes=0;
 new Function('J','W','rehash','return ('+mutation+');')(()=>content,(_d,p,text)=>{assert.equal(p,'content.json');wrote=JSON.parse(text);},()=>rehashes++)('synthetic');
 assert.deepEqual(wrote.files,[{path:'../outside.json',sha256:'0'.repeat(64),bytes:0}]);assert.equal(rehashes,1);
});
test('236 bound real schema rejects traversal at the content-manifest path constraint',async()=>{
 guard();
 const {validateAt}=await import(pathToFileURL(join(verifierRoot,'lib/schemas.mjs')));
 const pointer='/$defs/content/properties/files/items/properties/path';
 assert.equal(validateAt('evidence-packet-manifest',pointer,'results/results.jsonl'),true);
 assert.equal(validateAt('evidence-packet-manifest',pointer,'../outside.json'),false);
 assert.equal(validateAt('evidence-packet-manifest',pointer,'nested/../outside.json'),false);
});
