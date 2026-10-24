export function specimen() {
  const alias={nested:{number:7}};
  const probe={date:new Date('2000-01-01T00:00:00.000Z'),map:new Map([['key',1]]),set:new Set([1]),
    bytes:Buffer.from([1,2,3]),array:[undefined,NaN,Infinity],undefinedField:undefined,left:alias,right:alias};
  Object.defineProperty(probe,'hidden',{value:'must-not-cross',enumerable:false});
  Object.defineProperty(probe,'fixed',{value:'JSON-normalizes-descriptor',enumerable:true,writable:false,configurable:false});
  return {chunks:{'12341':{},'12342':{}},walkableChunks:['12341','12342'],walkableChunksF2P:['12341','12342'],
    challenges:{Quest:{'Present quest':{Chunks:['12341']},'Future quest':{Chunks:['12342']}}},codecProbe:probe};
}
