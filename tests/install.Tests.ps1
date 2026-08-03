$ErrorActionPreference = 'Stop'

$installer = Join-Path $PSScriptRoot '..\static\server\install.ps1'
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
    }
}
function Invoke-RestMethod {
    param($Method, $Uri, $Headers)
    return $script:ManifestResponse
}
$script:ManifestResponse = $validManifest
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
    New-Item -ItemType Directory -Path (Join-Path $Destination 'engine') -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $Destination 'server-data\Game Saves') -Force | Out-Null
    New-Item -ItemType File -Path (Join-Path $Destination 'BannerlordCoopServer.exe') -Force | Out-Null
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
} finally {
    Remove-Item -LiteralPath $installRoot -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host 'Installer tests passed.'
