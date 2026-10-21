# Private scheduler preparation. Dot-sourcing performs no scheduler IO.
Set-StrictMode -Version Latest

function Read-CoreTaskXml([string]$Text) {
    if (-not $Text -or $Text.Length -gt 1048576) { throw 'Invalid bounded task XML.' }
    $settings = [Xml.XmlReaderSettings]::new()
    $settings.DtdProcessing = [Xml.DtdProcessing]::Prohibit
    $settings.XmlResolver = $null
    $reader = [Xml.XmlReader]::Create([IO.StringReader]::new($Text), $settings)
    $doc = [Xml.XmlDocument]::new()
    $doc.XmlResolver = $null
    $doc.PreserveWhitespace = $true
    try { $doc.Load($reader) } finally { $reader.Dispose() }
    if ($doc.DocumentElement.LocalName -cne 'Task' -or $doc.DocumentElement.NamespaceURI -cne 'http://schemas.microsoft.com/windows/2004/02/mit/task') { throw 'Invalid scheduled task document.' }
    $actions = @($doc.SelectNodes('/*[local-name()="Task"]/*[local-name()="Actions"]'))
    if ($actions.Count -ne 1 -or @($actions[0].ChildNodes | Where-Object { $_ -is [Xml.XmlElement] }).Count -ne 1) { throw 'Exactly one task action is required.' }
    $exec = $actions[0].SelectSingleNode('*')
    if ($exec.LocalName -cne 'Exec') { throw 'Task requires a single Exec action.' }
    $fields = @($exec.ChildNodes | Where-Object { $_ -is [Xml.XmlElement] } | ForEach-Object { $_.LocalName })
    if ($fields.Count -ne 3 -or @('Command', 'Arguments', 'WorkingDirectory' | Where-Object { $_ -notin $fields }).Count) { throw 'Task Exec fields must be explicit.' }
    # Refuse before printing any current or desired action content.
    $triggers = $doc.SelectSingleNode('/*[local-name()="Task"]/*[local-name()="Triggers"]')
    if (-not $triggers) { throw 'Explicit task triggers required.' }
    $printable = $actions[0].InnerText + ' ' + $triggers.InnerText
    if ($printable -match '(?i)https?://|bearer|/join/|token|(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])') { throw 'Task action or trigger contains forbidden credential or origin text.' }
    return ,$doc
}

function ConvertTo-CoreTaskSemanticNode([Xml.XmlNode]$Node) {
    if ($Node -is [Xml.XmlElement]) {
        $attributes = @($Node.Attributes | Where-Object { $_.NamespaceURI -ne 'http://www.w3.org/2000/xmlns/' } | Sort-Object NamespaceURI, LocalName | ForEach-Object { @($_.NamespaceURI, $_.LocalName, $_.Value) | ConvertTo-Json -Compress })
        $children = @($Node.ChildNodes | Where-Object { $_ -is [Xml.XmlElement] -or $_ -is [Xml.XmlText] -or $_ -is [Xml.XmlCDataSection] } | ForEach-Object { ConvertTo-CoreTaskSemanticNode $_ })
        return (@($Node.NamespaceURI, $Node.LocalName, $attributes, $children) | ConvertTo-Json -Compress -Depth 100)
    }
    return (@('text', $Node.Value) | ConvertTo-Json -Compress)
}

function Test-CoreTaskXmlEqual([string]$Left, [string]$Right) {
    $leftDoc = Read-CoreTaskXml $Left
    $rightDoc = Read-CoreTaskXml $Right
    return (ConvertTo-CoreTaskSemanticNode $leftDoc.DocumentElement) -ceq (ConvertTo-CoreTaskSemanticNode $rightDoc.DocumentElement)
}

function Read-CoreTaskPlan([string]$Plan, [switch]$ForRestore) {
    $file = Assert-OperatorPath $Plan
    $value = Read-OperatorJson $file
    Assert-OperatorFields $value @('schemaVersion', 'watchdog', 'backup', 'config', 'watchScript', 'pwshPath', 'workingDirectory', 'mockDirectory')
    if ($value.schemaVersion -notin @(1, 2)) { throw 'Unsupported task plan schema.' }
    foreach ($kind in 'watchdog', 'backup') {
        $target = $value.$kind
        Assert-OperatorFields $target @('name', 'taskPath', 'xml')
        if ($target.name -isnot [string] -or $target.name -notmatch '^[A-Za-z0-9][A-Za-z0-9 _.-]{0,127}$' -or $target.taskPath -cne '\') { throw 'Task names and root task path must be explicit.' }
        Assert-OperatorPin $target.xml
        $null = Read-CoreTaskXml ([IO.File]::ReadAllText($target.xml.path))
    }
    if ($value.watchdog.name -ieq $value.backup.name) { throw 'Task names must be distinct.' }
    # Recovery needs retained original XML and action metadata, even if the
    # candidate files that caused the failed cutover are missing or corrupt.
    Assert-OperatorPin $value.config -MetadataOnly:$ForRestore
    Assert-OperatorPin $value.watchScript -MetadataOnly:$ForRestore
    $value.pwshPath = if ($ForRestore) { Assert-OperatorAbsolute $value.pwshPath } else { Assert-OperatorPath $value.pwshPath }
    $value.workingDirectory = if ($ForRestore) { Assert-OperatorAbsolute $value.workingDirectory } else { Assert-OperatorPath $value.workingDirectory -Directory }
    if ($null -ne $value.mockDirectory) {
        $value.mockDirectory = Assert-OperatorPath $value.mockDirectory -Directory
        if ($value.watchdog.name -cnotlike 'M7 rehearsal *' -or $value.backup.name -cnotlike 'M7 rehearsal *') { throw 'Mock task names must begin with M7 rehearsal .' }
    }
    # Validate constructed XML too before exposing any plan text.
    $null = Get-CoreTaskTargets $value
    return $value
}

function Get-CoreTaskTargets($Plan) {
    $targets = @()
    foreach ($kind in 'watchdog', 'backup') {
        $target = $Plan.$kind
        $original = [IO.File]::ReadAllText($target.xml.path)
        $doc = Read-CoreTaskXml $original
        $desired = $original
        if ($kind -eq 'watchdog') {
            $exec = $doc.SelectSingleNode('/*[local-name()="Task"]/*[local-name()="Actions"]/*[local-name()="Exec"]')
            $exec.SelectSingleNode('*[local-name()="Command"]').InnerText = 'conhost.exe'
            $referenceArguments = if ($Plan.schemaVersion -eq 2) { ' -CurrentRelease "' + $Plan.config.path + '"' } else { ' -Config "' + $Plan.config.path + '" -ConfigSha256 ' + $Plan.config.sha256 }
            $exec.SelectSingleNode('*[local-name()="Arguments"]').InnerText = '--headless "' + $Plan.pwshPath + '" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + $Plan.watchScript.path + '"' + $referenceArguments
            $exec.SelectSingleNode('*[local-name()="WorkingDirectory"]').InnerText = $Plan.workingDirectory
            $desired = $doc.OuterXml
            $null = Read-CoreTaskXml $desired
        }
        $targets += [pscustomobject]@{ kind = $kind; name = $target.name; taskPath = $target.taskPath; originalXml = $original; desiredXml = $desired; originalPath = $target.xml.path }
    }
    return $targets
}

function Get-CoreTaskCurrentXml($Plan, $Target) {
    if ($null -ne $Plan.mockDirectory) {
        $path = Join-Path $Plan.mockDirectory ($Target.name + '.xml')
        $null = Assert-OperatorPath $path
        return [IO.File]::ReadAllText($path)
    }
    # Exact task name lookup: cmdlet -TaskName accepts wildcards, so filter again.
    $found = @(Get-ScheduledTask -TaskPath $Target.taskPath -TaskName $Target.name -ErrorAction Stop | Where-Object { $_.TaskName -ceq $Target.name -and $_.TaskPath -ceq $Target.taskPath })
    if ($found.Count -ne 1) { throw 'Expected exact existing scheduled task was not found.' }
    return Export-ScheduledTask -TaskName $Target.name -TaskPath $Target.taskPath -ErrorAction Stop
}

function Set-CoreTaskXml($Plan, $Target, [string]$Xml, [switch]$Original) {
    if ($null -ne $Plan.mockDirectory) {
        $path = Join-Path $Plan.mockDirectory ($Target.name + '.xml')
        $null = Assert-OperatorPath $path
        if ($Original) { [IO.File]::WriteAllBytes($path, [IO.File]::ReadAllBytes($Target.originalPath)) }
        else { [IO.File]::WriteAllText($path, $Xml, [Text.UTF8Encoding]::new($false)) }
        return
    }
    $null = Register-ScheduledTask -TaskName $Target.name -TaskPath $Target.taskPath -Xml $Xml -Force -ErrorAction Stop
}

function Get-CoreTaskXmlSummary([string]$Xml) {
    $doc = Read-CoreTaskXml $Xml
    return [ordered]@{
        actions = $doc.SelectSingleNode('/*[local-name()="Task"]/*[local-name()="Actions"]').OuterXml
        triggers = $doc.SelectSingleNode('/*[local-name()="Task"]/*[local-name()="Triggers"]').OuterXml
    }
}

function Invoke-CoreTaskChange($Plan, [switch]$Restore, [switch]$DryRun) {
    # Re-read pins on every invocation, including callers passing an object.
    foreach ($pin in @($Plan.watchdog.xml, $Plan.backup.xml)) { Assert-OperatorPin $pin }
    foreach ($pin in @($Plan.config, $Plan.watchScript)) { Assert-OperatorPin $pin -MetadataOnly:$Restore }
    $targets = @(Get-CoreTaskTargets $Plan)
    $states = @()
    foreach ($target in $targets) {
        $current = Get-CoreTaskCurrentXml $Plan $target
        $isOriginal = Test-CoreTaskXmlEqual $current $target.originalXml
        $isDesired = Test-CoreTaskXmlEqual $current $target.desiredXml
        if (-not $isOriginal -and -not $isDesired) { throw 'Scheduled task drift refused; no changes were made.' }
        $desired = if ($Restore) { $target.originalXml } else { $target.desiredXml }
        $states += [pscustomobject]@{ target = $target; current = $current; desired = $desired }
    }
    if ($DryRun) {
        [ordered]@{ schemaVersion = 1; operation = $(if ($Restore) { 'restore' } else { 'register' }); dryRun = $true;
            backend = $(if ($null -ne $Plan.mockDirectory) { 'mock' } else { 'scheduled-tasks' });
            tasks = @($states | ForEach-Object { [ordered]@{ name = $_.target.name; taskPath = $_.target.taskPath; current = Get-CoreTaskXmlSummary $_.current; desired = Get-CoreTaskXmlSummary $_.desired } }) } | ConvertTo-Json -Depth 8
        return
    }
    try {
        foreach ($state in $states) {
            # Detect drift introduced after preflight before touching each task.
            if (-not (Test-CoreTaskXmlEqual (Get-CoreTaskCurrentXml $Plan $state.target) $state.current)) { throw 'Scheduled task changed during registration.' }
            if ($Restore -or -not (Test-CoreTaskXmlEqual $state.current $state.desired)) { Set-CoreTaskXml $Plan $state.target $state.desired -Original:$Restore }
            if (-not (Test-CoreTaskXmlEqual (Get-CoreTaskCurrentXml $Plan $state.target) $state.desired)) { throw 'Scheduled task verification failed.' }
        }
    } catch {
        # Both accepted states are idempotent. If registration fails partway,
        # restore original XML only where the task is still an accepted state.
        $rollbackFailed = $false
        foreach ($target in $targets) {
            try {
                $current = Get-CoreTaskCurrentXml $Plan $target
                if ((Test-CoreTaskXmlEqual $current $target.originalXml) -or (Test-CoreTaskXmlEqual $current $target.desiredXml)) {
                    Set-CoreTaskXml $Plan $target $target.originalXml -Original
                    if (-not (Test-CoreTaskXmlEqual (Get-CoreTaskCurrentXml $Plan $target) $target.originalXml)) { throw 'Task rollback verification failed.' }
                } else { $rollbackFailed = $true }
            } catch { $rollbackFailed = $true }
        }
        if ($rollbackFailed) { throw 'Task change failed; automatic original-XML rollback was incomplete. Keep cutover paused.' }
        throw 'Task change failed; both original task definitions were restored.'
    }
    Write-Output $(if ($Restore) { 'Original scheduled task definitions restored and verified.' } else { 'Pinned scheduled task definitions registered and verified.' })
}

function Invoke-CoreTaskRegistration($Plan, [switch]$DryRun) { Invoke-CoreTaskChange $Plan -DryRun:$DryRun }
function Invoke-CoreTaskRestoration($Plan, [switch]$DryRun) { Invoke-CoreTaskChange $Plan -Restore -DryRun:$DryRun }
