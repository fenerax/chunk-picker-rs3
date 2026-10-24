import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import {fileURLToPath} from 'node:url';
export const REQUIRED_RUNTIME=Object.freeze(['entry.mjs','protocol.mjs','install-v4.mjs','copied-library/focus-core.mjs','copied-library/tests/task-focus-native.observers.mjs','native-cell-v3.mjs','scheduler-fixture-v3.mjs','native-phase-preload-v3.mjs','driver-lib.mjs','candidate/manifest-v4.json','candidate/production-v4.patch','runtime-integrity.mjs','case-result-adapter.mjs','diagnostics.mjs'].sort());
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
export function expectedManifestArgument(args){
 if(!Array.isArray(args)||args.length!==2||args[0]!=='--expected-harness-manifest-sha'||typeof args[1]!=='string'||!/^[0-9a-f]{64}$/.test(args[1]))throw Error('required --expected-harness-manifest-sha <64hex>');return args[1];
}
export function checkRequiredManifest(manifest,read){
 if(manifest.schema!=='r131-required-runtime-assets-v1'||manifest.sourceCommit!=='6f22fefa782747790e2eaefa01e4e5ea7b557323'||manifest.entry!=='entry.mjs'||!Array.isArray(manifest.files))throw Error('runtime manifest schema');
 const names=manifest.files.map(r=>r.path).sort();if(JSON.stringify(names)!==JSON.stringify(REQUIRED_RUNTIME))throw Error('required runtime list mismatch');
 for(const row of manifest.files){const bytes=read(row.path);if(bytes.length!==row.bytes||hash(bytes)!==row.sha256)throw Error('runtime asset identity '+row.path);}return true;
}
export function verifyRuntime(expectedSha){
 if(typeof expectedSha!=='string'||!/^[0-9a-f]{64}$/.test(expectedSha))throw Error('root-pinned manifest CLI digest required');
 const root=fileURLToPath(new URL('./',import.meta.url)),filename=path.join(root,'runtime-publication-manifest.json'),bytes=fs.readFileSync(filename);if(hash(bytes)!==expectedSha)throw Error('runtime manifest digest mismatch');
 const manifest=JSON.parse(bytes),names=[];
 function walk(folder,relative=''){for(const entry of fs.readdirSync(folder,{withFileTypes:true})){const name=relative?relative+'/'+entry.name:entry.name;if(entry.isSymbolicLink())throw Error('runtime symlink');if(entry.isDirectory())walk(path.join(folder,entry.name),name);else if(entry.isFile())names.push(name);else throw Error('runtime special file');}}walk(root);
 if(JSON.stringify(names.sort())!==JSON.stringify([...REQUIRED_RUNTIME,'runtime-publication-manifest.json'].sort()))throw Error('unexpected or omitted publication asset');
 checkRequiredManifest(manifest,name=>{const target=path.join(root,name),stat=fs.lstatSync(target);if(!stat.isFile()||stat.isSymbolicLink())throw Error('runtime asset must be regular');return fs.readFileSync(target);});return {sha256:expectedSha,files:manifest.files.length};
}
