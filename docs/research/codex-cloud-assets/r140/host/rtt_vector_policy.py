"""Closed host projector proposal. No application/runtime imports or I/O on import."""
RTT_POLICY = {'schema': 1, 'maxCounts': [10, 20, 10], 'maxLatencyUs': 90000000}
NAMES = ['directNodeUs', 'proxyNodeUs', 'browserProxyUs']

def project_rtt_evidence(value):
    def require(condition):
        if not condition:
            raise ValueError('r140-rtt-evidence-invalid')
    require(type(value) is dict and set(value) == {'schema', *NAMES, 'unknown'})
    require(type(value['schema']) is int and value['schema'] == 1)
    require(type(value['unknown']) is list and len(value['unknown']) == 3)
    result = {'schema': 1}
    for index, name in enumerate(NAMES):
        rows = value[name]
        require(type(rows) is list and len(rows) <= RTT_POLICY['maxCounts'][index])
        require(all(n is None or (type(n) is int and 0 <= n <= RTT_POLICY['maxLatencyUs']) for n in rows))
        require(type(value['unknown'][index]) is int and value['unknown'][index] == rows.count(None))
        result[name] = list(rows)
    result['unknown'] = list(value['unknown'])
    return result

def complete_rtt_evidence(value):
    safe = project_rtt_evidence(value)
    return all(len(safe[name]) == RTT_POLICY['maxCounts'][index] and safe['unknown'][index] == 0 for index, name in enumerate(NAMES))

if __name__ == '__main__':
    import sys,json
    raw = sys.stdin.buffer.read(8193)
    if len(raw) > 8192:
        raise ValueError('r140-rtt-evidence-invalid')
    sys.stdout.write(json.dumps(project_rtt_evidence(json.loads(raw)), separators=(',', ':')))
