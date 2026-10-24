import fs from 'node:fs';import path from 'node:path';import {applyUnifiedPatch,fileSha,sha,sourceTree} from './copied-library/focus-core.mjs';
export function install(source='/source',destination='/scratch/candidate'){
 if(source!=='/source'||destination!=='/scratch/candidate'||fs.existsSync(destination))throw Error('fresh owned candidate required');
 const manifest=JSON.parse(fs.readFileSync(new URL('./candidate/manifest-v4.json',import.meta.url)));if(manifest.sourceCommit!=='6f22fefa782747790e2eaefa01e4e5ea7b557323')throw Error('source pin');
 const before=sourceTree(source),inputs=new Map(),expected={};
 for(const row of manifest.files){const filename=path.join(source,row.path);if(row.baselineSHA256){if(fileSha(filename)!==row.baselineSHA256)throw Error('public source mismatch '+row.path);inputs.set(row.path,fs.readFileSync(filename));}else if(fs.existsSync(filename))throw Error('new helper already exists');expected[row.path]=row.sha256;}
 const patch=fs.readFileSync(new URL('./candidate/production-v4.patch',import.meta.url));if(sha(patch)!==manifest.patchSHA256)throw Error('composition digest');const outputs=applyUnifiedPatch(patch.toString(),inputs,expected);if(outputs.size!==4)throw Error('composition file count');
 fs.cpSync(source,destination,{recursive:true,filter:filename=>!filename.split(path.sep).includes('.git')});for(const [name,bytes] of outputs){const filename=path.join(destination,name);fs.mkdirSync(path.dirname(filename),{recursive:true});fs.writeFileSync(filename,bytes);if(fileSha(filename)!==expected[name])throw Error('candidate install identity');}
 const after=sourceTree(source);if(before.sha256!==after.sha256||before.files!==after.files)throw Error('read-only public source changed');return {sourceTree:before.sha256,files:manifest.files,patchSHA256:manifest.patchSHA256};
}
