// Closed numeric evidence only. No URLs, tokens, labels, bodies or dynamic keys.
export const VECTOR_POLICY=Object.freeze({schema:'r140-numeric-vectors-v1',maxPoints:128,maxJourneys:54,surfacePages:[0,1,2],surfaceMaxima:[6291456,1000000,10000,1000000,512,8192,100000,64],globalMaxima:[999999999,6291456,6291456,6291456],journeyMaxima:[53,5,1,1815000000,1980000000,1980000000,1980000000],maxSerializedCaseBytes:32768});
const integer=(x,max)=>Number.isSafeInteger(x)&&x>=0&&x<=max;
const keys=(x,names)=>x&&typeof x==='object'&&!Array.isArray(x)&&JSON.stringify(Object.keys(x).sort())===JSON.stringify([...names].sort());
const check=(x)=>{if(!x)throw Error('r140-vector-schema');};
const columnUnknown=rows=>rows.length?rows[0].map((_,i)=>rows.filter(r=>r[i]===null).length):[];
const value=(x,max)=>integer(x,max)?x:null;
const kib=x=>Number.isFinite(x)&&x>=0?Math.round(x/1024):null;
function matrix(rows,width,maxima,count,nullable=true){check(Array.isArray(rows)&&rows.length===count);for(const row of rows){check(Array.isArray(row)&&row.length===width);row.forEach((x,i)=>check(nullable&&x===null||integer(x,maxima[i])));}}
function unknown(rows,counts,width){check(Array.isArray(counts)&&counts.length===width);const expected=rows.length?columnUnknown(rows):Array(width).fill(0);check(JSON.stringify(counts)===JSON.stringify(expected));}
export function projectNumericEvidence(sampleVectors,journeyLatencies){
 const s=sampleVectors,j=journeyLatencies;
 check(keys(s,['schema','tMs','global','surfaces','unknown','dropped'])&&s.schema===1&&Array.isArray(s.tMs)&&s.tMs.length<=128&&s.tMs.every((t,i)=>integer(t,1980000)&&(i===0||t>s.tMs[i-1]))&&integer(s.dropped,512));
 matrix(s.global,4,VECTOR_POLICY.globalMaxima,s.tMs.length);unknown(s.global,s.unknown,4);check(Array.isArray(s.surfaces)&&s.surfaces.length===3);
 s.surfaces.forEach((p,i)=>{check(keys(p,['page','values','unknown'])&&p.page===i);matrix(p.values,8,VECTOR_POLICY.surfaceMaxima,s.tMs.length);unknown(p.values,p.unknown,8);});
 check(keys(j,['schema','rows','unknown','dropped'])&&j.schema===1&&Array.isArray(j.rows)&&j.rows.length<=54&&integer(j.dropped,512));matrix(j.rows,7,VECTOR_POLICY.journeyMaxima,j.rows.length);
 j.rows.forEach((r,i)=>check(r.slice(0,3).every((x,k)=>integer(x,VECTOR_POLICY.journeyMaxima[k]))&&(i===0||r[0]>j.rows[i-1][0])));unknown(j.rows.map(r=>r.slice(3)),j.unknown,4);
 return{sampleVectors:structuredClone(s),journeyLatencies:structuredClone(j)};
}
export function parseEvidenceLines(text,maxRows=512){
 if(typeof text!=='string'||Buffer.byteLength(text)>16*1024**2)throw Error('r140-vector-schema');const lines=text.split('\n'),rows=[];let dropped=0;
 for(let i=0;i<lines.length;i++){if(!lines[i])continue;if(rows.length>=maxRows){dropped++;continue;}try{const row=JSON.parse(lines[i]);if(!row||typeof row!=='object'||Array.isArray(row))throw Error();rows.push(row);}catch{dropped++;}}
 check(dropped<=512);return{rows,dropped};
}
export function compactEvidence(samples=[],journeys=[],{droppedSamples=0,droppedJourneys=0}={}){
 let chosen=[],lastBucket=-1,dropped=droppedSamples;
 for(const row of samples){if(!Number.isFinite(row.at)||row.at<0||row.at>1980000){dropped++;continue;}const bucket=Math.floor(row.at/15000);if(bucket<=lastBucket)continue;lastBucket=bucket;if(chosen.length<128)chosen.push(row);else{chosen[127]=row;dropped++;}}
 const tMs=chosen.map(r=>Math.round(r.at)),global=chosen.map(r=>[value(r.tree?.rssKiB,999999999),value(r.tree?.pssKiB,6291456),value(kib(r.server?.heap?.heapUsed),6291456),value(kib(r.probeMemory?.heapUsed),6291456)]);
 const surfaces=[0,1,2].map(page=>{const values=chosen.map(r=>{const p=r.browser?.find(x=>x.page===page),heap=p?.heap?.find(x=>x.name==='JSHeapUsedSize')?.value;return[value(kib(heap),6291456),value(p?.dom?.nodes,1000000),value(p?.dom?.documents,10000),value(p?.dom?.jsEventListeners,1000000),value(p?.network?.active,512),value(p?.network?.retainedRequests,8192),value(p?.observations?.naturalJSONBodies,100000),value(p?.network?.epoch,64)];});return{page,values,unknown:values.length?columnUnknown(values):Array(8).fill(0)};});
 const rows=[],seen=new Set(),kinds=['task','undo','note','claim','goal','player'];let bad=droppedJourneys;
 const micro=(x,max)=>value(Number.isFinite(x)&&x>=0?Math.round(x*1000):null,max);
 for(const row of journeys){const kind=kinds.indexOf(row.kind);if(!integer(row.index,53)||kind<0||!integer(row.actor,1)||seen.has(row.index)||rows.length>=54){bad++;continue;}seen.add(row.index);rows.push([row.index,kind,row.actor,micro(row.inputAt,1815000000),micro(row.correctMs,1980000000),micro(Number.isFinite(row.durableACKAt)&&Number.isFinite(row.inputAt)?row.durableACKAt-row.inputAt:null,1980000000),micro(row.authoritativeMs,1980000000)]);}rows.sort((a,b)=>a[0]-b[0]);
 return projectNumericEvidence({schema:1,tMs,global,surfaces,unknown:global.length?columnUnknown(global):Array(4).fill(0),dropped},{schema:1,rows,unknown:rows.length?columnUnknown(rows.map(r=>r.slice(3))):Array(4).fill(0),dropped:bad});
}
export function assertCaseBudget(value){check(Buffer.byteLength(JSON.stringify(value)+'\n')<=32768);return value;}
export function completeNumericObservation(value){const s=value.sampleVectors,j=value.journeyLatencies;return s.dropped===0&&s.tMs.length>=2&&s.tMs[0]<=15000&&s.tMs.at(-1)>=1800000&&j.dropped===0&&j.rows.length===54&&j.rows.every((row,i)=>row[0]===i&&row[1]===i%6&&row[2]===Math.floor(i/6)%2);}
