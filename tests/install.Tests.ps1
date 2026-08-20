$ErrorActionPreference = 'Stop'

$installer = Join-Path $PSScriptRoot '..\installer\install.ps1'
$parseErrors = $null
[void][Management.Automation.Language.Parser]::ParseFile(
    $installer,
    [ref]$null,
    [ref]$parseErrors
)
if ($parseErrors.Count -gt 0) {
    throw ($parseErrors | Out-String)
}

$env:BANNERLORDCOOP_INSTALLER_TEST = '1'
try {
    . $installer
} finally {
    Remove-Item Env:BANNERLORDCOOP_INSTALLER_TEST -ErrorAction SilentlyContinue
}

$sampleClient = 'C:\Games\Mount & Blade II Bannerlord\Modules\Coop'
$sampleServer = 'C:\BannerlordCoop Server'
$clientSummary = (Show-InstallationComplete -ClientPath $sampleClient -NoWait 6>&1 | Out-String)
$bannerLines = @($clientSummary -split "`r?`n" | Select-Object -Skip 1 | Select-Object -First 15)
if (($bannerLines | Measure-Object -Property Length -Maximum).Maximum -gt 80 -or
    $clientSummary -notmatch '\|######\|' -or
    $clientSummary -notmatch [regex]::Escape("Client: $sampleClient") -or
    $clientSummary -match 'Dedicated server:' -or
    $clientSummary -match 'PARTY READY|party is ready' -or
    $clientSummary -notmatch 'Press Enter to close the installer\.') {
    throw 'The client-only completion summary is incomplete.'
}
$serverSummary = (Show-InstallationComplete -ServerPath $sampleServer -NoWait 6>&1 | Out-String)
if ($serverSummary -notmatch [regex]::Escape("Dedicated server: $sampleServer") -or
    $serverSummary -match 'Client:') {
    throw 'The server-only completion summary is incomplete.'
}
$combinedSummary = (Show-InstallationComplete -ClientPath $sampleClient -ServerPath $sampleServer -NoWait 6>&1 | Out-String)
if ($combinedSummary -notmatch [regex]::Escape("Client: $sampleClient") -or
    $combinedSummary -notmatch [regex]::Escape("Dedicated server: $sampleServer")) {
    throw 'The combined completion summary did not show both installation locations.'
}
$summaryLines = @($combinedSummary -split "`r?`n")
$completionLine = [array]::IndexOf($summaryLines, 'Installation complete!')
if ($completionLine -lt 1) {
    throw 'The completion summary did not contain the expected status line.'
}
$artLines = @($summaryLines[0..($completionLine - 1)] | Where-Object { $_.Length -gt 0 })
if ($artLines -notcontains ($artLines | Where-Object { $_ -match '\|######\|' } | Select-Object -First 1)) {
    throw 'The completion artwork did not include the twin war banners.'
}
if ($artLines | Where-Object { $_.Length -gt 80 }) {
    throw 'The completion artwork exceeds the 80-column installer window.'
}

if ((Get-ShortCommitSha ('a' * 40)) -ne 'aaaaaaa') {
    throw 'The nightly commit SHA was not shortened for display.'
}
if ((Get-NightlyDisplayDate '2026-08-14' '2026-08-15T05:50:41.0000000Z') -ne '2026-08-15') {
    throw 'A nightly completed after Central midnight did not use its completion date.'
}
if ((Get-NightlyDisplayDate '2026-08-14' '2026-08-15T04:59:59Z') -ne '2026-08-14') {
    throw 'A nightly completed before Central midnight used the next UTC date.'
}
if ((Get-NightlyDisplayDate '2026-08-14' 'invalid') -ne '2026-08-14') {
    throw 'An invalid nightly completion timestamp did not fall back to its release date.'
}

$root = Join-Path ([IO.Path]::GetTempPath()) ('BannerlordCoopInstallerTests-' + [guid]::NewGuid().ToString('N'))
try {
    $modules = Join-Path $root 'Mount & Blade II Bannerlord\Modules'
    New-Item -ItemType Directory -Path (Join-Path $root 'Mount & Blade II Bannerlord\bin\Win64_Shipping_Client') -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $modules 'Native') -Force | Out-Null
    New-Item -ItemType File -Path (Join-Path $modules 'Native\SubModule.xml') -Force | Out-Null

    if (-not (Test-BannerlordModulesPath $modules)) {
        throw 'A valid Bannerlord Modules path was rejected.'
    }
    if (Test-BannerlordModulesPath (Split-Path -Parent $modules)) {
        throw 'The game root was accepted where the Modules folder is required.'
    }
    if (Test-BannerlordModulesPath (Join-Path $root 'unrelated')) {
        throw 'An unrelated path was accepted as a Bannerlord Modules folder.'
    }
} finally {
    Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
}

$steamRoot = Join-Path ([IO.Path]::GetTempPath()) ('BannerlordCoopSteamRootTests-' + [guid]::NewGuid().ToString('N'))
try {
    $libraryFolder = Join-Path $steamRoot 'steamapps'
    New-Item -ItemType Directory -Path $libraryFolder -Force | Out-Null
    $usedDriveNames = @(Get-PSDrive -PSProvider FileSystem | ForEach-Object { $_.Name.ToUpperInvariant() })
    $missingDriveName = @(68..90 | ForEach-Object { ([char]$_).ToString() } | Where-Object { $usedDriveNames -notcontains $_ }) | Select-Object -First 1
    if (-not $missingDriveName) { throw 'The stale Steam library test requires an unavailable drive letter.' }
    $staleLibrary = $missingDriveName + ':\StaleSteamLibrary'
    $escapedLibrary = $staleLibrary.Replace('\', '\\')
    $availableLibrary = Join-Path $steamRoot 'secondary-library'
    New-Item -ItemType Directory -Path $availableLibrary -Force | Out-Null
    $escapedAvailableLibrary = $availableLibrary.Replace('\', '\\')
    Set-Content -LiteralPath (Join-Path $libraryFolder 'libraryfolders.vdf') -Value "`"libraryfolders`"`n{`n  `"0`" { `"path`" `"$escapedLibrary`" }`n  `"1`" { `"path`" `"$escapedAvailableLibrary`" }`n}"

    $detectedRoots = @(Get-SteamRoots -AdditionalRoots @($steamRoot, $staleLibrary))
    if ($detectedRoots -contains (Get-NormalizedPath $staleLibrary)) {
        throw 'An unavailable Steam library drive was accepted.'
    }
    if ($detectedRoots -notcontains (Get-NormalizedPath $steamRoot)) {
        throw 'The accessible Steam root was not retained.'
    }
    if ($detectedRoots -notcontains (Get-NormalizedPath $availableLibrary)) {
        throw 'An accessible Steam library from libraryfolders.vdf was not retained.'
    }
} finally {
    Remove-Item -LiteralPath $steamRoot -Recurse -Force -ErrorAction SilentlyContinue
}

$validManifest = [pscustomobject]@{
    version = 1
    releaseDate = '2026-08-03'
    builtAt = '2026-08-04T05:30:00Z'
    headSha = 'a' * 40
    client = [pscustomobject]@{
        fileName = 'Coop 08-03-2026.7z'
        bytes = 7000000
        sha256 = 'b' * 64
        publicUrl = $script:ClientArchiveUri
    }
    server = [pscustomobject]@{
        fileName = 'BannerlordCoop-DedicatedServer-Win64-2026-08-03-coop-aaaaaaa.7z'
        bytes = 4380000000
        sha256 = 'c' * 64
        publicUrl = $script:ServerArchiveUri
        incremental = [pscustomobject]@{
            version = 1
            layout = 'base-overlay-v1'
            baseFingerprint = 'd' * 64
            compatibleBaseFingerprints = @()
            base = [pscustomobject]@{
                fileName = 'BannerlordCoop-DedicatedServer-Win64-Base.7z'
                bytes = 4300000000
                sha256 = 'e' * 64
                publicUrl = 'https://bannerlordcoop-nightly-gateway.garrett-luskey.workers.dev/v1/artifacts/windows/base/v1/' + ('d' * 64) + '/' + ('e' * 64) + '/server-base.7z'
            }
            update = [pscustomobject]@{
                fileName = 'BannerlordCoop-DedicatedServer-Win64-Update.7z'
                bytes = 12000000
                sha256 = 'f' * 64
                publicUrl = 'https://bannerlordcoop-nightly-gateway.garrett-luskey.workers.dev/v1/artifacts/nightly/windows/updates/' + ('a' * 40) + '/' + ('1' * 40) + '/' + ('f' * 64) + '/server-update.7z'
            }
        }
    }
}
function Invoke-RestMethod {
    param($Method, $Uri, $Headers)
    return $script:ManifestResponse
}
$script:ManifestResponse = $validManifest
$script:NightlyAccessToken = 't' * 43
$result = Get-ReleaseManifest
if ($result.releaseDate -ne '2026-08-03') {
    throw 'A valid release manifest was rejected.'
}
$clientOnlyManifest = $validManifest.PSObject.Copy()
$clientOnlyManifest.PSObject.Properties.Remove('server')
$script:ManifestResponse = $clientOnlyManifest
$clientResult = Get-ReleaseManifest $true
if ($clientResult.client.publicUrl -ne $script:ClientArchiveUri) {
    throw 'A valid standalone client manifest was rejected.'
}
$script:ManifestResponse = $validManifest.PSObject.Copy()
$script:ManifestResponse.client = $validManifest.client.PSObject.Copy()
$script:ManifestResponse.client.publicUrl = 'https://example.invalid/Coop.7z'
$rejected = $false
try {
    Get-ReleaseManifest | Out-Null
} catch {
    $rejected = $true
}
if (-not $rejected) {
    throw 'A release manifest containing an untrusted client URL was accepted.'
}
$script:ManifestResponse = $validManifest.PSObject.Copy()
$script:ManifestResponse.server = $validManifest.server.PSObject.Copy()
$script:ManifestResponse.server.incremental = $validManifest.server.incremental.PSObject.Copy()
$script:ManifestResponse.server.incremental.update = $validManifest.server.incremental.update.PSObject.Copy()
$script:ManifestResponse.server.incremental.update.publicUrl = 'https://example.invalid/server-update.7z'
$rejected = $false
try { Get-ReleaseManifest | Out-Null } catch { $rejected = $true }
if (-not $rejected) {
    throw 'An incremental release containing an untrusted update URL was accepted.'
}

function Invoke-RestMethod {
    param($Method, $Uri, $Headers)
    $response = [pscustomobject]@{ StatusCode = 404 }
    $exception = [Net.WebException]::new('Not Found')
    Add-Member -InputObject $exception -MemberType NoteProperty -Name Response -Value $response -Force
    throw $exception
}
$rejectedMessage = $null
try { Get-ReleaseManifest | Out-Null } catch { $rejectedMessage = $_.Exception.Message }
if ($rejectedMessage -notmatch '^No matched Patron client and dedicated-server nightly has been published yet\.') {
    throw 'A missing combined nightly manifest did not produce the expected installer guidance.'
}
$rejectedMessage = $null
try { Get-ReleaseManifest $true | Out-Null } catch { $rejectedMessage = $_.Exception.Message }
if ($rejectedMessage -notmatch '^No Patron client nightly has been published yet\.') {
    throw 'A missing client nightly manifest did not produce the expected installer guidance.'
}

function Get-Archive {
    param($Uri, $Destination, $ExpectedBytes, $ExpectedSha256, $Label)
    New-Item -ItemType File -Path $Destination -Force | Out-Null
}
function Expand-SevenZipArchive {
    param($SevenZip, $Archive, $Destination)
    if ($Destination -like '*client-stage') {
        New-Item -ItemType Directory -Path (Join-Path $Destination 'Coop\bin\Win64_Shipping_Client') -Force | Out-Null
        New-Item -ItemType File -Path (Join-Path $Destination 'Coop\SubModule.xml') -Force | Out-Null
        New-Item -ItemType File -Path (Join-Path $Destination 'Coop\bin\Win64_Shipping_Client\Coop.Core.dll') -Force | Out-Null
        return
    }
    New-Item -ItemType Directory -Path (Join-Path $Destination 'engine\bin\Win64_Shipping_Server') -Force | Out-Null
    New-Item -ItemType File -Path (Join-Path $Destination 'engine\bin\Win64_Shipping_Server\TaleWorlds.Starter.DotNetCore.dll') -Force | Out-Null
    New-Item -ItemType File -Path (Join-Path $Destination 'engine\bin\Win64_Shipping_Server\DedicatedServer.Core.dll') -Force | Out-Null
    New-Item -ItemType File -Path (Join-Path $Destination 'engine\bin\Win64_Shipping_Server\TaleWorlds.Starter.DotNetCore.deps.json') -Force | Out-Null
    foreach ($name in @(
        'System.Diagnostics.DiagnosticSource.dll',
        'System.Threading.Channels.dll',
        'System.Collections.Immutable.dll',
        'System.Text.Json.dll',
        'System.Reflection.Metadata.dll',
        'System.Text.Encoding.CodePages.dll',
        'System.IO.Pipelines.dll',
        'System.Text.Encodings.Web.dll',
        'Microsoft.Bcl.AsyncInterfaces.dll'
    )) {
        New-Item -ItemType File -Path (Join-Path $Destination "engine\bin\Win64_Shipping_Server\$name") -Force | Out-Null
    }
    New-Item -ItemType Directory -Path (Join-Path $Destination 'engine\Modules\Native') -Force | Out-Null
    New-Item -ItemType File -Path (Join-Path $Destination 'engine\Modules\Native\SubModule.xml') -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $Destination 'engine\Modules\Coop\bin\Win64_Shipping_Server') -Force | Out-Null
    New-Item -ItemType File -Path (Join-Path $Destination 'engine\Modules\Coop\SubModule.xml') -Force | Out-Null
    New-Item -ItemType File -Path (Join-Path $Destination 'engine\Modules\Coop\bin\Win64_Shipping_Server\Coop.Core.dll') -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $Destination 'engine\Modules\DedicatedServer.Windows\bin\Win64_Shipping_Server') -Force | Out-Null
    New-Item -ItemType File -Path (Join-Path $Destination 'engine\Modules\DedicatedServer.Windows\SubModule.xml') -Force | Out-Null
    New-Item -ItemType File -Path (Join-Path $Destination 'engine\Modules\DedicatedServer.Windows\bin\Win64_Shipping_Server\DedicatedServer.Windows.dll') -Force | Out-Null
    New-Item -ItemType File -Path (Join-Path $Destination 'engine\Modules\DedicatedServer.Windows\bin\Win64_Shipping_Server\DedicatedServer.Core.dll') -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $Destination 'server-data\Game Saves') -Force | Out-Null
    New-Item -ItemType File -Path (Join-Path $Destination 'BannerlordCoopServer.exe') -Force | Out-Null
    New-Item -ItemType File -Path (Join-Path $Destination 'release-info.txt') -Force | Out-Null
    Set-Content -LiteralPath (Join-Path $Destination 'server-data\server-config.json') -Value 'new default'
    New-Item -ItemType File -Path (Join-Path $Destination 'server-data\Game Saves\default_new_game.sav') -Force | Out-Null
    New-Item -ItemType File -Path (Join-Path $Destination 'engine\bin\Win64_Shipping_Server\default_new_game.sav') -Force | Out-Null
    Set-Content -LiteralPath (Join-Path $Destination 'server-data\mod-config.json') -Value 'nightly seed'
}

$installRoot = Join-Path ([IO.Path]::GetTempPath()) ('BannerlordCoopInstallBehaviorTests-' + [guid]::NewGuid().ToString('N'))
try {
    $modules = Join-Path $installRoot 'game\Modules'
    $oldModule = Join-Path $modules 'Coop'
    New-Item -ItemType Directory -Path $oldModule -Force | Out-Null
    New-Item -ItemType File -Path (Join-Path $oldModule 'stale.dll') -Force | Out-Null
    $clientWork = Join-Path $installRoot 'client-work'
    New-Item -ItemType Directory -Path $clientWork -Force | Out-Null
    Install-Client $validManifest.client $modules 'unused.exe' $clientWork
    if (Test-Path -LiteralPath (Join-Path $oldModule 'stale.dll')) {
        throw 'The old client was not cleared before installation.'
    }
    if (-not (Test-Path -LiteralPath (Join-Path $oldModule 'bin\Win64_Shipping_Client\Coop.Core.dll'))) {
        throw 'The replacement client was not installed.'
    }

    $denied = Get-DeniedClientFileName ([UnauthorizedAccessException]::new("Access to the path 'C:\\Modules\\Coop\\bin\\Win64_Shipping_Client\\Coop.CrashReporter.exe' is denied."))
    if ($denied -cne 'Coop.CrashReporter.exe') {
        throw 'A locked CrashReporter path was not reduced to its file name.'
    }
    function Get-LockedClientProcesses {
        param($ClientPath)
        return @([pscustomobject]@{ ProcessName = 'Coop.CrashReporter'; Path = Join-Path $ClientPath 'bin\\Win64_Shipping_Client\\Coop.CrashReporter.exe' })
    }
    $runningMessage = Get-ClientReplacementFailure -ClientPath $oldModule
    if ($runningMessage -notmatch 'Coop.CrashReporter.exe is still running' -or
        $runningMessage -notmatch 'Close Bannerlord and Coop.CrashReporter.exe') {
        throw 'A running crash reporter did not produce the expected replacement guidance.'
    }
    function Get-LockedClientProcesses {
        param($ClientPath)
        return @()
    }
    $deniedMessage = Get-ClientReplacementFailure -ClientPath $oldModule -FailedPath 'Coop.CrashReporter.exe'
    if ($deniedMessage -notmatch [regex]::Escape("access to 'Coop.CrashReporter.exe' was denied")) {
        throw 'An access-denied client replacement did not name the locked file.'
    }

    $server = Join-Path $installRoot 'server'
    New-Item -ItemType Directory -Path (Join-Path $server 'server-data\Game Saves') -Force | Out-Null
    Set-Content -LiteralPath (Join-Path $server 'server-data\server-config.json') -Value 'my configuration'
    Set-Content -LiteralPath (Join-Path $server 'server-data\mod-config.json') -Value 'my gameplay configuration'
    Set-Content -LiteralPath (Join-Path $server 'server-data\Game Saves\saveauto1.sav') -Value 'my save'
    Install-Server $validManifest.server $server 'unused.exe'
    if ((Get-Content -LiteralPath (Join-Path $server 'server-data\server-config.json') -Raw).Trim() -ne 'my configuration') {
        throw 'An existing server configuration was overwritten.'
    }
    if ((Get-Content -LiteralPath (Join-Path $server 'server-data\Game Saves\saveauto1.sav') -Raw).Trim() -ne 'my save') {
        throw 'An existing server save was overwritten.'
    }
    if ((Get-Content -LiteralPath (Join-Path $server 'server-data\mod-config.json') -Raw).Trim() -ne 'my gameplay configuration') {
        throw 'An existing gameplay configuration was overwritten.'
    }
    if (-not (Test-Path -LiteralPath (Join-Path $server 'BannerlordCoopServer.exe'))) {
        throw 'The dedicated server was not installed.'
    }
    $state = Get-ServerInstallState $server
    if ($null -eq $state -or $state.baseFingerprint -ne ('d' * 64)) {
        throw 'The incremental install state was not recorded.'
    }
    $script:DownloadedLabels = @()
    function Get-Archive {
        param($Uri, $Destination, $ExpectedBytes, $ExpectedSha256, $Label)
        $script:DownloadedLabels += $Label
        New-Item -ItemType File -Path $Destination -Force | Out-Null
    }
    Install-Server $validManifest.server $server 'unused.exe'
    if ($script:DownloadedLabels -contains 'dedicated server base') {
        throw 'A matching incremental server base was downloaded again.'
    }
    if ($script:DownloadedLabels.Count -ne 0) {
        throw 'An already-current incremental server downloaded release data again.'
    }
    $nextRelease = $validManifest.server.PSObject.Copy()
    $nextRelease.incremental = $validManifest.server.incremental.PSObject.Copy()
    $nextRelease.incremental.base = $validManifest.server.incremental.base.PSObject.Copy()
    $nextRelease.incremental.update = $validManifest.server.incremental.update.PSObject.Copy()
    $nextRelease.incremental.base.sha256 = '8' * 64
    $nextRelease.incremental.base.publicUrl = 'https://bannerlordcoop-nightly-gateway.garrett-luskey.workers.dev/v1/artifacts/windows/base/v1/' + ('d' * 64) + '/' + ('8' * 64) + '/server-base.7z'
    $nextRelease.incremental.update.sha256 = '9' * 64
    $nextRelease.incremental.update.publicUrl = 'https://bannerlordcoop-nightly-gateway.garrett-luskey.workers.dev/v1/artifacts/nightly/windows/updates/' + ('a' * 40) + '/' + ('1' * 40) + '/' + ('9' * 64) + '/server-update.7z'
    $script:DownloadedLabels = @()
    Install-Server $nextRelease $server 'unused.exe'
    if ($script:DownloadedLabels.Count -ne 1 -or $script:DownloadedLabels[0] -ne 'dedicated server update') {
        throw 'A routine incremental update did not download exactly one small update artifact.'
    }
    if ((Get-ServerInstallState $server).updateSha256 -ne ('9' * 64)) {
        throw 'The incremental update state was not advanced.'
    }
    if ((Get-ServerInstallState $server).baseSha256 -ne ('e' * 64)) {
        throw 'A compatible overlay replaced the SHA of the base that is actually installed.'
    }
    if ((Get-Content -LiteralPath (Join-Path $server 'server-data\mod-config.json') -Raw).Trim() -ne 'my gameplay configuration') {
        throw 'A routine incremental update overwrote the gameplay configuration.'
    }
    $migratedRelease = $nextRelease.PSObject.Copy()
    $migratedRelease.incremental = $nextRelease.incremental.PSObject.Copy()
    $migratedRelease.incremental.update = $nextRelease.incremental.update.PSObject.Copy()
    $migratedRelease.incremental.baseFingerprint = '7' * 64
    $migratedRelease.incremental.compatibleBaseFingerprints = @('d' * 64)
    $migratedRelease.incremental.update.sha256 = '6' * 64
    $migratedRelease.incremental.update.publicUrl = 'https://bannerlordcoop-nightly-gateway.garrett-luskey.workers.dev/v1/artifacts/nightly/windows/updates/' + ('a' * 40) + '/' + ('1' * 40) + '/' + ('6' * 64) + '/server-update.7z'
    $script:DownloadedLabels = @()
    Install-Server $migratedRelease $server 'unused.exe'
    if ($script:DownloadedLabels.Count -ne 1 -or $script:DownloadedLabels[0] -ne 'dedicated server update') {
        throw 'A declared compatible legacy fingerprint triggered a full base download.'
    }
    $migratedState = Get-ServerInstallState $server
    if ($migratedState.baseFingerprint -ne ('7' * 64) -or $migratedState.baseSha256 -ne ('e' * 64)) {
        throw 'A compatible legacy base was not canonicalized without losing its actual SHA.'
    }
} finally {
    Remove-Item -LiteralPath $installRoot -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host 'Installer tests passed.'
