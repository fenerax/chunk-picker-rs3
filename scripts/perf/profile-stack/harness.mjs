const now = () => Number(process.hrtime.bigint()) / 1e6;
// Only measured driver operations are covered. There is no whole-scenario
// fallback span: time outside these actual awaits remains a real gap.
export function harness(browser, profileId) {
  const spans = []; let sequence = 0;
  async function measure(name, work) {
    const start = now();
    try { return await work(); }
    finally { spans.push({ kind: 'span', id: `${profileId}:harness:${++sequence}`, profileId,
      processId: 'driver', layer: 'harness', name, start, end: now() }); }
  }
  return { spans, browser: { ...browser,
    send: (method, params) => measure(`driver.${method}`, () => browser.send(method, params)),
    evaluate: expression => measure('driver.evaluate', () => browser.evaluate(expression)),
    wait: (name, work) => measure(name, work),
  } };
}

export function attributeHarness(spans, inputs, profileId) {
  const ordered=[...inputs].sort((a,b)=>a.start-b.start);
  return spans.flatMap(span=>{
    const points=[span.start,...ordered.filter(i=>i.start>span.start&&i.start<span.end).map(i=>i.start),span.end];
    return points.slice(1).map((end,i)=>({...span,id:`${span.id}:part:${i}`,start:points[i],end,
      profileId:[...ordered].reverse().find(input=>input.start<=points[i])?.profileId??profileId}));
  });
}
