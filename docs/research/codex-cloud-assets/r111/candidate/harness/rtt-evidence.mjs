// Closed numeric calibration evidence; no clock, I/O, app or browser starts.
export const RTT_POLICY=Object.freeze({schema:1,maxCounts:[10,20,10],maxLatencyUs:90000000});
const names=['directNodeUs','proxyNodeUs','browserProxyUs'];
const ensure=value=>{if(!value)throw Error('r111-rtt-evidence-invalid');};
export function projectRttEvidence(value){
 ensure(value&&typeof value==='object'&&!Array.isArray(value)&&JSON.stringify(Object.keys(value).sort())===JSON.stringify(['schema',...names,'unknown'].sort())&&value.schema===1);
 ensure(Array.isArray(value.unknown)&&value.unknown.length===3);
 const out={schema:1};
 names.forEach((name,index)=>{const rows=value[name];ensure(Array.isArray(rows)&&rows.length<=RTT_POLICY.maxCounts[index]);out[name]=rows.map(n=>{ensure(n===null||(Number.isSafeInteger(n)&&n>=0&&n<=RTT_POLICY.maxLatencyUs));return n;});ensure(Number.isSafeInteger(value.unknown[index])&&value.unknown[index]===rows.filter(n=>n===null).length);});
 out.unknown=[...value.unknown];return out;
}
export function encodeRttEvidence({direct=[],proxy=[],browser=[]}={}){
 const out={schema:1},values=[direct,proxy,browser];
 names.forEach((name,index)=>{ensure(Array.isArray(values[index])&&values[index].length<=RTT_POLICY.maxCounts[index]);out[name]=values[index].map(ms=>Number.isFinite(ms)&&ms>=0&&ms*1000<=RTT_POLICY.maxLatencyUs?Math.round(ms*1000):null);});
 out.unknown=names.map(name=>out[name].filter(n=>n===null).length);return projectRttEvidence(out);
}
export function verifyRttPolicy(policy){
 ensure(policy?.structuredKeys?.includes('rttEvidence')&&policy.r111RttEvidence&&Object.keys(policy.r111RttEvidence).length===Object.keys(RTT_POLICY).length&&Object.entries(RTT_POLICY).every(([key,value])=>JSON.stringify(policy.r111RttEvidence[key])===JSON.stringify(value)));
}
export function completeRttEvidence(value){
 const safe=projectRttEvidence(value);return names.every((name,index)=>safe[name].length===RTT_POLICY.maxCounts[index]&&safe.unknown[index]===0);
}
