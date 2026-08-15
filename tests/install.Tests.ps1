$ErrorActionPreference = 'Stop'

$installer = Join-Path $PSScriptRoot '..\public\server\install.ps1'
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

$validManifest = [pscustomobject]@{
    version = 1
    releaseDate = '2026-08-03'
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

    $server = Join-Path $installRoot 'server'
    New-Item -ItemType Directory -Path (Join-Path $server 'server-data\Game Saves') -Force | Out-Null
    Set-Content -LiteralPath (Join-Path $server 'server-data\server-config.json') -Value 'my configuration'
    Set-Content -LiteralPath (Join-Path $server 'server-data\Game Saves\saveauto1.sav') -Value 'my save'
    Install-Server $validManifest.server $server 'unused.exe'
    if ((Get-Content -LiteralPath (Join-Path $server 'server-data\server-config.json') -Raw).Trim() -ne 'my configuration') {
        throw 'An existing server configuration was overwritten.'
    }
    if ((Get-Content -LiteralPath (Join-Path $server 'server-data\Game Saves\saveauto1.sav') -Raw).Trim() -ne 'my save') {
        throw 'An existing server save was overwritten.'
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
    $nextRelease.incremental.update = $validManifest.server.incremental.update.PSObject.Copy()
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
} finally {
    Remove-Item -LiteralPath $installRoot -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host 'Installer tests passed.'
