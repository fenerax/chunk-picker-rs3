// Independent synthetic inventory tests. No runtime imports, listeners or saves.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scripts = fileURLToPath(new URL('../scripts/private-companion/', import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const q = value => `'${value.replaceAll("'", "''")}'`;
test('frozen inventory holds write/delete denial, catches additions, expires and releases every handle on refusal', {skip:process.platform !== 'win32'}, async t => {
  const root = await mkdtemp(path.join(os.tmpdir(),'operator-frozen-'));
  t.after(()=>rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:100}));
  const payload = path.join(root,'payload'); await mkdir(payload);
  const file = path.join(payload,'artifact.json'); await writeFile(file,'{"synthetic":true}');
  const pin = {path:file,sha256:hash(await readFile(file))};
  const seal = {schema:'rs3-frozen-release-v1',prepared:false,platformDigest:'f'.repeat(64),release:root,kit:root,identityDigest:'a'.repeat(64),
    createdAt:new Date(Date.now()-1000).toISOString(),expiresAt:new Date(Date.now()+60000).toISOString(),
    files:[pin],directories:[{path:payload,entries:['artifact.json']}],
    bindings:{currentPointerSha256:'b'.repeat(64),candidatePointerSha256:'c'.repeat(64),receiptSha256:'d'.repeat(64)},
    previousConfig:pin,rollback:{release:root,pointer:pin,config:pin,identityDigest:'e'.repeat(64)},
    forbiddenPaths:[path.join(root,'gates-pending.json')]};
  const sealPath = path.join(root,'seal.json'); await writeFile(sealPath,JSON.stringify(seal));
  const body = `$ErrorActionPreference='Stop'
. ${q(path.join(scripts,'Operator-Common.ps1'))}
. ${q(path.join(scripts,'ReleaseV2-Common.ps1'))}
function Must-Refuse([scriptblock]$Action) { $refused=$false;try{& $Action}catch{$refused=$true};if(-not $refused){throw 'Expected refusal'} }
$bundle=Open-ReleaseV2FrozenBundle ${q(sealPath)} ${q(hash(await readFile(sealPath)))}
try {
 Must-Refuse { [IO.File]::WriteAllText(${q(file)},'changed') }
 Must-Refuse { [IO.File]::Delete(${q(file)}) }
 Must-Refuse { [IO.File]::WriteAllText(${q(sealPath)},'changed') }
 $script:ReleaseV2FrozenPins=$bundle.files
 Assert-OperatorPin ([pscustomobject]@{path=${q(file)};sha256=${q(pin.sha256)}})
 Must-Refuse { Assert-OperatorPin ([pscustomobject]@{path=${q(file)};sha256=('f'*64)}) }
 [IO.File]::WriteAllText(${q(path.join(payload,'added'))},'new')
 Must-Refuse { Assert-ReleaseV2FrozenInventory $bundle }
 [IO.File]::Delete(${q(path.join(payload,'added'))})
 [IO.File]::WriteAllText(${q(seal.forbiddenPaths[0])},'pending')
 Must-Refuse { Assert-ReleaseV2FrozenInventory $bundle }
 [IO.File]::Delete(${q(seal.forbiddenPaths[0])})
 $bundle.expiresAt=[DateTimeOffset]::UtcNow.AddSeconds(-1)
 Must-Refuse { Assert-ReleaseV2FrozenInventory $bundle }
} finally { $script:ReleaseV2FrozenPins=$null;Close-ReleaseV2FrozenBundle $bundle }
Must-Refuse { Open-ReleaseV2FrozenBundle ${q(sealPath)} ('0'*64) }
[IO.File]::WriteAllText(${q(file)},'changed')
Must-Refuse { Open-ReleaseV2FrozenBundle ${q(sealPath)} ${q(hash(await readFile(sealPath)))} }
# A failure after opening a payload handle must release that handle too.
[IO.File]::WriteAllText(${q(file)},'released')
$clock=New-ReleaseV2Clock;$null=Set-ReleaseV2Phase $clock 'first';$null=Set-ReleaseV2Phase $clock 'second';$timing=Get-ReleaseV2Timings $clock
if($timing.phases.Count -ne 2 -or $timing.elapsedMs -lt 0 -or -not $timing.slowestPhase){throw 'Missing phase walls'}
$clock.phases.Clear();$clock.phases.Add([ordered]@{phase='small';elapsedMs=9.0});$clock.phases.Add([ordered]@{phase='largest';elapsedMs=100.0});$clock.phases.Add([ordered]@{phase='last';elapsedMs=20.0})
if((Get-ReleaseV2Timings $clock).slowestPhase -cne 'largest'){throw 'Slowest phase was not numeric maximum'}
Must-Refuse { Invoke-ReleaseV2Managed -CurrentRelease ${q(path.join(root,'absent-current.json'))} -CandidatePointer ${q(file)} -CompanionRoot ${q(root)} -Receipt ${q(file)} -ReleaseRoot ${q(root)} -FrozenSeal ${q(sealPath)} -FrozenSealSha256 ('0'*64) }
$receipt=Read-OperatorJson ${q(path.join(root,'.local/activation-phases.json'))}
if(-not $receipt.refused -or $receipt.storageChangesStarted -or $receipt.phase -ne 'frozen-input-validation' -or -not $receipt.timings.phases.Count){throw 'Missing seal-preflight phase receipt'}
Write-Output 'frozen inventory checks passed'
`;
  const fixture = path.join(root,'fixture.ps1'); await writeFile(fixture,body);
  const result = spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-File',fixture],{encoding:'utf8',timeout:30000,windowsHide:true});
  assert.equal(result.status,0,result.stdout+result.stderr);
  assert.match(result.stdout,/frozen inventory checks passed/);
});
