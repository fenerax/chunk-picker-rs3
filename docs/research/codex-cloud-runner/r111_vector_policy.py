"""Proposed closed host projector. Pure; import has no I/O or process actions."""
import json

SURFACE_MAX=[6291456,1000000,10000,1000000,512,8192,100000,64]
GLOBAL_MAX=[999999999,6291456,6291456,6291456]
JOURNEY_MAX=[53,5,1,1815000000,1980000000,1980000000,1980000000]
def require(ok):
    if not ok: raise ValueError('r111-vector-schema')
def integer(x, maximum): return type(x) is int and 0 <= x <= maximum
def keys(x, names): return type(x) is dict and set(x)==set(names)
def matrix(rows, maxima, count):
    require(type(rows) is list and len(rows)==count)
    for row in rows:
        require(type(row) is list and len(row)==len(maxima))
        require(all(x is None or integer(x,m) for x,m in zip(row,maxima)))
def unknown(rows, counts, width):
    require(type(counts) is list and len(counts)==width)
    require(all(integer(x,len(rows)) for x in counts))
    require(counts==[sum(row[i] is None for row in rows) for i in range(width)])
def project_numeric_evidence(sample_vectors, journey_latencies):
    s,j=sample_vectors,journey_latencies
    require(keys(s,['schema','tMs','global','surfaces','unknown','dropped']) and type(s['schema']) is int and s['schema']==1)
    require(type(s['tMs']) is list and len(s['tMs'])<=128 and all(integer(t,1980000) and (i==0 or t>s['tMs'][i-1]) for i,t in enumerate(s['tMs'])))
    require(integer(s['dropped'],512));matrix(s['global'],GLOBAL_MAX,len(s['tMs']));unknown(s['global'],s['unknown'],4)
    require(type(s['surfaces']) is list and len(s['surfaces'])==3)
    for i,p in enumerate(s['surfaces']):
        require(keys(p,['page','values','unknown']) and type(p['page']) is int and p['page']==i)
        matrix(p['values'],SURFACE_MAX,len(s['tMs']));unknown(p['values'],p['unknown'],8)
    require(keys(j,['schema','rows','unknown','dropped']) and type(j['schema']) is int and j['schema']==1 and type(j['rows']) is list and len(j['rows'])<=54 and integer(j['dropped'],512))
    matrix(j['rows'],JOURNEY_MAX,len(j['rows']))
    require(all(all(integer(x,JOURNEY_MAX[k]) for k,x in enumerate(row[:3])) and (i==0 or row[0]>j['rows'][i-1][0]) for i,row in enumerate(j['rows'])))
    unknown([row[3:] for row in j['rows']],j['unknown'],4)
    return json.loads(json.dumps({'sampleVectors':s,'journeyLatencies':j},allow_nan=False,separators=(',',':')))

if __name__=='__main__':
    import sys
    try:
        raw=sys.stdin.read(32769);require(len(raw.encode())<=32768);value=json.loads(raw)
        result=project_numeric_evidence(value.get('sampleVectors'),value.get('journeyLatencies'))
        print(json.dumps(result,separators=(',',':'),allow_nan=False))
    except (ValueError,TypeError,KeyError,IndexError):
        print('{"valid":false}');sys.exit(2)
