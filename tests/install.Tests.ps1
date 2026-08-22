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

function New-GatewayWebError {
    param(
        [Parameter(Mandatory = $true)][int]$StatusCode,
        [string]$ErrorCode = ''
    )

    $response = [pscustomobject]@{
        StatusCode = $StatusCode
        error = $ErrorCode
    }
    $exception = [Net.WebException]::new("Gateway $StatusCode")
    Add-Member -InputObject $exception -MemberType NoteProperty -Name Response -Value $response -Force
    $record = $null
    try { throw $exception } catch { $record = $_ }
    return $record
}

$pending = Get-NightlyTokenPollDecision -Response ([pscustomobject]@{ error = 'authorization_pending' })
if ($pending.Action -cne 'Continue') {
    throw 'A pending token JSON body aborted instead of continuing to poll.'
}
$accepted = Get-NightlyTokenPollDecision -Response ([pscustomobject]@{
    token_type = 'Bearer'
    access_token = 'n' * 43
    expires_in = 3600
})
if ($accepted.Action -cne 'Accept' -or $accepted.Token -cne ('n' * 43)) {
    throw 'A valid bearer token was not accepted.'
}
$used = Get-NightlyTokenPollDecision -Response ([pscustomobject]@{ error = 'already_used' })
if ($used.Action -cne 'Fail' -or $used.Message -notmatch 'already used') {
    throw 'An already-used verification did not tell the user to rerun the installer.'
}
$denied = Get-NightlyTokenPollDecision -ErrorRecord (New-GatewayWebError 403 'access_denied')
if ($denied.Action -cne 'Fail' -or $denied.Message -notmatch 'Discord access was denied') {
    throw 'A 403 token poll did not produce the access-denied guidance.'
}
$statusPending = Get-NightlyTokenPollDecision -ErrorRecord (New-GatewayWebError 428 'authorization_pending')
if ($statusPending.Action -cne 'Continue') {
    throw 'An HTTP 428 token poll did not continue waiting for Discord.'
}
$invalid = Get-NightlyTokenPollDecision -Response ([pscustomobject]@{ token_type = 'Basic'; access_token = 'nope' })
if ($invalid.Action -cne 'Fail' -or $invalid.Message -cne 'The nightly authorization token is invalid.') {
    throw 'A malformed success body did not keep the invalid-token message.'
}
$supportLines = @(Get-InstallationSupportLines)
if ($supportLines.Count -ne 2 -or
    $supportLines[0] -cne 'If a DNS tool such as GoodbyeDPI is interfering, try Cloudflare WARP or turn that tool off, then run the installer again.' -or
    $supportLines[1] -cne 'If you need help, copy this message and ask in the Bannerlord Coop Discord.') {
    throw 'Installer failure help omitted the GoodbyeDPI or Discord guidance.'
}
$diagnosedSupport = @(Get-InstallationSupportLines 'GoodbyeDPI is running and is blocking nightly authorization. Turn off GoodbyeDPI, or enable Cloudflare WARP, then run the installer again.')
if ($diagnosedSupport.Count -ne 1 -or
    $diagnosedSupport[0] -cne 'If you need help, copy this message and ask in the Bannerlord Coop Discord.') {
    throw 'A diagnosed authorization failure still repeated the generic DNS advice.'
}

if ((Get-NightlyDpiToolName @('GoodbyeDPI', 'chrome')) -cne 'GoodbyeDPI') {
    throw 'GoodbyeDPI was not recognized as a nightly-blocking DNS tool.'
}
if ((Get-NightlyDpiToolName @('winws')) -cne 'zapret') {
    throw 'zapret winws was not recognized as a nightly-blocking DNS tool.'
}
if ((Get-NightlyDpiToolName @('explorer', 'chrome')) -cne '') {
    throw 'An ordinary process list was treated as a DPI tool.'
}
if (-not (Test-NightlyPhoneQrRecommended -ProcessNames @('goodbyedpi'))) {
    throw 'GoodbyeDPI did not enable the phone verification QR.'
}
if (Test-NightlyPhoneQrRecommended -ProcessNames @('chrome')) {
    throw 'An ordinary process list requested a phone verification QR.'
}
$qrUrl = 'https://bannerlordcoop-nightly-gateway.garrett-luskey.workers.dev/activate?code=AB2D-EF3H'
$qrModules = Get-QrCodeModules $qrUrl
if ($qrModules.Length -ne 37 -or $qrModules[0].Length -ne 37) {
    throw 'The verification QR was not a version-5 matrix.'
}
$finder = '1111111'
if (($qrModules[0][0..6] -join '') -cne $finder -or
    ($qrModules[6][0..6] -join '') -cne $finder -or
    ($qrModules[0][30..36] -join '') -cne $finder -or
    ($qrModules[30][0..6] -join '') -cne $finder) {
    throw 'The verification QR is missing finder patterns.'
}
if (($qrModules[0] -join '') -cne '1111111000100010000101110011001111111') {
    throw 'The verification QR is not the scannable mask-7 layout.'
}
$qrText = Get-QrCodeText $qrUrl
if ($qrText -notmatch [char]0x2588 -or ($qrText -split "`r?`n" | Where-Object { $_.Length -gt 80 })) {
    throw 'The console QR was missing or wider than the installer window.'
}
$qrHtml = Get-NightlyPhoneVerificationHtml $qrUrl
if ($qrHtml -notmatch [regex]::Escape($qrUrl) -or $qrHtml -notmatch 'mobile data' -or $qrHtml -notmatch '<rect x="') {
    throw 'The phone verification page did not include a scannable QR for the activate URL.'
}
if (-not (Test-CloudflareWarpRunning @('warp-svc'))) {
    throw 'Cloudflare WARP was not detected from warp-svc.'
}
if (-not (Test-PrivateOrLocalAddress '192.168.1.1') -or (Test-PrivateOrLocalAddress '1.1.1.1')) {
    throw 'Private DNS hijack addresses were not classified correctly.'
}
if ((Get-NightlyHttpsInspectionProduct 'CN=Kaspersky Antivirus CA, O=Kaspersky Lab') -cne 'Kaspersky') {
    throw 'A Kaspersky intercepted certificate was not identified.'
}
if ((Get-NightlyHttpsInspectionProduct 'CN=WE1, O=Google Trust Services, C=US') -cne '') {
    throw 'A normal Cloudflare certificate was treated as HTTPS inspection.'
}
if ((Get-NightlyResponseInterceptKind '<html><title>Just a moment...</title></html>') -cne 'cloudflare_challenge') {
    throw 'A Cloudflare challenge page was not classified.'
}

$dpiDiagnosis = Get-NightlyAuthorizationDiagnosis -SessionResponse ([pscustomobject]@{}) -ProcessNames @('goodbyedpi') -TlsIssuer '' -DnsAddresses @('1.1.1.1') -WinDivertRunning $false
if ($dpiDiagnosis.Code -cne 'dpi_tool' -or $dpiDiagnosis.Message -notmatch 'Turn off GoodbyeDPI, or enable Cloudflare WARP') {
    throw 'A GoodbyeDPI process did not produce the turn-off-or-WARP action.'
}
$dpiWithWarp = Get-NightlyAuthorizationDiagnosis -SessionResponse ([pscustomobject]@{}) -ProcessNames @('goodbyedpi', 'warp-svc') -TlsIssuer '' -DnsAddresses @('1.1.1.1') -WinDivertRunning $false
if ($dpiWithWarp.Message -notmatch 'Turn off GoodbyeDPI, then run' -or $dpiWithWarp.Message -match 'enable Cloudflare WARP') {
    throw 'GoodbyeDPI running beside WARP still told the user to enable WARP.'
}
$avDiagnosis = Get-NightlyAuthorizationDiagnosis -SessionResponse ([pscustomobject]@{}) -ProcessNames @() -TlsIssuer 'CN=Bitdefender, O=Bitdefender' -DnsAddresses @('1.1.1.1') -WinDivertRunning $false
if ($avDiagnosis.Code -cne 'https_inspection' -or $avDiagnosis.Message -notmatch 'Bitdefender' -or $avDiagnosis.Message -notmatch 'Turn off HTTPS') {
    throw 'An antivirus-intercepted certificate did not tell the user to disable HTTPS scanning.'
}
$dnsDiagnosis = Get-NightlyAuthorizationDiagnosis -SessionResponse ([pscustomobject]@{}) -ProcessNames @() -TlsIssuer '' -DnsAddresses @('127.0.0.1') -WinDivertRunning $false
if ($dnsDiagnosis.Code -cne 'dns_hijack' -or $dnsDiagnosis.Message -notmatch 'Set DNS to 1.1.1.1') {
    throw 'A hijacked gateway DNS answer did not tell the user to change DNS.'
}
$challengeDiagnosis = Get-NightlyAuthorizationDiagnosis -SessionResponse 'Attention Required! | Cloudflare' -ProcessNames @() -TlsIssuer '' -DnsAddresses @('1.1.1.1') -WinDivertRunning $false
if ($challengeDiagnosis.Code -cne 'cloudflare_challenge') {
    throw 'A Cloudflare interstitial was not turned into a WARP action.'
}
$genericDiagnosis = Get-NightlyAuthorizationDiagnosis -SessionResponse ([pscustomobject]@{}) -ProcessNames @() -TlsIssuer '' -DnsAddresses @('1.1.1.1') -WinDivertRunning $false
if ($genericDiagnosis.Code -cne 'invalid_response' -or $genericDiagnosis.Message -notmatch 'try Cloudflare WARP' -or $genericDiagnosis.Message -notmatch 'Details:') {
    throw 'An unclassified invalid session did not keep the WARP fallback action.'
}

$closedRecord = $null
try { throw [Net.WebException]::new('The underlying connection was closed: An unexpected error occurred on a send.') } catch { $closedRecord = $_ }
$closedDiagnosis = Get-NightlyAuthorizationDiagnosis -SessionResponse $null -ErrorRecord $closedRecord -ProcessNames @() -TlsIssuer '' -DnsAddresses @('1.1.1.1') -WinDivertRunning $false
if ($closedDiagnosis.Message -notmatch 'underlying connection was closed' -or $closedDiagnosis.Message -notmatch 'Details:') {
    throw 'A connection-reset session failure hid the actual Windows error.'
}

$statusFromMessage = Get-HttpStatusCode $closedRecord
$remoteRecord = $null
try { throw [Net.WebException]::new('The remote server returned an error: (500) Internal Server Error') } catch { $remoteRecord = $_ }
if ((Get-HttpStatusCode $remoteRecord) -ne 500) {
    throw 'An HTTP status embedded in a WebException message was not recovered.'
}
if ($statusFromMessage -ne 0) {
    throw 'A connection-reset exception was treated as an HTTP status.'
}

$serverError = Get-NightlyAuthorizationDiagnosis -SessionResponse ([pscustomobject]@{ error = 'internal_error' }) -ErrorRecord (New-GatewayWebError 500 'internal_error') -ProcessNames @() -TlsIssuer '' -DnsAddresses @('1.1.1.1') -WinDivertRunning $false
if ($serverError.Code -cne 'internal_error' -or $serverError.Message -notmatch 'Wait a minute' -or $serverError.Message -notmatch 'error=internal_error') {
    throw 'A gateway internal_error was still blamed on GoodbyeDPI.'
}
$serverSupport = @(Get-InstallationSupportLines $serverError.Message)
if ($serverSupport.Count -ne 1 -or $serverSupport[0] -notmatch 'Bannerlord Coop Discord') {
    throw 'A gateway internal_error still repeated the generic DNS advice.'
}

$jsonSession = ConvertTo-NightlyJsonObject (@'
{"device_code":"ddddddddddddddddddddddddddddddddddddddddddd","user_code":"AB2D-EF3H","verification_uri":"https://bannerlordcoop-nightly-gateway.garrett-luskey.workers.dev/activate?code=AB2D-EF3H","expires_in":600,"interval":3}
'@)
if (-not (Test-NightlyDeviceSessionResponse $jsonSession)) {
    throw 'A JSON string device session was not parsed before validation.'
}
if ((Get-NightlyResponseSnippet ([pscustomobject]@{ device_code = 'secret-device-code'; error = 'x' }) '') -match 'secret-device-code') {
    throw 'A failure snippet leaked a device_code.'
}

$script:NightlyTokenPollMinimumSeconds = 0
$script:OpenedVerificationUri = $null
function Start-Process {
    param($FilePath)
    $script:OpenedVerificationUri = $FilePath
}
$script:TokenPolls = 0
function Invoke-RestMethod {
    param($Method, $Uri, $ContentType, $Body)
    if ([string]$Uri -match '/v1/device/sessions$') {
        return [pscustomobject]@{
            device_code = 'd' * 43
            user_code = 'AB2D-EF3H'
            verification_uri = 'https://bannerlordcoop-nightly-gateway.garrett-luskey.workers.dev/activate?code=AB2D-EF3H'
            expires_in = 600
            interval = 0
        }
    }
    $script:TokenPolls += 1
    if ($script:TokenPolls -eq 1) {
        return [pscustomobject]@{ error = 'authorization_pending' }
    }
    return [pscustomobject]@{
        token_type = 'Bearer'
        access_token = 't' * 43
        expires_in = 3600
    }
}
$polledToken = Get-NightlyAccessToken
if ($script:OpenedVerificationUri -notmatch '/activate\?code=AB2D-EF3H$') {
    throw 'The installer did not open the Discord verification URL.'
}
if ($script:TokenPolls -ne 2 -or $polledToken -cne ('t' * 43)) {
    throw 'A pending JSON body still failed the installer before Discord finished.'
}

$script:NightlyObservedProcessNames = @('goodbyedpi')
$script:TokenPolls = 0
$script:OpenedVerificationUri = $null
$dpiQrOutput = (Get-NightlyAccessToken 6>&1 | Out-String)
$script:NightlyObservedProcessNames = $null
if ($script:OpenedVerificationUri -notmatch '/activate\?code=AB2D-EF3H$') {
    throw 'A GoodbyeDPI machine did not still open the Discord verification URL.'
}
if ($dpiQrOutput -notmatch 'mobile data' -or
    $dpiQrOutput -notmatch [regex]::Escape('https://bannerlordcoop-nightly-gateway.garrett-luskey.workers.dev/activate?code=AB2D-EF3H') -or
    $dpiQrOutput -notmatch [char]0x2588) {
    throw 'GoodbyeDPI did not show a phone QR for the activate URL.'
}

$script:TokenPolls = 0
function Invoke-RestMethod {
    param($Method, $Uri, $ContentType, $Body)
    if ([string]$Uri -match '/v1/device/sessions$') {
        return [pscustomobject]@{
            device_code = 'e' * 43
            user_code = 'Z9K4-M7PX'
            verification_uri = 'https://bannerlordcoop-nightly-gateway.garrett-luskey.workers.dev/activate?code=Z9K4-M7PX'
            expires_in = 600
            interval = 0
        }
    }
    return [pscustomobject]@{ error = 'already_used' }
}
$usedMessage = $null
try { Get-NightlyAccessToken | Out-Null } catch { $usedMessage = $_.Exception.Message }
if ($usedMessage -notmatch 'already used') {
    throw 'An already-used token poll still surfaced as an invalid token.'
}

$script:NightlyObservedProcessNames = @('goodbyedpi')
function Invoke-RestMethod {
    param($Method, $Uri, $ContentType, $Body)
    return [pscustomobject]@{}
}
$dpiAccessMessage = $null
try { Get-NightlyAccessToken | Out-Null } catch { $dpiAccessMessage = $_.Exception.Message }
$script:NightlyObservedProcessNames = $null
if ($dpiAccessMessage -notmatch 'Turn off GoodbyeDPI, or enable Cloudflare WARP') {
    throw 'A GoodbyeDPI machine still received the generic invalid-response error.'
}

$sevenZipRoot = Join-Path ([IO.Path]::GetTempPath()) ('BannerlordCoopSevenZipTests-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $sevenZipRoot -Force | Out-Null
try {
    $script:SevenZipDownloadAttempts = 2
    $script:SevenZipDownloadRetrySeconds = 0
    $extractorBytes = [Text.Encoding]::UTF8.GetBytes('7zr-test')
    $hasher = [Security.Cryptography.SHA256]::Create()
    $script:SevenZipSha256 = [BitConverter]::ToString($hasher.ComputeHash($extractorBytes)).Replace('-', '').ToLowerInvariant()
    $hasher.Dispose()

    $script:SevenZipDownloads = @()
    function Save-SevenZipExtractor {
        param($Uri, $Destination)
        $script:SevenZipDownloads += [string]$Uri
        if ([string]$Uri -match '7-zip\.org') {
            [IO.File]::WriteAllBytes($Destination, $extractorBytes)
            return
        }
        throw 'The underlying connection was closed: An unexpected error occurred on a receive.'
    }
    $downloaded = Install-StandaloneSevenZip $sevenZipRoot
    if (-not (Test-Path -LiteralPath $downloaded -PathType Leaf)) {
        throw 'The standalone 7-Zip extractor was not saved after a fallback download.'
    }
    if ($script:SevenZipDownloads.Count -ne 3 -or
        $script:SevenZipDownloads[0] -notmatch '/7zr\.exe$' -or
        $script:SevenZipDownloads[0] -notmatch 'bannerlordcoop-nightly-gateway' -or
        $script:SevenZipDownloads[1] -cne $script:SevenZipDownloads[0] -or
        $script:SevenZipDownloads[2] -cne 'https://www.7-zip.org/a/7zr.exe') {
        throw 'A dropped 7-zip.org-style connection did not retry the gateway and then fall back to the official extractor.'
    }

    $script:SevenZipDownloads = @()
    function Save-SevenZipExtractor {
        param($Uri, $Destination)
        $script:SevenZipDownloads += [string]$Uri
        throw 'The underlying connection was closed: An unexpected error occurred on a receive.'
    }
    $failedMessage = $null
    try { Install-StandaloneSevenZip $sevenZipRoot | Out-Null } catch { $failedMessage = $_.Exception.Message }
    if ($failedMessage -notmatch 'could not be downloaded' -or
        $failedMessage -notmatch 'install 7-Zip' -or
        $script:SevenZipDownloads.Count -ne 6) {
        throw 'A complete 7-Zip extractor download failure did not exhaust every source or tell the user to install 7-Zip.'
    }

    $script:SevenZipDownloads = @()
    function Save-SevenZipExtractor {
        param($Uri, $Destination)
        $script:SevenZipDownloads += [string]$Uri
        if ([string]$Uri -match 'github.com') {
            [IO.File]::WriteAllBytes($Destination, $extractorBytes)
            return
        }
        [IO.File]::WriteAllBytes($Destination, [Text.Encoding]::UTF8.GetBytes('wrong-extractor'))
    }
    $github = Install-StandaloneSevenZip $sevenZipRoot
    if (-not (Test-Path -LiteralPath $github -PathType Leaf) -or
        $script:SevenZipDownloads -notcontains 'https://github.com/ip7z/7zip/releases/download/26.02/7zr.exe') {
        throw 'A hash-mismatched extractor did not continue to the GitHub 7zr.exe release.'
    }
} finally {
    Remove-Item -LiteralPath $sevenZipRoot -Recurse -Force -ErrorAction SilentlyContinue
}

$emptyPin = Get-InstallerPin
if ($emptyPin -cne '') {
    throw 'An unset create-build pin was treated as present.'
}
$env:BANNERLORDCOOP_INSTALLER_PIN = ' not-a-pin '
$invalidPinMessage = $null
try { Get-InstallerPin | Out-Null } catch { $invalidPinMessage = $_.Exception.Message }
Remove-Item Env:BANNERLORDCOOP_INSTALLER_PIN -ErrorAction SilentlyContinue
if ($invalidPinMessage -notmatch 'create-build installer pin is invalid') {
    throw 'An invalid create-build pin did not fail closed.'
}
$validPin = 'P' * 43
$env:BANNERLORDCOOP_INSTALLER_PIN = "  $validPin  "
if ((Get-InstallerPin) -cne $validPin) {
    throw 'A valid create-build pin was not accepted.'
}
Remove-Item Env:BANNERLORDCOOP_INSTALLER_PIN -ErrorAction SilentlyContinue

$pinAccepted = Get-CreateBuildPinRedeemDecision -Response ([pscustomobject]@{
    token_type = 'Bearer'
    access_token = 'p' * 43
    expires_in = 3600
})
if ($pinAccepted.Action -cne 'Accept' -or $pinAccepted.Token -cne ('p' * 43)) {
    throw 'A valid create-build pin session was not accepted.'
}
$pinUsed = Get-CreateBuildPinRedeemDecision -Response ([pscustomobject]@{ error = 'already_used' })
if ($pinUsed.Action -cne 'Fail' -or $pinUsed.Message -notmatch 'already used') {
    throw 'An already-used create-build pin did not tell the user to ask staff for a new link.'
}
$pinExpired = Get-CreateBuildPinRedeemDecision -ErrorRecord (New-GatewayWebError 400 'expired_token')
if ($pinExpired.Action -cne 'Fail' -or $pinExpired.Message -notmatch 'has expired') {
    throw 'An expired create-build pin did not produce the expected guidance.'
}

$pinClientUri = 'https://bannerlordcoop-nightly-gateway.garrett-luskey.workers.dev/v1/artifacts/pins/1527333818711806084/Coop.7z'
$pinServerUri = 'https://pub-bf6bfe4b880e4d1b83f4b09b10419f78.r2.dev/manual/1527333818711806084/BannerlordCoop-DedicatedServer-Win64-client-1234567-server-abcdef1.7z'
if (-not (Test-PinClientArtifactUri $pinClientUri)) {
    throw 'A valid pinned client URL was rejected.'
}
if (-not (Test-PinServerArtifactUri $pinServerUri)) {
    throw 'A valid pinned dedicated-server URL was rejected.'
}
if (Test-PinClientArtifactUri $script:ClientArchiveUri) {
    throw 'The latest nightly client URL was accepted as a create-build pin artifact.'
}
if (Test-PinServerArtifactUri $script:ServerArchiveUri) {
    throw 'The latest nightly server URL was accepted as a create-build pin artifact.'
}
if (Test-PinServerArtifactUri ($pinServerUri + '?extra=1')) {
    throw 'A pinned server URL with a query string was accepted.'
}

$validPinManifest = [pscustomobject]@{
    version = 1
    kind = 'create-build-pin'
    releaseDate = '2026-08-22'
    builtAt = '2026-08-22T15:00:00Z'
    headSha = 'a' * 40
    clientSha = 'a' * 40
    serverSha = 'b' * 40
    client = [pscustomobject]@{
        fileName = 'Coop.7z'
        bytes = 7000000
        sha256 = 'c' * 64
        publicUrl = $pinClientUri
    }
    server = [pscustomobject]@{
        fileName = 'BannerlordCoop-DedicatedServer-Win64-client-1234567-server-abcdef1.7z'
        bytes = 4380000000
        sha256 = 'd' * 64
        publicUrl = $pinServerUri
    }
}
function Invoke-RestMethod {
    param($Method, $Uri, $Headers)
    return $script:PinManifestResponse
}
$script:PinManifestResponse = $validPinManifest
$script:NightlyAccessToken = 'p' * 43
$pinManifest = Get-PinManifest
if ($pinManifest.kind -cne 'create-build-pin' -or $pinManifest.client.publicUrl -cne $pinClientUri) {
    throw 'A valid create-build pin manifest was rejected.'
}
$script:PinManifestResponse = $validPinManifest.PSObject.Copy()
$script:PinManifestResponse.client = $validPinManifest.client.PSObject.Copy()
$script:PinManifestResponse.client.publicUrl = $script:ClientArchiveUri
$rejectedPin = $false
try { Get-PinManifest | Out-Null } catch { $rejectedPin = $true }
if (-not $rejectedPin) {
    throw 'A pin manifest pointing at the latest nightly client was accepted.'
}

$script:NightlyAccessToken = 'p' * 43
if ((Get-ArchiveAuthorization $pinClientUri) -cne ('p' * 43)) {
    throw 'A gateway pin client download did not send the pin session bearer.'
}
if ($null -ne (Get-ArchiveAuthorization $pinServerUri)) {
    throw 'A public dedicated-server download sent a bearer token.'
}

Write-Host 'Installer tests passed.'
