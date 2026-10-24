"""Pure scoped R111 observation predicates; fixtures contain no runtime imports."""
import copy
import hashlib
import json
import math
import unittest

from accept_scoped_session import scoped_observed

SOURCE = '6f22fefa782747790e2eaefa01e4e5ea7b557323'
HARNESS = '510aa8034635626b1c16e61a2108ef3a9f9dc056e3dc30913f92f842135dca37'
FIXTURE = 'a672a1f9b5de6a699a18c26c5fad6fe477a5e37d05c75f115f425a8a3f789b09'
NODE = 'b'*64
GATES = ['fault-recovery','latest-generation','physical-paint','independent-engine-correctness',
         'full-legacy-coverage','memory-nonaccumulation','statistical-performance']
SCOPE = {'dataset':'duo-legacy','fixtureBaseline':'r37-authored-711-v2','players':2,'overlays':1,
         'memberUnlockedChunks':1,'taskCoverage':'fixture-member-catalogue','sessionMinutes':30}

def source_lock():
    names=sorted(['app/server.mjs','app/storage/store.mjs','app/datasets.mjs','app/dataset-runtime.mjs',
                  'app/core/state.mjs','app/private-addon.mjs'])
    files=[]
    for name in names:
        data=('tiny authored source fixture: '+name).encode()
        files.append({'path':name,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()})
    digest=hashlib.sha256(json.dumps(files,separators=(',',':')).encode()).hexdigest()
    return {'schemaVersion':1,'sourceCommit':SOURCE,'manifestSha256':digest,'files':files,
            'criticalFiles':{row['path']:row['sha256'] for row in files},
            'verification':'host-verified-public-git-archive'}

def vectors(times=None):
    times=list(range(0,1800001,15000)) if times is None else list(times)
    n=len(times)
    return {'sampleVectors':{'schema':1,'tMs':times,'global':[[None]*4 for _ in times],
               'surfaces':[{'page':page,'values':[[None]*8 for _ in times],'unknown':[n]*8} for page in range(3)],
               'unknown':[n]*4,'dropped':0},
            'journeyLatencies':{'schema':1,'rows':[[i,i%6,(i//6)%2,None,None,None,None] for i in range(54)],
               'unknown':[54]*4,'dropped':0}}

def valid_final():
    lock=source_lock()
    case={'schema':'r111-long-session-v2','mode':'r111-public-duo-session-v2','status':'blocked',
          'code':'r111-source-slice-observed','passed':False,'acceptance':False,'cleanupPassed':True,
          'caseExitCode':0,'sourcePin':SOURCE,'fixtureSha256':FIXTURE,
          'sourceManifestSha256':lock['manifestSha256'],'harnessManifestSha256':HARNESS,'nodeSha256':NODE,
          'scope':dict(SCOPE),'openGates':list(GATES),
          'metrics':{'targetDurationMs':1800000,'operations':54,'mutations':45,'closedPages':3,
                     'networkPending':0,'timedDurationMs':1800001,'observedTimedDurationMs':1800002,'elapsedMs':1900000}}
    case.update(vectors())
    inner={'passed':True,'control':'none','intentionalNegative':False,'samples':362,
           'cgroupMemoryPeak':1000000000,'rssUnknownSamples':0,'pssUnknownSamples':0,'orphanReaped':True,'caseResult':case}
    final={'schema':'docker-envelope-final-v1','envelope':'docker-hard-2cpu-6g-v1','sourceCommit':SOURCE,
           'mode':'soak','control':'none','passed':True,'cleanupPassed':True,'reasonCode':None,'result':inner,
           'hostConfig':{'admitted':True,'failedChecks':[],'nanoCpus':2000000000,'cpus':[0,1],
                         'memory':6442450944,'memorySwap':6442450944,'pidsLimit':512,'init':True},
           'containerCleanup':{'running':False,'pid':0,'removed':True,'exitCode':0,'oomKilled':False},
           'provenance':{'sourceManifestSha256':'c'*64,'harnessManifestSha256':'d'*64,'nodeSha256':NODE},
           'baseline':{'image':'mcr.microsoft.com/playwright:v1.62.1-noble@sha256:c091b21d9fae78c76e85cd4356431e9b018402f172a214fc7d7a5e9a7e29d8ac','node':'v24.19.0','playwright':'1.62.1','chromium':'151.0.7922.34','chromiumRevision':'1234','platform':'linux/amd64'},
           'allProductAcceptanceGates':'OPEN'}
    return final,lock

def case_of(final):
    return final['result']['caseResult']

def set_times(final,times):
    case_of(final).update(vectors(times))

class ScopedSession(unittest.TestCase):
    def assert_rejected(self,final,lock):
        self.assertIs(scoped_observed(final,lock),False)

    def test_valid_blocked_observation_with_121_points_and_null_latencies(self):
        final,lock=valid_final()
        self.assertEqual(len(case_of(final)['sampleVectors']['tMs']),121)
        self.assertIs(scoped_observed(final,lock),True)

    def test_valid_minimum_110_points_without_long_gaps(self):
        final,lock=valid_final()
        removed={10*i for i in range(1,12)}
        set_times(final,[t for i,t in enumerate(range(0,1800001,15000)) if i not in removed])
        self.assertEqual(len(case_of(final)['sampleVectors']['tMs']),110)
        self.assertIs(scoped_observed(final,lock),True)

    def test_109_points_rejected_even_with_full_span_and_small_gaps(self):
        final,lock=valid_final()
        removed={9*i for i in range(1,13)}
        set_times(final,[t for i,t in enumerate(range(0,1800001,15000)) if i not in removed])
        self.assertEqual(len(case_of(final)['sampleVectors']['tMs']),109)
        self.assert_rejected(final,lock)

    def test_exact_45000_gap_allowed_but_60000_gap_rejected(self):
        final,lock=valid_final()
        times=list(range(0,1800001,15000))
        set_times(final,[t for i,t in enumerate(times) if i not in {40,41}])
        self.assertIs(scoped_observed(final,lock),True)
        set_times(final,[t for i,t in enumerate(times) if i not in {40,41,42}])
        self.assert_rejected(final,lock)

    def test_old_two_endpoint_evidence_rejected(self):
        final,lock=valid_final();set_times(final,[0,1800000])
        self.assert_rejected(final,lock)

    def test_strict_timestamps_unique_buckets_and_endpoint_coverage(self):
        for change in ('duplicate','reverse','same-bucket','late-first','short-last'):
            with self.subTest(change=change):
                final,lock=valid_final();times=list(range(0,1800001,15000))
                if change=='duplicate':times[1]=times[0]
                elif change=='reverse':times[2]=times[1]-1
                elif change=='same-bucket':times[1]=1000
                elif change=='late-first':times=[15001,*times[2:]]
                else:times[-1]=1799999
                set_times(final,times);self.assert_rejected(final,lock)

    def test_first_sample_at_15000_is_within_start_boundary(self):
        final,lock=valid_final();set_times(final,range(15000,1800001,15000))
        self.assertIs(scoped_observed(final,lock),True)

    def test_dropped_samples_or_journeys_are_not_complete_observation(self):
        for key in ('sampleVectors','journeyLatencies'):
            with self.subTest(key=key):
                final,lock=valid_final();case_of(final)[key]['dropped']=1
                self.assert_rejected(final,lock)

    def test_missing_duplicate_wrong_kind_and_wrong_actor_journeys(self):
        for change in ('missing','duplicate','kind','actor'):
            with self.subTest(change=change):
                final,lock=valid_final();rows=case_of(final)['journeyLatencies']['rows']
                if change=='missing':
                    rows.pop();case_of(final)['journeyLatencies']['unknown']=[53]*4
                elif change=='duplicate':rows[1][0]=0
                elif change=='kind':rows[0][1]=5
                else:rows[0][2]=1
                self.assert_rejected(final,lock)

    def test_strict_vector_schema_null_counts_and_private_fields(self):
        for change in ('schema','unknown','extra','extra-column','missing-surface','too-many-points'):
            with self.subTest(change=change):
                final,lock=valid_final();s=case_of(final)['sampleVectors']
                if change=='schema':s['schema']=True
                elif change=='unknown':s['unknown'][0]=0
                elif change=='extra':s['privateURL']='https://synthetic.invalid/SYNTHETIC_PRIVATE'
                elif change=='extra-column':s['global'][0].append(None)
                elif change=='missing-surface':s['surfaces'].pop()
                else:set_times(final,range(0,1935001,15000))
                self.assert_rejected(final,lock)

    def test_timestamp_and_latency_nonfinite_or_boolean_values_rejected(self):
        for bad in (math.nan,math.inf,True,False,1.5,-1):
            with self.subTest(bad=bad):
                final,lock=valid_final();case_of(final)['sampleVectors']['tMs'][1]=bad
                self.assert_rejected(final,lock)
                final,lock=valid_final();j=case_of(final)['journeyLatencies'];j['rows'][0][3]=bad;j['unknown'][0]=53
                self.assert_rejected(final,lock)

    def test_status_code_schema_mode_and_all_acceptance_flags(self):
        for key,bad in [('status','correct'),('code','r111-runtime-error'),('schema','r111-long-session-v1'),
                        ('mode','arbitrary'),('passed',True),('acceptance',True),('cleanupPassed',False),('caseExitCode',1)]:
            with self.subTest(key=key):
                final,lock=valid_final();case_of(final)[key]=bad
                self.assert_rejected(final,lock)

    def test_all_seven_gates_stay_open(self):
        for change in ('missing','duplicate','replace','closed-global'):
            with self.subTest(change=change):
                final,lock=valid_final();gates=case_of(final)['openGates']
                if change=='missing':gates.pop()
                elif change=='duplicate':gates[-1]=gates[0]
                elif change=='replace':gates[-1]='candidate-accepted'
                else:final['allProductAcceptanceGates']='CLOSED'
                self.assert_rejected(final,lock)

    def test_scope_exact_seven_fields_and_types(self):
        for key in SCOPE:
            with self.subTest(key=key):
                final,lock=valid_final();case_of(final)['scope'][key]='wrong'
                self.assert_rejected(final,lock)
        final,lock=valid_final();case_of(final)['scope']['private']='SYNTHETIC_PRIVATE'
        self.assert_rejected(final,lock)
        final,lock=valid_final();case_of(final)['scope']['overlays']=True
        self.assert_rejected(final,lock)

    def test_outer_inner_and_case_cleanup_are_required(self):
        changes=[lambda f:f.__setitem__('passed',False),lambda f:f.__setitem__('cleanupPassed',False),
                 lambda f:f['result'].__setitem__('passed',False),lambda f:f['result'].__setitem__('orphanReaped',False),
                 lambda f:f['result'].__setitem__('control','memory'),lambda f:f['result'].__setitem__('intentionalNegative',True),
                 lambda f:case_of(f).__setitem__('cleanupPassed',False)]
        for i,change in enumerate(changes):
            with self.subTest(change=i):
                final,lock=valid_final();change(final);self.assert_rejected(final,lock)

    def test_exact_container_exit_removal_and_no_oom(self):
        for key,bad in [('running',True),('pid',12),('removed',False),('exitCode',1),('oomKilled',True)]:
            with self.subTest(key=key):
                final,lock=valid_final();final['containerCleanup'][key]=bad
                self.assert_rejected(final,lock)
        final,lock=valid_final();final.pop('containerCleanup');self.assert_rejected(final,lock)

    def test_source_lock_identity_manifest_and_nonempty_files(self):
        for key,bad in [('schemaVersion',True),('sourceCommit','0'*40),('verification','unverified'),
                        ('manifestSha256','0'*64),('files',[])]:
            with self.subTest(key=key):
                final,lock=valid_final();lock[key]=bad
                if key=='files':
                    lock['manifestSha256']=hashlib.sha256(b'[]').hexdigest()
                    case_of(final)['sourceManifestSha256']=lock['manifestSha256']
                self.assert_rejected(final,lock)
        final,lock=valid_final();lock['files'][0]['bytes']+=1;self.assert_rejected(final,lock)
        final,lock=valid_final();case_of(final)['sourceManifestSha256']='e'*64;self.assert_rejected(final,lock)

    def test_case_source_fixture_harness_and_node_hash_identity(self):
        for key,bad in [('sourcePin','0'*40),('fixtureSha256','0'*64),('harnessManifestSha256','0'*64),('nodeSha256','0'*64)]:
            with self.subTest(key=key):
                final,lock=valid_final();case_of(final)[key]=bad;self.assert_rejected(final,lock)
        final,lock=valid_final();final['provenance']['nodeSha256']='a'*64;self.assert_rejected(final,lock)
        final,lock=valid_final();final['sourceCommit']='0'*40;self.assert_rejected(final,lock)
        final,lock=valid_final();final['baseline']['image']='synthetic-wrong-image';self.assert_rejected(final,lock)

    def test_exact_count_metrics_and_no_partial_network_drain(self):
        for key,bad in [('targetDurationMs',1799999),('operations',53),('mutations',44),('closedPages',2),('networkPending',1)]:
            with self.subTest(key=key):
                final,lock=valid_final();case_of(final)['metrics'][key]=bad;self.assert_rejected(final,lock)

    def test_duration_boundary_values_are_inclusive(self):
        ranges={'timedDurationMs':(1800000,1810000),'observedTimedDurationMs':(1800000,1815000),'elapsedMs':(1800000,2000000)}
        for key,(lo,hi) in ranges.items():
            for value in (lo,hi):
                with self.subTest(key=key,value=value):
                    final,lock=valid_final();case_of(final)['metrics'][key]=value
                    self.assertIs(scoped_observed(final,lock),True)

    def test_duration_outside_ranges_and_nonfinite_booleans_rejected(self):
        ranges={'timedDurationMs':(1800000,1810000),'observedTimedDurationMs':(1800000,1815000),'elapsedMs':(1800000,2000000)}
        for key,(lo,hi) in ranges.items():
            for bad in (lo-1,hi+1,True,False,math.nan,math.inf,'1800000'):
                with self.subTest(key=key,bad=bad):
                    final,lock=valid_final();case_of(final)['metrics'][key]=bad;self.assert_rejected(final,lock)

    def test_missing_and_malformed_envelope_returns_false(self):
        final,lock=valid_final()
        for bad in (None,[],{},False):self.assert_rejected(bad,lock)
        for bad in (None,[],{},False):self.assert_rejected(final,bad)
        for key in ('result','provenance','sourceCommit','cleanupPassed'):
            value=copy.deepcopy(final);value.pop(key);self.assert_rejected(value,lock)

if __name__=='__main__':unittest.main()
