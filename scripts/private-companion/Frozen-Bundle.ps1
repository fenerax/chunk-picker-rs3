# A frozen bundle is a caller-pinned, expiring inventory. Read handles deny write
# and delete sharing until managed activation and its readiness checks finish.
Set-StrictMode -Version Latest

function Close-ReleaseV2FrozenBundle($Bundle) {
    if ($null -ne $Bundle) { foreach ($handle in $Bundle.handles) { $handle.Dispose() } }
}

function Resolve-ReleaseV2FrozenPath([string]$Path, $Topology, [switch]$Directory) {
    $full = Assert-OperatorAbsolute $Path
    $current = $full
    while ($current) {
        if (-not $Topology.ContainsKey($current)) {
            $attributes = [IO.File]::GetAttributes($current)
            if ($attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Frozen paths cannot contain links or junctions.' }
            $Topology.Add($current,$attributes)
        }
        $parent = [IO.Directory]::GetParent($current)
        if (-not $parent) { break }; $current = $parent.FullName
    }
    if ([bool]($Topology[$full] -band [IO.FileAttributes]::Directory) -ne [bool]$Directory) { throw 'Frozen path has the wrong type.' }
    return $full
}

function Assert-ReleaseV2FrozenInventory($Bundle) {
    $topology = [Collections.Generic.Dictionary[string,IO.FileAttributes]]::new([StringComparer]::OrdinalIgnoreCase)
    $now = [DateTimeOffset]::UtcNow
    if ($Bundle.createdAt -gt $now.AddMinutes(1) -or $Bundle.expiresAt -le $now) { throw 'Frozen bundle is not current.' }
    foreach ($path in $Bundle.seal.forbiddenPaths) {
        $null = Assert-OperatorAbsolute $path
        if (Test-Path -LiteralPath $path) { throw 'Frozen bundle has pending evidence.' }
    }
    foreach ($directory in $Bundle.seal.directories) {
        $path = Resolve-ReleaseV2FrozenPath $directory.path $topology -Directory
        [string[]]$actual = @([IO.Directory]::EnumerateFileSystemEntries($path) | ForEach-Object { [IO.Path]::GetFileName($_) })
        [Array]::Sort($actual, [StringComparer]::Ordinal)
        if ($actual.Count -ne $directory.entries.Count) { throw 'Frozen directory inventory changed.' }
        for ($index = 0; $index -lt $actual.Count; $index++) {
            if ($actual[$index] -cne $directory.entries[$index]) { throw 'Frozen directory inventory changed.' }
        }
    }
    # Held handles already deny write/delete/replacement of each known file.
    # Revalidate each unique containing directory and its ancestors freshly;
    # directory entry inventories above still detect extra or missing names.
    foreach ($path in $Bundle.parentDirectories) { $null = Resolve-ReleaseV2FrozenPath $path $topology -Directory }
}

function Open-ReleaseV2FrozenBundle([string]$Path, [string]$Sha256) {
    if ($Sha256 -cnotmatch '^[a-f0-9]{64}$') { throw 'Frozen bundle requires an exact SHA-256.' }
    $handles = [Collections.Generic.List[IO.FileStream]]::new()
    $bundle = [pscustomobject]@{ seal=$null; files=[Collections.Generic.Dictionary[string,string]]::new([StringComparer]::OrdinalIgnoreCase); handles=$handles; parentDirectories=[Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase); createdAt=$null; expiresAt=$null }
    try {
        $file = Assert-OperatorPath $Path
        $null = $bundle.parentDirectories.Add([IO.Path]::GetDirectoryName($file))
        $stream = [IO.File]::Open($file, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
        $handles.Add($stream)
        if ($stream.Length -gt 33554432) { throw 'Frozen seal is oversized.' }
        $sha = [Security.Cryptography.SHA256]::Create()
        try { $actual = ([BitConverter]::ToString($sha.ComputeHash($stream))).Replace('-','').ToLowerInvariant() } finally { $sha.Dispose() }
        if ($actual -cne $Sha256) { throw 'Frozen seal does not match its pin.' }
        $bundle.seal = Read-OperatorJson $file
        $seal = $bundle.seal
        $required = @('schema','release','kit','identityDigest','createdAt','expiresAt','files','directories','bindings','previousConfig','rollback','forbiddenPaths','prepared','platformDigest')
        $allowed = $required
        if (@($required | Where-Object { $_ -notin $seal.PSObject.Properties.Name }).Count -or @($seal.PSObject.Properties.Name | Where-Object { $_ -notin $allowed }).Count) { throw 'Invalid frozen seal fields.' }
        if ($seal.schema -cne 'rs3-frozen-release-v1' -or $seal.prepared -isnot [bool] -or $seal.prepared -or $seal.platformDigest -cnotmatch '^[a-f0-9]{64}$' -or $seal.identityDigest -cnotmatch '^[a-f0-9]{64}$' -or $seal.files -isnot [Array] -or $seal.directories -isnot [Array] -or $seal.forbiddenPaths -isnot [Array]) { throw 'Invalid frozen seal.' }
        $null = Assert-OperatorAbsolute $seal.release; $null = Assert-OperatorAbsolute $seal.kit
        $bundle.createdAt = [DateTimeOffset]::Parse($seal.createdAt, [Globalization.CultureInfo]::InvariantCulture)
        $bundle.expiresAt = [DateTimeOffset]::Parse($seal.expiresAt, [Globalization.CultureInfo]::InvariantCulture)
        if ($bundle.expiresAt -le $bundle.createdAt) { throw 'Invalid frozen validity window.' }
        Assert-OperatorFields $seal.bindings @('currentPointerSha256','candidatePointerSha256','receiptSha256')
        foreach ($binding in $seal.bindings.PSObject.Properties) { if ($binding.Value -cnotmatch '^[a-f0-9]{64}$') { throw 'Invalid frozen binding.' } }
        Assert-OperatorFields $seal.rollback @('release','pointer','config','identityDigest')
        $null = Assert-OperatorAbsolute $seal.rollback.release
        if ($seal.rollback.identityDigest -cnotmatch '^[a-f0-9]{64}$') { throw 'Invalid retained rollback identity.' }
        $topology = [Collections.Generic.Dictionary[string,IO.FileAttributes]]::new([StringComparer]::OrdinalIgnoreCase)
        foreach ($entry in $seal.files) {
            Assert-OperatorFields $entry @('path','sha256')
            if ($entry.sha256 -cnotmatch '^[a-f0-9]{64}$') { throw 'Invalid frozen file pin.' }
            $path = Resolve-ReleaseV2FrozenPath $entry.path $topology
            if ($path -ieq $file -or $bundle.files.ContainsKey($path)) { throw 'Duplicate frozen file.' }
            $input = [IO.File]::Open($path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
            $handles.Add($input)
            $sha = [Security.Cryptography.SHA256]::Create()
            try { $actual = ([BitConverter]::ToString($sha.ComputeHash($input))).Replace('-','').ToLowerInvariant() } finally { $sha.Dispose() }
            if ($actual -cne $entry.sha256) { throw 'Frozen input does not match its pin.' }
            $bundle.files.Add($path,$actual)
            $null = $bundle.parentDirectories.Add([IO.Path]::GetDirectoryName($path))
        }
        $seen = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
        foreach ($directory in $seal.directories) {
            Assert-OperatorFields $directory @('path','entries')
            $path = Resolve-ReleaseV2FrozenPath $directory.path $topology -Directory
            if (-not $seen.Add($path) -or $directory.entries -isnot [Array]) { throw 'Invalid frozen directory.' }
            $last = $null
            foreach ($name in $directory.entries) {
                if ($name -isnot [string] -or -not $name -or $name -match '[/\\]' -or $name -in @('.','..') -or ($null -ne $last -and [StringComparer]::Ordinal.Compare($last,$name) -ge 0)) { throw 'Invalid frozen directory entries.' }
                $last = $name
            }
        }
        foreach ($pin in @($seal.previousConfig,$seal.rollback.pointer,$seal.rollback.config)) { Assert-ReleaseV2FrozenPin $bundle $pin }
        Assert-ReleaseV2FrozenInventory $bundle
        return $bundle
    } catch { Close-ReleaseV2FrozenBundle $bundle; throw }
}

function Assert-ReleaseV2FrozenPin($Bundle, $Pin) {
    Assert-OperatorFields $Pin @('path','sha256')
    $path = Assert-OperatorAbsolute $Pin.path
    if (-not $Bundle.files.ContainsKey($path) -or $Bundle.files[$path] -cne $Pin.sha256) { throw 'Required input is absent from frozen inventory.' }
}

function Assert-ReleaseV2FrozenBundle($Bundle, $Candidate, $Previous, [string]$ReceiptPath, [string]$ReleaseRoot, [string]$KitRoot, [string]$CurrentPointerHash) {
    $seal = $Bundle.seal
    if ($seal.release -ine $ReleaseRoot -or $seal.kit -ine $KitRoot -or $seal.bindings.currentPointerSha256 -cne $CurrentPointerHash -or $seal.bindings.candidatePointerSha256 -cne $Candidate.sha256 -or $seal.bindings.receiptSha256 -cne (Get-ReleaseV2Hash $ReceiptPath)) { throw 'Frozen release bindings differ.' }
    if ($Bundle.files.ContainsKey($Previous.path) -or $Bundle.files.ContainsKey(($Previous.context.config.dataDir + '.dataset.json'))) { throw 'Mutable commit bindings cannot be frozen.' }
    if ($seal.previousConfig.path -ine $Previous.pointer.config.path -or $seal.previousConfig.sha256 -cne $Previous.pointer.config.sha256 -or $seal.rollback.config.path -ine $Previous.pointer.config.path -or $seal.rollback.config.sha256 -cne $Previous.pointer.config.sha256 -or $seal.rollback.pointer.sha256 -cne $Previous.sha256) { throw 'Frozen rollback pair differs.' }
    if ((Split-Path -Parent $seal.rollback.config.path) -ine $seal.rollback.release) { throw 'Frozen rollback root differs.' }
    $retained = Read-ReleaseV2Pointer $seal.rollback.pointer.path
    if ($retained.sha256 -cne $Previous.sha256 -or $retained.context.configHash -cne $Previous.context.configHash) { throw 'Frozen rollback reference differs.' }
    $required = @($Candidate.path,$Candidate.pointer.config.path,$ReceiptPath,(Join-Path $ReleaseRoot 'release.json'),(Join-Path $ReleaseRoot 'release-gate/gates.json'),$Candidate.context.config.nodePath,$Candidate.context.config.publicOriginFile)
    foreach ($name in 'release-v2.mjs','verify-install.mjs','release-pack-check.mjs','release-identity.mjs','frozen-release.mjs') { $required += Join-Path $KitRoot ('tools/' + $name) }
    foreach ($name in 'Managed-ReleaseV2.ps1','ReleaseV2-Common.ps1','Operator-Common.ps1','Frozen-Bundle.ps1') { $required += Join-Path $PSScriptRoot $name }
    foreach ($path in $required) { if (-not $Bundle.files.ContainsKey((Assert-OperatorAbsolute $path))) { throw 'Frozen release omits a required activation input.' } }
    foreach ($name in @('release.json','release-plan.json')) {
        $path = Join-Path $seal.rollback.release $name
        if (-not $Bundle.files.ContainsKey($path)) { throw 'Frozen release omits retained rollback evidence.' }
    }
    $pending = Join-Path $ReleaseRoot 'release-gate/gates-pending.json'
    if ($pending -notin $seal.forbiddenPaths) { throw 'Frozen release omits pending-evidence refusal.' }
    $identity = Read-OperatorJson (Join-Path $ReleaseRoot 'release.json')
    if ($identity.identity.digest -cne $seal.identityDigest) { throw 'Frozen identity differs.' }
    $oldIdentity = Read-OperatorJson (Join-Path $seal.rollback.release 'release.json')
    if ($oldIdentity.identity.digest -cne $seal.rollback.identityDigest) { throw 'Frozen rollback identity differs.' }
    Assert-ReleaseV2FrozenInventory $Bundle
}
