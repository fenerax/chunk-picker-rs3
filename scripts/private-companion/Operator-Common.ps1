# Private operator tooling. Dot-sourcing this file performs no IO or process action.
Set-StrictMode -Version Latest

function Assert-OperatorFields($Value, [string[]]$Names) {
    if (-not $Value -or $Value -is [Array]) { throw 'Invalid operator configuration object.' }
    $actual = @($Value.PSObject.Properties.Name)
    if (@($actual | Where-Object { $_ -notin $Names }).Count -or @($Names | Where-Object { $_ -notin $actual }).Count) { throw 'Unexpected or missing operator configuration field.' }
}

function Assert-OperatorAbsolute([string]$Path) {
    if (-not $Path -or $Path -notmatch '^[A-Za-z]:[/\\]' -or $Path -match '["\r\n]' -or $Path -match '[/\\]\.\.?([/\\]|$)') { throw 'Operator paths must be explicit fully qualified local drive paths.' }
    return [IO.Path]::GetFullPath($Path).TrimEnd('\', '/')
}

function Assert-OperatorPath([string]$Path, [switch]$Directory) {
    $null = Assert-OperatorAbsolute $Path
    $full = [IO.Path]::GetFullPath($Path).TrimEnd('\', '/')
    $current = $full
    while ($current) {
        $item = Get-Item -LiteralPath $current -Force -ErrorAction Stop
        if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Operator paths cannot contain links or junctions.' }
        $parent = [IO.Directory]::GetParent($current)
        if (-not $parent) { break }
        $current = $parent.FullName
    }
    $item = Get-Item -LiteralPath $full -Force
    if ([bool]$item.PSIsContainer -ne [bool]$Directory) { throw 'Operator path has the wrong type.' }
    return $full
}

function Invoke-OperatorForeground([string]$Executable, [string]$Arguments,
    [ValidateRange(1,650)][int]$TimeoutSeconds = 120) {
    # A background picker may retain inherited pipe handles despite its own log
    # redirection. Drain helper output privately, but wait only for its process.
    $child = [Diagnostics.Process]::new()
    $timedOut = $false
    try {
        $child.StartInfo = [Diagnostics.ProcessStartInfo]::new()
        $child.StartInfo.FileName = Assert-OperatorPath $Executable
        $child.StartInfo.Arguments = $Arguments
        $child.StartInfo.UseShellExecute = $false
        $child.StartInfo.CreateNoWindow = $true
        $child.StartInfo.RedirectStandardOutput = $true
        $child.StartInfo.RedirectStandardError = $true
        $null = $child.Start()
        # Retain the exact launched foreground handle. An overrun can terminate
        # only this helper, never a picker PID or its background process tree.
        $child.Handle | Out-Null
        $child.BeginOutputReadLine()
        $child.BeginErrorReadLine()
        if (-not $child.WaitForExit([int]($TimeoutSeconds * 1000))) {
            $timedOut = $true
            if (-not $child.HasExited) { $child.Kill(); $null = $child.WaitForExit(5000) }
            throw 'Foreground operator helper exceeded its deadline.'
        }
        if ($child.ExitCode -ne 0) { throw 'Foreground operator helper refused.' }
    } catch {
        # Process exceptions can include paths or command arguments. Expose only
        # fixed status messages, without helper output or exception details.
        if ($timedOut) { throw 'Foreground operator helper exceeded its deadline.' }
        throw 'Foreground operator helper refused.'
    } finally { $child.Dispose() }
}

function Convert-OperatorJsonValue($Value) {
    # PS7 JSON uses Int64 and eagerly parses ISO dates. Preserve the PS5 contract
    # without accepting fractions, overflowing integers or losing CIM precision.
    if ($Value -is [long] -and $Value -ge [int]::MinValue -and $Value -le [int]::MaxValue) { return [int]$Value }
    if ($Value -is [DateTime]) { return $Value.ToUniversalTime().ToString('o') }
    if ($Value -is [Array]) {
        for ($index=0; $index -lt $Value.Count; $index++) { $Value[$index] = Convert-OperatorJsonValue $Value[$index] }
        return ,$Value
    }
    if ($Value -is [pscustomobject]) {
        foreach ($property in $Value.PSObject.Properties) { $property.Value = Convert-OperatorJsonValue $property.Value }
    }
    return $Value
}

function Read-OperatorJson([string]$Path) {
    try {
        if ((Get-Item -LiteralPath $Path).Length -gt 33554432) { throw 'Oversize JSON.' }
        return Convert-OperatorJsonValue ([IO.File]::ReadAllText($Path) | ConvertFrom-Json)
    } catch { throw 'Cannot read bounded operator JSON.' }
}

function Assert-OperatorPin($Pin, [switch]$MetadataOnly) {
    Assert-OperatorFields $Pin @('path', 'sha256')
    if ($Pin.sha256 -cnotmatch '^[a-f0-9]{64}$') { throw 'Invalid operator SHA-256 pin.' }
    $null = Assert-OperatorAbsolute $Pin.path
    if ($MetadataOnly) { return }
    $file = Assert-OperatorPath $Pin.path
    # Only the managed operation installs this map, after hashing and retaining
    # deny-write/delete file handles. Never cache an ordinary configuration pin.
    $frozen = Get-Variable -Name ReleaseV2FrozenPins -Scope Script -ErrorAction SilentlyContinue
    if ($null -ne $frozen -and $null -ne $frozen.Value -and $frozen.Value.ContainsKey($file)) {
        if ($frozen.Value[$file] -cne $Pin.sha256) { throw 'Operator input differs from its frozen pin.' }
        return
    }
    $hash = [Security.Cryptography.SHA256]::Create()
    $stream = [IO.File]::OpenRead($file)
    try { $actual = ([BitConverter]::ToString($hash.ComputeHash($stream))).Replace('-', '').ToLowerInvariant() }
    finally { $stream.Dispose(); $hash.Dispose() }
    if ($actual -cne $Pin.sha256) { throw 'Operator input does not match its SHA-256 pin.' }
}

function Read-OperatorConfig([string]$Path, [switch]$ForStop, [switch]$ForDryRun) {
    $file = Assert-OperatorPath $Path
    $config = Read-OperatorJson $file
    Assert-OperatorFields $config @('schemaVersion', 'coreRoot', 'dataDir', 'nodePath', 'host', 'port', 'loopbackPort', 'publicOriginFile', 'packsDir', 'selection', 'packs', 'profile', 'addons', 'runtimeOptions')
    if ($config.schemaVersion -ne 1) { throw 'Unsupported operator schema.' }
    foreach ($field in 'coreRoot', 'dataDir', 'packsDir') {
        $config.$field = if ($ForStop) { Assert-OperatorAbsolute $config.$field } else { Assert-OperatorPath $config.$field -Directory }
    }
    $config.nodePath = if ($ForStop) { Assert-OperatorAbsolute $config.nodePath } else { Assert-OperatorPath $config.nodePath }
    if (-not $ForStop) { $null = Assert-OperatorPath (Join-Path $config.coreRoot 'app/server.mjs') }
    # Existing storage is mandatory: a typo must never create another game or credential.
    if (-not $ForStop) { $null = Assert-OperatorPath (Join-Path $config.dataDir 'state.json') }
    $null = Assert-OperatorPath (Join-Path $config.dataDir 'access-token')
    # Initial handover preparation must leave the sibling binding absent. A dry
    # run still verifies every other input and validates a binding path if present.
    # Every real Start retains the mandatory existing-binding check before IO.
    if (-not $ForStop -and (-not $ForDryRun -or (Test-Path -LiteralPath ($config.dataDir + '.dataset.json')))) {
        $null = Assert-OperatorPath ($config.dataDir + '.dataset.json')
    }
    $localDir = Split-Path -Parent $config.dataDir
    $config.publicOriginFile = Assert-OperatorPath $config.publicOriginFile
    if ($config.publicOriginFile -ine (Join-Path $localDir 'public-origin')) { throw 'Use the existing data parent public-origin sidecar.' }
    if ($config.host -notmatch '^(127\.0\.0\.1|100\.(?:\d{1,3}\.){2}\d{1,3})$') { throw 'Use a private listener address.' }
    $address = $null
    if (-not [Net.IPAddress]::TryParse($config.host, [ref]$address)) { throw 'Invalid private listener address.' }
    foreach ($port in @($config.port, $config.loopbackPort) | Where-Object { $null -ne $_ }) {
        if ($port -isnot [int] -or $port -lt 1024 -or $port -gt 65535) { throw 'Invalid explicit listener port.' }
    }
    if ($null -eq $config.port -or $config.port -eq $config.loopbackPort) { throw 'Listener ports must be distinct and explicit.' }
    if ((Get-Item -LiteralPath $config.publicOriginFile).Length -gt 4096) { throw 'Saved public origin is oversized.' }
    $origin = [IO.File]::ReadAllText($config.publicOriginFile).Trim()
    $uri = $null
    if (-not [Uri]::TryCreate($origin, [UriKind]::Absolute, [ref]$uri) -or $uri.Scheme -notin @('http', 'https') -or $uri.UserInfo -or $uri.Query -or $uri.Fragment -or $uri.AbsolutePath -ne '/' -or $origin -ne $uri.GetLeftPart([UriPartial]::Authority)) { throw 'Invalid saved public origin.' }
    Assert-OperatorPin $config.selection -MetadataOnly:$ForStop
    Assert-OperatorFields $config.packs @('data', 'rulesText', 'art')
    foreach ($kind in 'data', 'rulesText', 'art') { Assert-OperatorPin $config.packs.$kind -MetadataOnly:$ForStop }
    if (-not $ForStop) {
    $selection = Read-OperatorJson $config.selection.path
    Assert-OperatorFields $selection @('schemaVersion', 'data', 'rulesText', 'art')
    if ($selection.schemaVersion -ne 1) { throw 'Invalid pack selection schema.' }
    foreach ($kind in 'data', 'rulesText', 'art') {
        $choice = $selection.$kind
        Assert-OperatorFields $choice @('id', 'version', 'sha256')
        if ($choice.id -cne @{ data = 'duo-data'; rulesText = 'duo-rules-text'; art = 'duo-art' }[$kind] -or $choice.version -notmatch '^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$') { throw 'Invalid pinned private pack choice.' }
        Assert-OperatorPin $config.packs.$kind
        $expected = Join-Path (Join-Path (Join-Path $config.packsDir $choice.id) $choice.version) 'pack.json'
        if ([IO.Path]::GetFullPath($config.packs.$kind.path) -ine $expected -or $choice.sha256 -cne $config.packs.$kind.sha256) { throw 'Pinned pack and selected pack differ.' }
    }
    }
    foreach ($pin in @($config.profile, $config.addons) | Where-Object { $null -ne $_ }) { Assert-OperatorPin $pin -MetadataOnly:$ForStop }
    Assert-OperatorFields $config.runtimeOptions @('taskWorkerMode', 'workerIdleMs', 'backupDays', 'historyEntries')
    $options = $config.runtimeOptions
    if ($null -ne $options.taskWorkerMode -and $options.taskWorkerMode -notin @('process', 'thread')) { throw 'Invalid worker mode.' }
    foreach ($key in 'workerIdleMs', 'backupDays', 'historyEntries') {
        if ($null -ne $options.$key -and ($options.$key -isnot [int] -or $options.$key -lt 1)) { throw 'Invalid runtime option.' }
    }
    # Hash the whole configuration. This binds listener, origin bytes and every input pin.
    $sha = [Security.Cryptography.SHA256]::Create()
    try { $configHash = ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes(([IO.File]::ReadAllText($file)) + "`n" + $origin)))).Replace('-', '').ToLowerInvariant() }
    finally { $sha.Dispose() }
    return [pscustomobject]@{ config = $config; localDir = $localDir; origin = $origin; configHash = $configHash; runtimeFile = Join-Path $localDir 'server-runtime.json' }
}

function Show-OperatorPlan($Context, [string]$Operation) {
    $c = $Context.config
    [ordered]@{ operation = $Operation; dryRun = $true; coreRoot = $c.coreRoot; dataDir = $c.dataDir;
        host = $c.host; port = $c.port; loopbackPort = $c.loopbackPort; publicOrigin = '[redacted]';
        dataset = 'duo-legacy'; selectionSha256 = $c.selection.sha256; profilePinned = ($null -ne $c.profile);
        addonsPinned = ($null -ne $c.addons); runtimeOptions = $c.runtimeOptions;
        datasetBindingPresent = (Test-Path -LiteralPath ($c.dataDir + '.dataset.json'));
        storeLockPresent = (Test-Path -LiteralPath (Join-Path $c.dataDir 'store.lock'));
        recoveryLockPresent = (Test-Path -LiteralPath (Join-Path $c.dataDir 'store.lock.recovery')) } | ConvertTo-Json -Depth 5
}

function Enter-OperatorLock($Context) {
    # Same lock as the previous helpers, held through each operation.
    try { return [IO.File]::Open((Join-Path $Context.localDir 'helper.lock'), [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None) }
    catch { throw 'Another operator helper holds the process lock.' }
}

function Assert-OperatorLockOwner($Context, [IO.FileStream]$Owner) {
    if (-not $Owner.CanRead -or -not $Owner.CanWrite -or $Owner.Name -ine (Join-Path $Context.localDir 'helper.lock')) { throw 'Invalid managed operation lock owner.' }
}

function Start-OperatorDetached([string]$Executable, [string]$Arguments, [string]$WorkingDirectory,
    [string]$StandardOutput, [string]$StandardError) {
    # Start-Process on Windows PowerShell can leave the foreground pipe inherited
    # by the server even when stdout/stderr are redirected. Use an explicit native
    # handle allowlist: only NUL stdin and the two private log handles survive.
    if (-not ('ReleaseV2.DetachedProcess' -as [type])) {
        Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
namespace ReleaseV2 {
 public static class DetachedProcess {
  [StructLayout(LayoutKind.Sequential)] struct SA { public int nLength; public IntPtr descriptor; [MarshalAs(UnmanagedType.Bool)] public bool inherit; }
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] struct SI { public int cb; public string reserved, desktop, title; public int x,y,cx,cy,xCount,yCount,fill,flags; public short show,reserved2; public IntPtr reservedPtr,input,output,error; }
  [StructLayout(LayoutKind.Sequential)] struct SX { public SI si; public IntPtr attributes; }
  [StructLayout(LayoutKind.Sequential)] struct PI { public IntPtr process,thread; public int pid,tid; }
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr CreateFile(string name,uint access,uint share,ref SA security,uint disposition,uint flags,IntPtr template);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool InitializeProcThreadAttributeList(IntPtr list,int count,int flags,ref IntPtr size);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool UpdateProcThreadAttribute(IntPtr list,uint flags,IntPtr attribute,IntPtr value,IntPtr size,IntPtr previous,IntPtr returned);
  [DllImport("kernel32.dll")] static extern void DeleteProcThreadAttributeList(IntPtr list);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool CreateProcess(string application,StringBuilder command,IntPtr processSecurity,IntPtr threadSecurity,bool inherit,uint flags,IntPtr environment,string directory,ref SX startup,out PI info);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  static void Check(bool result) { if(!result) throw new Win32Exception(Marshal.GetLastWin32Error()); }
  public static Process Start(string exe,string args,string directory,string output,string error) {
   IntPtr invalid=new IntPtr(-1), input=invalid, stdout=invalid, stderr=invalid, list=IntPtr.Zero, handles=IntPtr.Zero;
   bool initialized=false; PI info=new PI();
   try {
    SA sa=new SA { nLength=Marshal.SizeOf(typeof(SA)), inherit=true };
    input=CreateFile("NUL",0x80000000,3,ref sa,3,0,IntPtr.Zero); Check(input!=invalid);
    stdout=CreateFile(output,0x40000000,3,ref sa,2,0,IntPtr.Zero); Check(stdout!=invalid);
    stderr=CreateFile(error,0x40000000,3,ref sa,2,0,IntPtr.Zero); Check(stderr!=invalid);
    IntPtr size=IntPtr.Zero; InitializeProcThreadAttributeList(IntPtr.Zero,1,0,ref size);
    list=Marshal.AllocHGlobal(size); Check(InitializeProcThreadAttributeList(list,1,0,ref size)); initialized=true;
    handles=Marshal.AllocHGlobal(IntPtr.Size*3); Marshal.Copy(new IntPtr[]{input,stdout,stderr},0,handles,3);
    Check(UpdateProcThreadAttribute(list,0,new IntPtr(0x20002),handles,new IntPtr(IntPtr.Size*3),IntPtr.Zero,IntPtr.Zero));
    SX sx=new SX(); sx.si.cb=Marshal.SizeOf(typeof(SX)); sx.si.flags=0x100; sx.si.input=input; sx.si.output=stdout; sx.si.error=stderr; sx.attributes=list;
    Check(CreateProcess(exe,new StringBuilder("\""+exe+"\" "+args),IntPtr.Zero,IntPtr.Zero,true,0x08080000,IntPtr.Zero,directory,ref sx,out info));
    Process child=Process.GetProcessById(info.pid); IntPtr retained=child.Handle; return child;
   } finally {
    if(info.thread!=IntPtr.Zero) CloseHandle(info.thread); if(info.process!=IntPtr.Zero) CloseHandle(info.process);
    if(initialized) DeleteProcThreadAttributeList(list); if(list!=IntPtr.Zero) Marshal.FreeHGlobal(list); if(handles!=IntPtr.Zero) Marshal.FreeHGlobal(handles);
    if(input!=invalid) CloseHandle(input); if(stdout!=invalid) CloseHandle(stdout); if(stderr!=invalid) CloseHandle(stderr);
   }
  }
 }
}
'@
    }
    return [ReleaseV2.DetachedProcess]::Start((Assert-OperatorPath $Executable), $Arguments,
        (Assert-OperatorPath $WorkingDirectory -Directory), $StandardOutput, $StandardError)
}

function Assert-OperatorStoreReleased($Context) {
    foreach ($name in 'store.lock', 'store.lock.recovery') {
        if (Test-Path -LiteralPath (Join-Path $Context.config.dataDir $name)) { throw 'Storage lock remains; verify its owner before retrying. No lock was deleted.' }
    }
    $pattern = '(?i)(?:^|\s)--data-dir\s+"?' + [regex]::Escape($Context.config.dataDir) + '"?(?:\s|$)'
    $writers = @(Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Where-Object { $_.CommandLine -match $pattern })
    if ($writers.Count) { throw 'A process still names this data directory. No writer was started.' }
}

function ConvertTo-OperatorUtc($Value) {
    # Windows PowerShell keeps ISO text; PowerShell 7 may already have parsed it.
    if ($Value -is [DateTime]) {
        if ($Value.Kind -eq [DateTimeKind]::Unspecified) { throw 'Recorded time has no zone.' }
        return $Value.ToUniversalTime()
    }
    if ($Value -isnot [string] -or $Value -notmatch '(?:Z|[+-]\d\d:\d\d)$') { throw 'Recorded time has no zone.' }
    return [DateTimeOffset]::Parse($Value, [Globalization.CultureInfo]::InvariantCulture).UtcDateTime
}

function Test-OperatorBeforeBoot($Value) {
    # Nothing that started before this computer last booted can still run.
    $boot = ([DateTime](Get-CimInstance Win32_OperatingSystem -ErrorAction Stop).LastBootUpTime).ToUniversalTime()
    if ($boot -gt [DateTime]::UtcNow) { throw 'Boot time is in the future.' }
    return (ConvertTo-OperatorUtc $Value) -lt $boot
}

function Get-OperatorOwnedProcess($Context, $Record) {
    if (-not $Record -or $Record.pid -isnot [int] -or $Record.pid -lt 1 -or -not $Record.processStartedAt -or $Record.configHash -cne $Context.configHash) { throw 'Missing or mismatched exact process ownership record.' }
    $process = Get-CimInstance Win32_Process -Filter "ProcessId = $($Record.pid)"
    if (-not $process) { return $null }
    # Windows reuses PIDs after a restart; a record from before the last boot
    # names a process that the restart ended, whatever now holds its PID.
    if (Test-OperatorBeforeBoot $Record.processStartedAt) { return $null }
    $c = $Context.config
    $serverPattern = '(?i)(?:^|\s)"?' + [regex]::Escape((Join-Path $c.coreRoot 'app/server.mjs')) + '"?(?:\s|$)'
    $dataPattern = '(?i)(?:^|\s)--data-dir\s+"?' + [regex]::Escape($c.dataDir) + '"?(?:\s|$)'
    $hostPattern = '(?i)(?:^|\s)--host\s+' + [regex]::Escape($c.host) + '(?:\s|$)'
    $portPattern = '(?i)(?:^|\s)--port\s+' + $c.port + '(?:\s|$)'
    if (-not $process.ExecutablePath -or $process.ExecutablePath -ine $c.nodePath -or $process.CommandLine -notmatch $serverPattern -or $process.CommandLine -notmatch $dataPattern -or $process.CommandLine -notmatch $hostPattern -or $process.CommandLine -notmatch $portPattern -or ([DateTime]$process.CreationDate).ToUniversalTime().Ticks -ne [DateTime]::Parse($Record.processStartedAt).ToUniversalTime().Ticks) { throw 'PID, creation time or command ownership changed. No process action was taken.' }
    return $process
}

function Test-OperatorListeners($Context, $Record) {
    if (-not (Get-OperatorOwnedProcess $Context $Record)) { return $false }
    $listeners = @(@{ address = $Context.config.host; port = $Context.config.port })
    if ($null -ne $Context.config.loopbackPort) { $listeners += @{ address = '127.0.0.1'; port = $Context.config.loopbackPort } }
    foreach ($listener in $listeners) {
        # Query only the configured port; never contact a responder without proving its owner.
        $sockets = @(Get-NetTCPConnection -State Listen -LocalPort $listener.port -ErrorAction SilentlyContinue | Where-Object { $_.LocalAddress -eq $listener.address })
        if (-not $sockets.Count) { return $false }
        if (@($sockets | Where-Object { $_.OwningProcess -ne $Record.pid }).Count) { throw 'Configured listener belongs to another process. No authenticated request was sent.' }
    }
    # PID reuse during the socket query must not authorize a request.
    if (-not (Get-OperatorOwnedProcess $Context $Record)) { return $false }
    return $true
}

function Write-OperatorRuntime($Context, $Record) {
    $temporary = $Context.runtimeFile + '.' + [Guid]::NewGuid().ToString('N') + '.tmp'
    $backup = $temporary + '.previous'
    try {
        [IO.File]::WriteAllText($temporary, ($Record | ConvertTo-Json -Depth 5), [Text.UTF8Encoding]::new($false))
        if (Test-Path -LiteralPath $Context.runtimeFile) { [IO.File]::Replace($temporary, $Context.runtimeFile, $backup) }
        else { [IO.File]::Move($temporary, $Context.runtimeFile) }
    } finally {
        if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary }
        if (Test-Path -LiteralPath $backup) { Remove-Item -LiteralPath $backup }
    }
}

function Get-OperatorToken($Context) {
    $token = [IO.File]::ReadAllText((Join-Path $Context.config.dataDir 'access-token')).Trim()
    if ($token -cnotmatch '^[A-Za-z0-9_-]{43}$') { throw 'Existing administrator credential is malformed.' }
    return $token
}

function Assert-OperatorPackJournal($Context, [switch]$PackTransitionReady, [IO.FileStream]$LockOwner) {
    $path = Join-Path $Context.localDir 'release-pack-transition.json'
    if (-not (Test-Path -LiteralPath $path)) { return }
    $null = Assert-OperatorPath $path
    $journal = Read-OperatorJson $path
    if ($journal.state -ne 'ready') {
        if (-not $PackTransitionReady -or $journal.state -ne 'starting' -or $null -eq $LockOwner) { throw 'Pending pack transition blocks Start; use managed recovery.' }
        Assert-OperatorLockOwner $Context $LockOwner
    }
    Assert-OperatorPin $journal.transition
    $hash = [Security.Cryptography.SHA256]::Create()
    try {
        foreach ($pair in @(@($journal.currentPointer,$journal.targetPointerSha256),@(($Context.config.dataDir+'.dataset.json'),$journal.toBindingSha256))) {
            $file = Assert-OperatorPath $pair[0]
            $actual = ([BitConverter]::ToString($hash.ComputeHash([IO.File]::ReadAllBytes($file)))).Replace('-','').ToLowerInvariant()
            if ($actual -cne $pair[1]) { throw 'Pack transition pair is unresolved.' }
        }
    } finally { $hash.Dispose() }
    $pointer = Read-OperatorJson $journal.currentPointer
    $selected = Read-OperatorConfig $pointer.config.path
    if ($selected.configHash -cne $Context.configHash) { throw 'Start does not identify the committed pack selection.' }
}

function Start-OperatorCore($Context, [int]$TimeoutSeconds, [switch]$PreservePause, [IO.FileStream]$LockOwner, [switch]$PackTransitionReady, $PhaseClock = $null) {
    if ($null -ne $PhaseClock) { $null = Set-ReleaseV2Phase $PhaseClock 'owned-start' }
    $lock = if ($null -ne $LockOwner) { Assert-OperatorLockOwner $Context $LockOwner; $LockOwner } else { Enter-OperatorLock $Context }
    $healthWatch = $null; $healthMetrics = $null
    try {
        Assert-OperatorPackJournal $Context -PackTransitionReady:$PackTransitionReady -LockOwner $lock
        if (Test-Path -LiteralPath $Context.runtimeFile) {
            $previous = Read-OperatorJson $Context.runtimeFile
            if (Get-OperatorOwnedProcess $Context $previous) { Write-Output 'The verified configured picker is already recorded.'; return }
            throw 'An old runtime record remains. Resolve it with its matching stop helper first.'
        }
        Assert-OperatorStoreReleased $Context
        # Validate existing credentials before a child can initialize authentication.
        $token = Get-OperatorToken $Context
        $null = Get-Command Get-NetTCPConnection -ErrorAction Stop
        $c = $Context.config
        $args = @('--expose-gc', ('"' + (Join-Path $c.coreRoot 'app/server.mjs') + '"'), '--data-dir', ('"' + $c.dataDir + '"'), '--host', $c.host, '--port', [string]$c.port)
        if ($null -ne $c.loopbackPort) { $args += @('--loopback-port', [string]$c.loopbackPort) }
        if ($null -ne $c.runtimeOptions.backupDays) { $args += @('--backup-days', [string]$c.runtimeOptions.backupDays) }
        if ($null -ne $c.runtimeOptions.historyEntries) { $args += @('--history-entries', [string]$c.runtimeOptions.historyEntries) }
        $saved = @{}
        foreach ($entry in @(Get-ChildItem Env: | Where-Object { $_.Name -like 'RS3_*' -or $_.Name -in @('NODE_OPTIONS', 'NODE_PATH') })) { $saved[$entry.Name] = $entry.Value; [Environment]::SetEnvironmentVariable($entry.Name, $null, 'Process') }
        try {
            $env:RS3_DATASET = 'duo-legacy'; $env:RS3_PACKS_DIR = $c.packsDir; $env:RS3_PACK_SELECTION = $c.selection.path
            $env:RS3_PUBLIC_ORIGIN = $Context.origin
            if ($null -ne $c.profile) { $env:RS3_DATASET_PROFILE = $c.profile.path; $env:RS3_DATASET_PROFILE_SHA256 = $c.profile.sha256 }
            if ($null -ne $c.addons) { $env:RS3_PRIVATE_ADDON = $c.addons.path; $env:RS3_PRIVATE_ADDON_SHA256 = $c.addons.sha256 }
            if ($null -ne $c.runtimeOptions.taskWorkerMode) { $env:RS3_TASK_WORKER_MODE = $c.runtimeOptions.taskWorkerMode }
            if ($null -ne $c.runtimeOptions.workerIdleMs) { $env:RS3_WORKER_IDLE_MS = [string]$c.runtimeOptions.workerIdleMs }
            $child = Start-OperatorDetached -Executable $c.nodePath -Arguments ($args -join ' ') -WorkingDirectory $c.coreRoot -StandardOutput (Join-Path $Context.localDir 'server.log') -StandardError (Join-Path $Context.localDir 'server-error.log')
        } finally {
            foreach ($entry in @(Get-ChildItem Env: | Where-Object { $_.Name -like 'RS3_*' -or $_.Name -in @('NODE_OPTIONS', 'NODE_PATH') })) { [Environment]::SetEnvironmentVariable($entry.Name, $null, 'Process') }
            foreach ($key in $saved.Keys) { [Environment]::SetEnvironmentVariable($key, $saved[$key], 'Process') }
        }
        # Hold a process handle while establishing the exact CIM creation timestamp.
        $child.Handle | Out-Null
        try {
            $process = Get-CimInstance Win32_Process -Filter "ProcessId = $($child.Id)"
            if (-not $process -or $child.HasExited) { throw 'Picker exited before ownership could be recorded.' }
            $record = [pscustomobject]@{ pid = [int]$child.Id; processStartedAt = ([DateTime]$process.CreationDate).ToUniversalTime().ToString('o'); configHash = $Context.configHash;
                state = 'starting'; projectRoot = $c.coreRoot; dataDir = $c.dataDir; executable = $c.nodePath; hostAddress = $c.host; port = $c.port }
            $null = Get-OperatorOwnedProcess $Context $record
            Write-OperatorRuntime $Context $record
        } catch { if (-not $child.HasExited) { $child.Kill(); $null = $child.WaitForExit(5000) }; throw 'Could not establish and persist process ownership; launched handle was stopped.' }
        if (-not $PreservePause) { Remove-Item -LiteralPath (Join-Path $Context.localDir 'picker-paused') -ErrorAction SilentlyContinue }
        if ($null -ne $PhaseClock) {
            $null = Set-ReleaseV2Phase $PhaseClock 'startup-and-authenticated-health'
            $healthMetrics = [ordered]@{polls=0;httpAttempts=0;httpSuccessfulResponses=0;httpReadyResponses=0;authenticatedReady=$false;pollingWallMs=0.0}
            $PhaseClock.startupHealth = $healthMetrics
            $healthWatch = [Diagnostics.Stopwatch]::StartNew()
        }
        $until = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
        do {
            if ($null -ne $healthMetrics) { $healthMetrics.polls++ }
            if (-not (Get-OperatorOwnedProcess $Context $record)) { throw 'Recorded picker exited during startup. Inspect private logs.' }
            $health = $null
            if (Test-OperatorListeners $Context $record) {
                if ($null -ne $healthMetrics) { $healthMetrics.httpAttempts++ }
                try {
                    $health = Invoke-RestMethod -Uri "http://$($c.host):$($c.port)/api/health" -Headers @{ Authorization = "Bearer $token" } -TimeoutSec 1
                    if ($null -ne $healthMetrics) { $healthMetrics.httpSuccessfulResponses++ }
                } catch { }
                if ($null -ne $healthMetrics -and $health -and $health.ready) { $healthMetrics.httpReadyResponses++ }
            }
            if ($health -and $health.ready -and (Test-OperatorListeners $Context $record)) {
                if ($null -ne $healthMetrics) { $healthMetrics.authenticatedReady=$true }
                $record.state = 'running'; Write-OperatorRuntime $Context $record; Write-Output 'Configured picker is ready. Existing saved access remains in use.'; return
            }
            Start-Sleep -Milliseconds 250
        } while ([DateTime]::UtcNow -lt $until)
        throw 'Readiness timed out. The recorded process remains managed; inspect private logs or use matching Stop.'
    } finally {
        if ($null -ne $healthWatch) { $healthWatch.Stop(); $healthMetrics.pollingWallMs=[Math]::Round($healthWatch.Elapsed.TotalMilliseconds,3) }
        if ($null -eq $LockOwner) { $lock.Dispose() }
    }
}

function Stop-OperatorCore($Context, [int]$TimeoutSeconds, [switch]$PreservePause, [IO.FileStream]$LockOwner) {
    $lock = if ($null -ne $LockOwner) { Assert-OperatorLockOwner $Context $LockOwner; $LockOwner } else { Enter-OperatorLock $Context }
    try {
        # Deliberate Stop must also pause a currently absent writer. Otherwise a
        # watchdog restart could win the gap between its Stop and Start helpers.
        if (-not $PreservePause) { Set-Content -LiteralPath (Join-Path $Context.localDir 'picker-paused') -Value ([DateTime]::UtcNow.ToString('o')) }
        if (-not (Test-Path -LiteralPath $Context.runtimeFile)) { Assert-OperatorStoreReleased $Context; Write-Output 'No managed writer remains.'; return }
        $record = Read-OperatorJson $Context.runtimeFile
        $process = Get-OperatorOwnedProcess $Context $record
        if ($process) {
            $record.state = 'stopping'; Write-OperatorRuntime $Context $record
            $until = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
            do {
                $process = Get-OperatorOwnedProcess $Context $record
                if (-not $process) { break }
                if (Test-OperatorListeners $Context $record) {
                    $token = Get-OperatorToken $Context
                    if (-not (Test-OperatorListeners $Context $record)) { throw 'Listener ownership changed before graceful shutdown.' }
                    try { $null = Invoke-RestMethod -Method Post -Uri "http://$($Context.config.host):$($Context.config.port)/api/shutdown" -Headers @{ Authorization = "Bearer $token" } -ContentType 'application/json' -Body '{}' -TimeoutSec 1 } catch { }
                }
                Start-Sleep -Milliseconds 250
            } while ([DateTime]::UtcNow -lt $until)
            if (Get-OperatorOwnedProcess $Context $record) { throw 'Graceful shutdown timed out. Writer and ownership record retained; rollback is blocked.' }
        }
        Assert-OperatorStoreReleased $Context
        Remove-Item -LiteralPath $Context.runtimeFile
        Write-Output 'Verified writer stopped and storage lock released. Existing data retained.'
    } finally { if ($null -eq $LockOwner) { $lock.Dispose() } }
}

function Assert-OperatorRollbackPair($New, $Previous) {
    foreach ($key in 'dataDir', 'host', 'port', 'loopbackPort', 'publicOriginFile', 'packsDir') {
        if ($New.config.$key -ine $Previous.config.$key) { throw 'Rollback must retain storage, sidecars, listeners and packs.' }
    }
    if ($New.origin -cne $Previous.origin -or $New.config.selection.sha256 -cne $Previous.config.selection.sha256) { throw 'Rollback must retain exact origin and pack selection.' }
    if ($New.config.coreRoot -ieq $Previous.config.coreRoot) { throw 'Rollback requires a distinct previous code root.' }
}
