$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$script:InstallerUri = 'https://bannerlordcoop.com/server/install.ps1'
$script:ClientManifestUri = 'https://pub-bf6bfe4b880e4d1b83f4b09b10419f78.r2.dev/nightly/client.json'
$script:ReleaseManifestUri = 'https://pub-bf6bfe4b880e4d1b83f4b09b10419f78.r2.dev/nightly/release.json'
$script:ClientArchiveUri = 'https://pub-bf6bfe4b880e4d1b83f4b09b10419f78.r2.dev/nightly/Coop.7z'
$script:ServerArchiveUri = 'https://pub-bf6bfe4b880e4d1b83f4b09b10419f78.r2.dev/nightly/BannerlordCoop-DedicatedServer-Win64.7z'
$script:SevenZipUri = 'https://www.7-zip.org/a/7zr.exe'
$script:SevenZipSha256 = '56b8cc9f4971cef253644fafe54063ed7fdca551d4dee0f8c6baa81b855acd72'

function Read-YesNo {
    param(
        [Parameter(Mandatory = $true)][string]$Prompt,
        [bool]$DefaultYes = $true
    )

    $suffix = if ($DefaultYes) { '[Y/n]' } else { '[y/N]' }
    while ($true) {
        $answer = (Read-Host "$Prompt $suffix").Trim()
        if ($answer.Length -eq 0) { return $DefaultYes }
        if ($answer -match '^(?i:y|yes)$') { return $true }
        if ($answer -match '^(?i:n|no)$') { return $false }
        Write-Host 'Please answer Y or N.' -ForegroundColor Yellow
    }
}

function Read-InstallChoice {
    Write-Host 'What would you like to install?' -ForegroundColor Cyan
    Write-Host '  1. Coop client mod'
    Write-Host '  2. Windows dedicated server'
    Write-Host '  3. Both client and dedicated server'
    while ($true) {
        $answer = (Read-Host 'Enter 1, 2, or 3').Trim()
        switch ($answer) {
            '1' { return 'Client' }
            '2' { return 'Server' }
            '3' { return 'Both' }
            default { Write-Host 'Please enter 1, 2, or 3.' -ForegroundColor Yellow }
        }
    }
}

function Get-NormalizedPath {
    param([Parameter(Mandatory = $true)][string]$Path)

    $expanded = [Environment]::ExpandEnvironmentVariables($Path.Trim().Trim('"'))
    return [IO.Path]::GetFullPath($expanded).TrimEnd([IO.Path]::DirectorySeparatorChar)
}

function Get-DownloadsPath {
    try {
        $shell = New-Object -ComObject Shell.Application
        $downloads = $shell.NameSpace('shell:Downloads').Self.Path
        if (-not [string]::IsNullOrWhiteSpace($downloads)) { return $downloads }
    } catch {
        # Fall back to the conventional location below.
    }
    return (Join-Path $env:USERPROFILE 'Downloads')
}

function Get-SteamRoots {
    $roots = New-Object 'System.Collections.Generic.List[string]'
    foreach ($registryPath in @(
        'HKCU:\Software\Valve\Steam',
        'HKLM:\Software\WOW6432Node\Valve\Steam',
        'HKLM:\Software\Valve\Steam'
    )) {
        try {
            $value = Get-ItemProperty -LiteralPath $registryPath -ErrorAction Stop
            foreach ($name in @('SteamPath', 'InstallPath')) {
                $path = [string]$value.$name
                if (-not [string]::IsNullOrWhiteSpace($path)) { $roots.Add($path) }
            }
        } catch {
            # That registry view is not present.
        }
    }
    if (${env:ProgramFiles(x86)}) { $roots.Add((Join-Path ${env:ProgramFiles(x86)} 'Steam')) }
    if ($env:ProgramFiles) { $roots.Add((Join-Path $env:ProgramFiles 'Steam')) }

    $libraries = New-Object 'System.Collections.Generic.List[string]'
    foreach ($root in $roots) {
        if ([string]::IsNullOrWhiteSpace($root)) { continue }
        try { $normalizedRoot = Get-NormalizedPath $root } catch { continue }
        if (-not $libraries.Contains($normalizedRoot)) { $libraries.Add($normalizedRoot) }
        $libraryFile = Join-Path $normalizedRoot 'steamapps\libraryfolders.vdf'
        if (-not (Test-Path -LiteralPath $libraryFile -PathType Leaf)) { continue }
        try {
            $contents = Get-Content -LiteralPath $libraryFile -Raw
            foreach ($match in [regex]::Matches($contents, '"path"\s+"(?<path>(?:\\\\|[^\"])*)"')) {
                $library = $match.Groups['path'].Value -replace '\\\\', '\'
                $library = Get-NormalizedPath $library
                if (-not $libraries.Contains($library)) { $libraries.Add($library) }
            }
        } catch {
            # A malformed library file should not prevent manual selection.
        }
    }
    return $libraries
}

function Test-BannerlordModulesPath {
    param([Parameter(Mandatory = $true)][string]$Path)

    try { $normalized = Get-NormalizedPath $Path } catch { return $false }
    if ((Split-Path -Leaf $normalized) -ne 'Modules') { return $false }
    $gameRoot = Split-Path -Parent $normalized
    return (Test-Path -LiteralPath (Join-Path $gameRoot 'bin\Win64_Shipping_Client') -PathType Container) -and
        (Test-Path -LiteralPath (Join-Path $normalized 'Native\SubModule.xml') -PathType Leaf)
}

function Get-BannerlordModulesCandidates {
    $candidates = New-Object 'System.Collections.Generic.List[string]'
    foreach ($steamRoot in Get-SteamRoots) {
        $modules = Join-Path $steamRoot 'steamapps\common\Mount & Blade II Bannerlord\Modules'
        if ((Test-BannerlordModulesPath $modules) -and -not $candidates.Contains($modules)) {
            $candidates.Add($modules)
        }
    }
    foreach ($root in @(
        (Join-Path $env:ProgramFiles 'GOG Galaxy\Games\Mount & Blade II Bannerlord'),
        (Join-Path ${env:ProgramFiles(x86)} 'GOG Galaxy\Games\Mount & Blade II Bannerlord')
    )) {
        if ([string]::IsNullOrWhiteSpace($root)) { continue }
        $modules = Join-Path $root 'Modules'
        if ((Test-BannerlordModulesPath $modules) -and -not $candidates.Contains($modules)) {
            $candidates.Add($modules)
        }
    }
    return @($candidates | Sort-Object -Unique)
}

function Select-ClientModulesPath {
    $candidate = Get-BannerlordModulesCandidates | Select-Object -First 1
    if ($candidate -and (Read-YesNo "Bannerlord was found here:`n  $candidate`nInstall the Coop client there?" $true)) {
        return (Get-NormalizedPath $candidate)
    }

    while ($true) {
        $answer = Read-Host 'Enter the full path to your Bannerlord Modules folder (or Q to cancel)'
        if ($answer.Trim() -match '^(?i:q|quit)$') { throw 'Installation cancelled.' }
        try {
            $path = Get-NormalizedPath $answer
            if ((Split-Path -Leaf $path) -ne 'Modules' -and
                (Test-Path -LiteralPath (Join-Path $path 'Modules') -PathType Container)) {
                $path = Join-Path $path 'Modules'
            }
        } catch {
            Write-Host 'That path is not valid. Please try again.' -ForegroundColor Yellow
            continue
        }
        if (-not (Test-BannerlordModulesPath $path)) {
            Write-Host 'That is not a Bannerlord Modules folder. It must contain Native\SubModule.xml.' -ForegroundColor Yellow
            continue
        }
        if (Read-YesNo "Install the Coop client into $path?" $true) { return $path }
    }
}

function Select-ServerPath {
    $recommended = Join-Path (Get-DownloadsPath) 'BannerlordCoop Dedicated Server'
    Write-Host ''
    Write-Host 'The dedicated server does not belong inside the Bannerlord game installation.' -ForegroundColor Cyan
    $recommendedItems = @(Get-ChildItem -LiteralPath $recommended -Force -ErrorAction SilentlyContinue)
    $recommendedIsServer = Test-Path -LiteralPath (Join-Path $recommended 'BannerlordCoopServer.exe') -PathType Leaf
    if (($recommendedItems.Count -eq 0 -or $recommendedIsServer) -and
        (Read-YesNo "Install it in the recommended folder?`n  $recommended" $true)) {
        return (Get-NormalizedPath $recommended)
    }
    if ($recommendedItems.Count -gt 0 -and -not $recommendedIsServer) {
        Write-Host 'The recommended folder already contains unrelated files, so it will not be used.' -ForegroundColor Yellow
    }
    while ($true) {
        $answer = Read-Host 'Enter an empty folder or an existing BannerlordCoop dedicated-server folder (or Q to cancel)'
        if ($answer.Trim() -match '^(?i:q|quit)$') { throw 'Installation cancelled.' }
        try { $path = Get-NormalizedPath $answer } catch {
            Write-Host 'That path is not valid. Please try again.' -ForegroundColor Yellow
            continue
        }
        if (Test-Path -LiteralPath $path -PathType Leaf) {
            Write-Host 'The selected path is a file, not a folder.' -ForegroundColor Yellow
            continue
        }
        $items = @(Get-ChildItem -LiteralPath $path -Force -ErrorAction SilentlyContinue)
        $existingServer = Test-Path -LiteralPath (Join-Path $path 'BannerlordCoopServer.exe') -PathType Leaf
        if ($items.Count -gt 0 -and -not $existingServer) {
            Write-Host 'That folder is not empty and is not an existing BannerlordCoop server installation.' -ForegroundColor Yellow
            Write-Host 'Choose an empty folder so unrelated files cannot be overwritten.' -ForegroundColor Yellow
            continue
        }
        if (Read-YesNo "Install the dedicated server into $path?" $true) { return $path }
    }
}

function Get-ReleaseManifest {
    param([bool]$ClientOnly = $false)

    $headers = @{ 'Cache-Control' = 'no-cache'; Pragma = 'no-cache' }
    $manifestUri = if ($ClientOnly) { $script:ClientManifestUri } else { $script:ReleaseManifestUri }
    Write-Host 'Checking the latest completed nightly release...'
    $manifest = Invoke-RestMethod -Method Get -Uri $manifestUri -Headers $headers
    if ($manifest.version -ne 1 -or
        [string]$manifest.releaseDate -notmatch '^\d{4}-\d{2}-\d{2}$' -or
        [string]$manifest.headSha -notmatch '^[a-f0-9]{40}$') {
        throw 'The nightly release manifest is invalid.'
    }
    $expected = @(@{ Name = 'client'; Uri = $script:ClientArchiveUri; Maximum = 26214400L })
    if (-not $ClientOnly) {
        $expected += @{ Name = 'server'; Uri = $script:ServerArchiveUri; Maximum = 8589934592L }
    }
    foreach ($entry in $expected) {
        $release = $manifest.($entry.Name)
        $bytes = 0L
        $validBytes = [long]::TryParse([string]$release.bytes, [ref]$bytes)
        if ([string]$release.publicUrl -cne $entry.Uri -or
            [string]$release.sha256 -notmatch '^[a-f0-9]{64}$' -or
            -not $validBytes -or $bytes -le 0 -or $bytes -gt $entry.Maximum -or
            [string]$release.fileName -notmatch '^[A-Za-z0-9][A-Za-z0-9 ._-]{0,199}\.7z$') {
            throw "The nightly $($entry.Name) release metadata is invalid."
        }
    }
    return $manifest
}

function Get-SevenZip {
    param([Parameter(Mandatory = $true)][string]$WorkPath)

    foreach ($candidate in @(
        (Join-Path $env:ProgramFiles '7-Zip\7z.exe'),
        (Join-Path ${env:ProgramFiles(x86)} '7-Zip\7z.exe')
    )) {
        if (-not [string]::IsNullOrWhiteSpace($candidate) -and
            (Test-Path -LiteralPath $candidate -PathType Leaf)) { return $candidate }
    }
    $command = Get-Command '7z.exe' -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }

    $path = Join-Path $WorkPath '7zr.exe'
    Write-Host 'Downloading the official standalone 7-Zip extractor...'
    Invoke-WebRequest -UseBasicParsing -Uri $script:SevenZipUri -OutFile $path
    $actualHash = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actualHash -cne $script:SevenZipSha256) {
        throw 'The downloaded 7-Zip extractor did not match its pinned SHA-256 hash.'
    }
    return $path
}

function Get-Archive {
    param(
        [Parameter(Mandatory = $true)][string]$Uri,
        [Parameter(Mandatory = $true)][string]$Destination,
        [Parameter(Mandatory = $true)][long]$ExpectedBytes,
        [Parameter(Mandatory = $true)][string]$ExpectedSha256,
        [Parameter(Mandatory = $true)][string]$Label
    )

    Add-Type -AssemblyName System.Net.Http
    $sizeLabel = if ($ExpectedBytes -ge 1GB) {
        '{0:N2} GiB' -f ($ExpectedBytes / 1GB)
    } else {
        '{0:N1} MiB' -f ($ExpectedBytes / 1MB)
    }
    Write-Host "Downloading $Label ($sizeLabel). This may take a while..." -ForegroundColor Cyan
    $previousProgressPreference = $ProgressPreference
    $ProgressPreference = 'Continue'
    $handler = New-Object System.Net.Http.HttpClientHandler
    $http = New-Object System.Net.Http.HttpClient($handler)
    $http.Timeout = [TimeSpan]::FromHours(4)
    try {
        $response = $http.GetAsync($Uri, [Net.Http.HttpCompletionOption]::ResponseHeadersRead).GetAwaiter().GetResult()
        [void]$response.EnsureSuccessStatusCode()
        if ($response.Content.Headers.ContentLength -and
            $response.Content.Headers.ContentLength -ne $ExpectedBytes) {
            throw "$Label download size does not match the release manifest."
        }
        $input = $response.Content.ReadAsStreamAsync().GetAwaiter().GetResult()
        $output = [IO.File]::Create($Destination)
        try {
            $buffer = New-Object byte[] (1024 * 1024)
            $received = 0L
            $lastPercent = -1
            while (($read = $input.Read($buffer, 0, $buffer.Length)) -gt 0) {
                $output.Write($buffer, 0, $read)
                $received += $read
                $percent = [Math]::Min(100, [int](($received * 100L) / $ExpectedBytes))
                if ($percent -ne $lastPercent) {
                    Write-Progress -Activity "Downloading $Label" -Status "$percent%" -PercentComplete $percent
                    $lastPercent = $percent
                }
            }
        } finally {
            if ($output) { $output.Dispose() }
            if ($input) { $input.Dispose() }
            Write-Progress -Activity "Downloading $Label" -Completed
        }
    } finally {
        $ProgressPreference = $previousProgressPreference
        $http.Dispose()
        $handler.Dispose()
    }
    $file = Get-Item -LiteralPath $Destination
    if ($file.Length -ne $ExpectedBytes) { throw "$Label download was incomplete." }
    Write-Host "Verifying $Label..."
    $actualHash = (Get-FileHash -LiteralPath $Destination -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actualHash -cne $ExpectedSha256) {
        throw "$Label did not match the published SHA-256 hash. The nightly may still be updating; try again shortly."
    }
}

function Expand-SevenZipArchive {
    param(
        [Parameter(Mandatory = $true)][string]$SevenZip,
        [Parameter(Mandatory = $true)][string]$Archive,
        [Parameter(Mandatory = $true)][string]$Destination
    )

    New-Item -ItemType Directory -Path $Destination -Force | Out-Null
    $arguments = 'x -y -aoa -bso0 -bsp0 "-o{0}" "{1}"' -f $Destination, $Archive
    $process = Start-Process -FilePath $SevenZip -ArgumentList $arguments -NoNewWindow -Wait -PassThru
    if ($process.ExitCode -ne 0) { throw "7-Zip failed to extract $Archive." }
}

function Unblock-Installation {
    param([Parameter(Mandatory = $true)][string]$Path)

    Write-Host "Unblocking downloaded files in $Path..."
    Get-ChildItem -LiteralPath $Path -Recurse -File -Force | Unblock-File
}

function Install-Client {
    param(
        [Parameter(Mandatory = $true)][object]$Release,
        [Parameter(Mandatory = $true)][string]$ModulesPath,
        [Parameter(Mandatory = $true)][string]$SevenZip,
        [Parameter(Mandatory = $true)][string]$WorkPath
    )

    $archive = Join-Path $WorkPath 'Coop.7z'
    $stage = Join-Path $WorkPath 'client-stage'
    Write-Host ''
    Write-Host 'Installing the Coop client mod...' -ForegroundColor Cyan
    Get-Archive $script:ClientArchiveUri $archive ([long]$Release.bytes) ([string]$Release.sha256) 'Coop client'
    Write-Host 'Extracting the Coop client...'
    Expand-SevenZipArchive $SevenZip $archive $stage
    $stagedModule = Join-Path $stage 'Coop'
    if (-not (Test-Path -LiteralPath (Join-Path $stagedModule 'SubModule.xml') -PathType Leaf) -or
        -not (Test-Path -LiteralPath (Join-Path $stagedModule 'bin\Win64_Shipping_Client\Coop.Core.dll') -PathType Leaf)) {
        throw 'The client archive does not contain a valid Coop module.'
    }
    $target = Join-Path $ModulesPath 'Coop'
    Write-Host "Removing the old Coop client from $target..."
    if (Test-Path -LiteralPath $target) {
        Remove-Item -LiteralPath $target -Recurse -Force
    }
    if (Test-Path -LiteralPath $target) {
        throw 'The old Coop client could not be completely removed. Close Bannerlord and try again.'
    }
    Copy-Item -LiteralPath $stagedModule -Destination $target -Recurse -Force
    Unblock-Installation $target
    Write-Host "Client installed: $target" -ForegroundColor Green
}

function Invoke-Robocopy {
    param([Parameter(Mandatory = $true)][string[]]$Arguments)

    $argumentLine = ($Arguments | ForEach-Object {
        if ($_ -match '[\s"]') { '"' + $_.Replace('"', '\"') + '"' } else { $_ }
    }) -join ' '
    $process = Start-Process -FilePath "$env:SystemRoot\System32\robocopy.exe" `
        -ArgumentList $argumentLine -NoNewWindow -Wait -PassThru
    if ($process.ExitCode -gt 7) { throw "Robocopy failed with exit code $($process.ExitCode)." }
}

function Install-Server {
    param(
        [Parameter(Mandatory = $true)][object]$Release,
        [Parameter(Mandatory = $true)][string]$ServerPath,
        [Parameter(Mandatory = $true)][string]$SevenZip
    )

    $parent = Split-Path -Parent $ServerPath
    New-Item -ItemType Directory -Path $parent -Force | Out-Null
    $work = Join-Path $parent ('.bannerlordcoop-installer-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $work -Force | Out-Null
    try {
        Write-Host ''
        Write-Host 'Installing the Windows dedicated server...' -ForegroundColor Cyan
        $archive = Join-Path $work 'server.7z'
        $stage = Join-Path $work 'stage'
        Get-Archive $script:ServerArchiveUri $archive ([long]$Release.bytes) ([string]$Release.sha256) 'dedicated server'
        Write-Host 'Extracting the dedicated server. This can take several minutes...'
        Expand-SevenZipArchive $SevenZip $archive $stage
        if (-not (Test-Path -LiteralPath (Join-Path $stage 'BannerlordCoopServer.exe') -PathType Leaf) -or
            -not (Test-Path -LiteralPath (Join-Path $stage 'engine') -PathType Container)) {
            throw 'The server archive does not contain a valid dedicated server.'
        }
        New-Item -ItemType Directory -Path $ServerPath -Force | Out-Null
        $existingData = Test-Path -LiteralPath (Join-Path $ServerPath 'server-data') -PathType Container
        if ($existingData) {
            Invoke-Robocopy -Arguments @($stage, $ServerPath, '/E', '/R:2', '/W:1', '/NFL', '/NDL', '/NJH', '/NJS', '/NP', '/XD', (Join-Path $stage 'server-data'))
            Invoke-Robocopy -Arguments @((Join-Path $stage 'server-data'), (Join-Path $ServerPath 'server-data'), '/E', '/XC', '/XN', '/XO', '/R:2', '/W:1', '/NFL', '/NDL', '/NJH', '/NJS', '/NP')
        } else {
            Invoke-Robocopy -Arguments @($stage, $ServerPath, '/E', '/R:2', '/W:1', '/NFL', '/NDL', '/NJH', '/NJS', '/NP')
        }
        Unblock-Installation $ServerPath
        Write-Host "Dedicated server installed: $ServerPath" -ForegroundColor Green
        if ($existingData) {
            Write-Host 'Your existing server configuration and saves were preserved.' -ForegroundColor Green
        }
    } finally {
        Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
    }
}

function Invoke-BannerlordCoopInstaller {
    Write-Host 'BannerlordCoop nightly installer' -ForegroundColor Cyan
    Write-Host 'This downloads and installs the latest completed nightly for you.'
    Write-Host ''

    $choice = Read-InstallChoice
    $installClient = $choice -eq 'Client' -or $choice -eq 'Both'
    $installServer = $choice -eq 'Server' -or $choice -eq 'Both'
    $manifest = Get-ReleaseManifest ($choice -eq 'Client')
    Write-Host "Latest nightly: $($manifest.releaseDate) ($([string]$manifest.headSha).Substring(0, 7))"
    $modulesPath = if ($installClient) { Select-ClientModulesPath } else { $null }
    $serverPath = if ($installServer) { Select-ServerPath } else { $null }

    Write-Host ''
    Write-Host 'Ready to install:' -ForegroundColor Cyan
    if ($installClient) { Write-Host "  Client: $modulesPath\Coop" }
    if ($installServer) { Write-Host "  Dedicated server: $serverPath" }
    if (-not (Read-YesNo 'Continue with the installation?' $true)) { throw 'Installation cancelled.' }

    $work = Join-Path ([IO.Path]::GetTempPath()) ('BannerlordCoopInstaller-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $work -Force | Out-Null
    try {
        $sevenZip = Get-SevenZip $work
        if ($installClient) { Install-Client $manifest.client $modulesPath $sevenZip $work }
        if ($installServer) { Install-Server $manifest.server $serverPath $sevenZip }
    } finally {
        Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
    }

    Write-Host ''
    Write-Host 'Installation complete.' -ForegroundColor Green
}

if ($env:BANNERLORDCOOP_INSTALLER_TEST -ne '1') {
    try {
        Invoke-BannerlordCoopInstaller
    } catch {
        Write-Host ''
        Write-Host "Installation failed: $($_.Exception.Message)" -ForegroundColor Red
        Write-Host 'If the selected folder is under Program Files, reopen PowerShell as Administrator and run the command again.' -ForegroundColor Yellow
        throw
    }
}
