$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$script:InstallerUri = 'https://bannerlordcoop-nightly-gateway.garrett-luskey.workers.dev/install.ps1'
$script:NightlyGatewayUri = 'https://bannerlordcoop-nightly-gateway.garrett-luskey.workers.dev'
$script:ClientManifestUri = "$($script:NightlyGatewayUri)/v1/manifests/client"
$script:ReleaseManifestUri = "$($script:NightlyGatewayUri)/v1/manifests/release"
$script:ClientArchiveUri = "$($script:NightlyGatewayUri)/v1/artifacts/nightly/Coop.7z"
$script:ServerArchiveUri = "$($script:NightlyGatewayUri)/v1/artifacts/nightly/BannerlordCoop-DedicatedServer-Win64.7z"
$script:NightlyAccessToken = $null
$script:NightlyTokenPollMinimumSeconds = 3
# 7-zip.org often drops the connection, so try the gateway copy first.
$script:SevenZipUris = @(
    "$($script:NightlyGatewayUri)/7zr.exe",
    'https://www.7-zip.org/a/7zr.exe',
    'https://github.com/ip7z/7zip/releases/download/26.02/7zr.exe'
)
$script:SevenZipSha256 = '56b8cc9f4971cef253644fafe54063ed7fdca551d4dee0f8c6baa81b855acd72'
$script:SevenZipDownloadAttempts = 3
$script:SevenZipDownloadRetrySeconds = 1

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

function Get-HttpStatusCode {
    param([Parameter(Mandatory = $true)]$ErrorRecord)

    $exception = $null
    try { $exception = $ErrorRecord.Exception } catch { }
    while ($null -ne $exception) {
        try {
            $statusCode = [int]$exception.Response.StatusCode
            if ($statusCode -gt 0) { return $statusCode }
        } catch { }
        try { $exception = $exception.InnerException } catch { break }
    }
    return 0
}

function Get-NightlyGatewayErrorCode {
    param($Response)

    if ($null -eq $Response) { return '' }
    try {
        $code = [string]$Response.error
        if ($code -match '^[a-z_]+$') { return $code }
    } catch { }
    return ''
}

function Test-NightlyAccessTokenResponse {
    param($Response)

    if ($null -eq $Response) { return $false }
    return [string]$Response.token_type -ceq 'Bearer' -and
        [string]$Response.access_token -match '^[A-Za-z0-9_-]{43}$'
}

function Get-NightlyTokenPollDecision {
    param(
        $Response,
        $ErrorRecord
    )

    $statusCode = 0
    $errorCode = Get-NightlyGatewayErrorCode $Response
    if ($null -ne $ErrorRecord) {
        $statusCode = Get-HttpStatusCode $ErrorRecord
        $statusError = ''
        try { $statusError = Get-NightlyGatewayErrorCode $ErrorRecord.Exception.Response } catch { }
        if ($statusError) { $errorCode = $statusError }
    } elseif (Test-NightlyAccessTokenResponse $Response) {
        return [pscustomobject]@{
            Action = 'Accept'
            Token = [string]$Response.access_token
            Message = ''
        }
    }

    # Pending JSON can arrive as HTTP 200 when a proxy or HTTP stack drops 428.
    if ($statusCode -eq 428 -or $errorCode -ceq 'authorization_pending') {
        return [pscustomobject]@{ Action = 'Continue'; Token = ''; Message = '' }
    }
    if ($statusCode -eq 403 -or $errorCode -ceq 'access_denied' -or $errorCode -ceq 'supporter_role_required') {
        return [pscustomobject]@{
            Action = 'Fail'
            Token = ''
            Message = 'Discord access was denied. The Tester role, a current Patreon, Boosty, or Afdian supporter role, or an active sponsored-account seat is required.'
        }
    }
    if ($statusCode -eq 409 -or $errorCode -ceq 'already_used') {
        return [pscustomobject]@{
            Action = 'Fail'
            Token = ''
            Message = 'This Discord verification was already used. Close extra installer windows and run the installer again.'
        }
    }
    if ($statusCode -eq 400 -or $statusCode -eq 401 -or
        $errorCode -ceq 'expired_token' -or $errorCode -ceq 'invalid_request') {
        return [pscustomobject]@{
            Action = 'Fail'
            Token = ''
            Message = 'The Discord verification expired. Run the installer again to start a new check.'
        }
    }
    if ($null -eq $ErrorRecord) {
        return [pscustomobject]@{
            Action = 'Fail'
            Token = ''
            Message = 'The nightly authorization token is invalid.'
        }
    }
    return [pscustomobject]@{ Action = 'Rethrow'; Token = ''; Message = '' }
}

function Get-NightlyAccessToken {
    Write-Host ''
    Write-Host 'Nightly access verification' -ForegroundColor Cyan
    Write-Host 'Nightly builds are for Testers, current Patreon, Boosty, or Afdian supporters, and up to 10 Discord accounts sponsored by each eligible member.'
    Write-Host 'A browser will open so Discord can verify access for this install or update.'

    $session = Invoke-RestMethod -Method Post -Uri "$($script:NightlyGatewayUri)/v1/device/sessions" `
        -ContentType 'application/x-www-form-urlencoded' -Body ''
    if ([string]$session.device_code -notmatch '^[A-Za-z0-9_-]{43}$' -or
        [string]$session.user_code -notmatch '^[A-Z2-9]{4}-[A-Z2-9]{4}$' -or
        [string]$session.verification_uri -notmatch '^https://bannerlordcoop-nightly-gateway\.garrett-luskey\.workers\.dev/activate\?') {
        throw 'The nightly authorization service returned an invalid response.'
    }
    Write-Host "Verification code: $($session.user_code)" -ForegroundColor Yellow
    Write-Host 'Opening Discord verification in your browser...'
    Start-Process ([string]$session.verification_uri)

    $deadline = [datetimeoffset]::UtcNow.AddSeconds([Math]::Min(600, [int]$session.expires_in))
    while ([datetimeoffset]::UtcNow -lt $deadline) {
        Start-Sleep -Seconds ([Math]::Max($script:NightlyTokenPollMinimumSeconds, [int]$session.interval))
        $decision = $null
        try {
            $token = Invoke-RestMethod -Method Post -Uri "$($script:NightlyGatewayUri)/v1/device/token" `
                -ContentType 'application/x-www-form-urlencoded' `
                -Body @{ device_code = [string]$session.device_code }
            $decision = Get-NightlyTokenPollDecision -Response $token
        } catch {
            $decision = Get-NightlyTokenPollDecision -ErrorRecord $_
        }
        if ($decision.Action -eq 'Continue') { continue }
        if ($decision.Action -eq 'Accept') {
            Write-Host 'Nightly access verified.' -ForegroundColor Green
            return [string]$decision.Token
        }
        if ($decision.Action -eq 'Fail') { throw $decision.Message }
        throw
    }
    throw 'Discord verification timed out. Run the installer again when you are ready to authorize it.'
}

function Get-NightlyHeaders {
    if ([string]::IsNullOrWhiteSpace([string]$script:NightlyAccessToken)) {
        throw 'Nightly access has not been verified.'
    }
    return @{
        Authorization = "Bearer $($script:NightlyAccessToken)"
        'Cache-Control' = 'no-cache'
        Pragma = 'no-cache'
    }
}

function Get-NormalizedPath {
    param([Parameter(Mandatory = $true)][string]$Path)

    $expanded = [Environment]::ExpandEnvironmentVariables($Path.Trim().Trim('"'))
    return [IO.Path]::GetFullPath($expanded).TrimEnd([IO.Path]::DirectorySeparatorChar)
}

function Get-ShortCommitSha {
    param([Parameter(Mandatory = $true)][string]$Sha)

    if ($Sha.Length -le 7) { return $Sha }
    return $Sha.Substring(0, 7)
}

function Get-NightlyDisplayDate {
    param(
        [Parameter(Mandatory = $true)][string]$ReleaseDate,
        [string]$BuiltAt
    )

    if ([string]::IsNullOrWhiteSpace($BuiltAt) -or $BuiltAt.Length -gt 64 -or
        $BuiltAt -notmatch '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?Z$') {
        return $ReleaseDate
    }
    try {
        $timestamp = [DateTimeOffset]::Parse(
            $BuiltAt,
            [Globalization.CultureInfo]::InvariantCulture,
            [Globalization.DateTimeStyles]::RoundtripKind
        )
        $central = [TimeZoneInfo]::FindSystemTimeZoneById('Central Standard Time')
        return [TimeZoneInfo]::ConvertTime($timestamp, $central).ToString(
            'yyyy-MM-dd',
            [Globalization.CultureInfo]::InvariantCulture
        )
    } catch {
        return $ReleaseDate
    }
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
    param([string[]]$AdditionalRoots = @())

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
    foreach ($root in $AdditionalRoots) {
        if (-not [string]::IsNullOrWhiteSpace($root)) { $roots.Add($root) }
    }

    $libraries = New-Object 'System.Collections.Generic.List[string]'
    foreach ($root in $roots) {
        if ([string]::IsNullOrWhiteSpace($root)) { continue }
        try { $normalizedRoot = Get-NormalizedPath $root } catch { continue }
        if (-not (Test-Path -LiteralPath $normalizedRoot -PathType Container -ErrorAction SilentlyContinue)) { continue }
        if (-not $libraries.Contains($normalizedRoot)) { $libraries.Add($normalizedRoot) }
        $libraryFile = [IO.Path]::Combine($normalizedRoot, 'steamapps', 'libraryfolders.vdf')
        if (-not (Test-Path -LiteralPath $libraryFile -PathType Leaf)) { continue }
        try {
            $contents = Get-Content -LiteralPath $libraryFile -Raw
            foreach ($match in [regex]::Matches($contents, '"path"\s+"(?<path>(?:\\\\|[^\"])*)"')) {
                $library = $match.Groups['path'].Value -replace '\\\\', '\'
                $library = Get-NormalizedPath $library
                if (-not (Test-Path -LiteralPath $library -PathType Container -ErrorAction SilentlyContinue)) { continue }
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
        $modules = [IO.Path]::Combine($steamRoot, 'steamapps', 'common', 'Mount & Blade II Bannerlord', 'Modules')
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
        if (Read-YesNo "Install the Coop client into ${path}?" $true) { return $path }
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
        if (Read-YesNo "Install the dedicated server into ${path}?" $true) { return $path }
    }
}

function Get-ReleaseManifest {
    param([bool]$ClientOnly = $false)

    $headers = Get-NightlyHeaders
    $manifestUri = if ($ClientOnly) { $script:ClientManifestUri } else { $script:ReleaseManifestUri }
    Write-Host 'Checking the latest completed nightly release...'
    try {
        $manifest = Invoke-RestMethod -Method Get -Uri $manifestUri -Headers $headers
    } catch {
        $statusCode = Get-HttpStatusCode $_
        if ($statusCode -eq 404) {
            if ($ClientOnly) {
                throw 'No Patron client nightly has been published yet. Wait for the next completed nightly build, then run the installer again.'
            }
            throw 'No matched Patron client and dedicated-server nightly has been published yet. Wait for the next completed nightly build, then run the installer again.'
        }
        throw
    }
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
    if (-not $ClientOnly -and $null -ne $manifest.server.incremental) {
        $incremental = $manifest.server.incremental
        if ($incremental.version -ne 1 -or
            [string]$incremental.layout -cne 'base-overlay-v1' -or
            [string]$incremental.baseFingerprint -notmatch '^[a-f0-9]{64}$') {
            throw 'The incremental Windows server release metadata is invalid.'
        }
        $compatibleFingerprints = @($incremental.compatibleBaseFingerprints | Where-Object { $null -ne $_ })
        if ($compatibleFingerprints.Count -gt 16 -or
            @($compatibleFingerprints | Where-Object { [string]$_ -notmatch '^[a-f0-9]{64}$' }).Count -gt 0 -or
            @($compatibleFingerprints | Select-Object -Unique).Count -ne $compatibleFingerprints.Count) {
            throw 'The incremental Windows server compatibility metadata is invalid.'
        }
        foreach ($partName in @('base', 'update')) {
            $part = $incremental.$partName
            $partBytes = 0L
            $validPartBytes = [long]::TryParse([string]$part.bytes, [ref]$partBytes)
            $maximum = if ($partName -eq 'base') { 8589934592L } else { 536870912L }
            if (-not (Test-PublicArtifactUri ([string]$part.publicUrl) $partName) -or
                [string]$part.sha256 -notmatch '^[a-f0-9]{64}$' -or
                -not $validPartBytes -or $partBytes -le 0 -or $partBytes -gt $maximum -or
                [string]$part.fileName -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]{0,199}\.7z$') {
                throw "The incremental Windows server $partName metadata is invalid."
            }
        }
    }
    return $manifest
}

function Test-PublicArtifactUri {
    param(
        [Parameter(Mandatory = $true)][string]$Uri,
        [Parameter(Mandatory = $true)][ValidateSet('base', 'update')][string]$Kind
    )

    try { $parsed = [Uri]$Uri } catch { return $false }
    if ($parsed.Scheme -cne 'https' -or
        $parsed.Host -cne 'bannerlordcoop-nightly-gateway.garrett-luskey.workers.dev' -or
        -not [string]::IsNullOrEmpty($parsed.Query) -or
        -not [string]::IsNullOrEmpty($parsed.Fragment)) { return $false }
    $pattern = if ($Kind -eq 'base') {
        '^/v1/artifacts/windows/base/v1/[a-f0-9]{64}/[a-f0-9]{64}/server-base\.7z$'
    } else {
        '^/v1/artifacts/(?:nightly/windows/updates/[a-f0-9]{40}/[a-f0-9]{40}|release/\d{17,20}/windows/update)/[a-f0-9]{64}/server-update\.7z$'
    }
    return $parsed.AbsolutePath -cmatch $pattern
}

function Get-FileSha256 {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Label
    )

    Write-Host "Verifying $Label..." -ForegroundColor Cyan
    $previousProgressPreference = $ProgressPreference
    $ProgressPreference = 'Continue'
    $stream = [IO.File]::OpenRead($Path)
    $algorithm = [Security.Cryptography.SHA256]::Create()
    $hash = $null
    try {
        $buffer = New-Object byte[] (4 * 1024 * 1024)
        $total = $stream.Length
        $processed = 0L
        $lastPercent = -1
        while (($read = $stream.Read($buffer, 0, $buffer.Length)) -gt 0) {
            [void]$algorithm.TransformBlock($buffer, 0, $read, $buffer, 0)
            $processed += $read
            $percent = if ($total -gt 0) {
                [Math]::Min(100, [int](($processed * 100L) / $total))
            } else { 100 }
            if ($percent -ne $lastPercent) {
                $status = '{0}% ({1:N1} of {2:N1} MiB)' -f $percent, ($processed / 1MB), ($total / 1MB)
                Write-Progress -Id 2 -Activity "Verifying $Label" -Status $status -PercentComplete $percent
                $lastPercent = $percent
            }
        }
        $empty = New-Object byte[] 0
        [void]$algorithm.TransformFinalBlock($empty, 0, 0)
        $hash = [BitConverter]::ToString($algorithm.Hash).Replace('-', '').ToLowerInvariant()
    } finally {
        Write-Progress -Id 2 -Activity "Verifying $Label" -Completed
        $algorithm.Dispose()
        $stream.Dispose()
        $ProgressPreference = $previousProgressPreference
    }
    return $hash
}

function Get-InstalledSevenZip {
    foreach ($candidate in @(
        (Join-Path $env:ProgramFiles '7-Zip\7z.exe'),
        (Join-Path ${env:ProgramFiles(x86)} '7-Zip\7z.exe')
    )) {
        if (-not [string]::IsNullOrWhiteSpace($candidate) -and
            (Test-Path -LiteralPath $candidate -PathType Leaf)) { return $candidate }
    }
    $command = Get-Command '7z.exe' -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }
    return $null
}

function Save-SevenZipExtractor {
    param(
        [Parameter(Mandatory = $true)][string]$Uri,
        [Parameter(Mandatory = $true)][string]$Destination
    )

    Invoke-WebRequest -UseBasicParsing -Uri $Uri -OutFile $Destination -UserAgent 'BannerlordCoopInstaller'
}

function Install-StandaloneSevenZip {
    param([Parameter(Mandatory = $true)][string]$WorkPath)

    $path = Join-Path $WorkPath '7zr.exe'
    $lastError = $null
    foreach ($uri in $script:SevenZipUris) {
        for ($attempt = 1; $attempt -le [int]$script:SevenZipDownloadAttempts; $attempt++) {
            try {
                if ($attempt -eq 1) {
                    Write-Host 'Downloading the official standalone 7-Zip extractor...'
                } else {
                    Write-Host "Retrying the 7-Zip extractor download (attempt $attempt)..."
                }
                Save-SevenZipExtractor $uri $path
                $actualHash = Get-FileSha256 $path '7-Zip extractor'
                if ($actualHash -cne $script:SevenZipSha256) {
                    throw 'The downloaded 7-Zip extractor did not match its pinned SHA-256 hash.'
                }
                return $path
            } catch {
                $lastError = $_
                if ([string]$_.Exception.Message -match 'did not match its pinned SHA-256 hash') { break }
                if ($attempt -lt [int]$script:SevenZipDownloadAttempts -and
                    [int]$script:SevenZipDownloadRetrySeconds -gt 0) {
                    Start-Sleep -Seconds $script:SevenZipDownloadRetrySeconds
                }
            }
        }
    }
    $detail = if ($null -ne $lastError) { [string]$lastError.Exception.Message } else { 'No download source succeeded.' }
    throw "The 7-Zip extractor could not be downloaded. $detail If this keeps happening, install 7-Zip from https://www.7-zip.org and run the installer again."
}

function Get-SevenZip {
    param([Parameter(Mandatory = $true)][string]$WorkPath)

    $installed = Get-InstalledSevenZip
    if ($installed) { return $installed }
    return Install-StandaloneSevenZip $WorkPath
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
    $http.DefaultRequestHeaders.Authorization = New-Object System.Net.Http.Headers.AuthenticationHeaderValue(
        'Bearer',
        [string]$script:NightlyAccessToken
    )
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
                    $receivedLabel = if ($ExpectedBytes -ge 1GB) {
                        '{0:N2} GiB' -f ($received / 1GB)
                    } else {
                        '{0:N1} MiB' -f ($received / 1MB)
                    }
                    $status = '{0}% ({1} of {2})' -f $percent, $receivedLabel, $sizeLabel
                    Write-Progress -Id 1 -Activity "Downloading $Label" -Status $status -PercentComplete $percent
                    $lastPercent = $percent
                }
            }
        } finally {
            if ($output) { $output.Dispose() }
            if ($input) { $input.Dispose() }
            Write-Progress -Id 1 -Activity "Downloading $Label" -Completed
        }
    } finally {
        $ProgressPreference = $previousProgressPreference
        $http.Dispose()
        $handler.Dispose()
    }
    $file = Get-Item -LiteralPath $Destination
    if ($file.Length -ne $ExpectedBytes) { throw "$Label download was incomplete." }
    Write-Host "Downloaded $Label." -ForegroundColor Green
    $actualHash = Get-FileSha256 $Destination $Label
    if ($actualHash -cne $ExpectedSha256) {
        throw "$Label did not match the published SHA-256 hash. The nightly may still be updating; try again shortly."
    }
}

function Expand-SevenZipArchive {
    param(
        [Parameter(Mandatory = $true)][string]$SevenZip,
        [Parameter(Mandatory = $true)][string]$Archive,
        [Parameter(Mandatory = $true)][string]$Destination,
        [Parameter(Mandatory = $true)][string]$Label
    )

    Write-Host "Extracting $Label..." -ForegroundColor Cyan
    New-Item -ItemType Directory -Path $Destination -Force | Out-Null
    $arguments = 'x -y -aoa -bso0 -bsp1 "-o{0}" "{1}"' -f $Destination, $Archive
    $process = Start-Process -FilePath $SevenZip -ArgumentList $arguments -NoNewWindow -Wait -PassThru
    if ($process.ExitCode -ne 0) { throw "7-Zip failed to extract $Archive." }
}

function Unblock-Installation {
    param([Parameter(Mandatory = $true)][string]$Path)

    Write-Host "Unblocking downloaded files in $Path..."
    Get-ChildItem -LiteralPath $Path -Recurse -File -Force | Unblock-File
}

function Get-LockedClientProcesses {
    param([Parameter(Mandatory = $true)][string]$ClientPath)

    $normalized = (Get-NormalizedPath $ClientPath) + [IO.Path]::DirectorySeparatorChar
    $gameRoot = Split-Path -Parent (Split-Path -Parent $ClientPath)
    $gamePrefix = if ([string]::IsNullOrWhiteSpace($gameRoot)) {
        $normalized
    } else {
        (Get-NormalizedPath $gameRoot) + [IO.Path]::DirectorySeparatorChar
    }
    return @(Get-Process -ErrorAction SilentlyContinue | Where-Object {
        $name = [string]$_.ProcessName
        $path = $null
        try { $path = [string]$_.Path } catch { $path = $null }
        if ([string]::IsNullOrWhiteSpace($path)) {
            return ($name -ieq 'Bannerlord') -or ($name -ieq 'Coop.CrashReporter')
        }
        try { $path = Get-NormalizedPath $path } catch { return $false }
        $fromClientFolder = $path.StartsWith($normalized, [StringComparison]::OrdinalIgnoreCase)
        $fromThisGame = $path.StartsWith($gamePrefix, [StringComparison]::OrdinalIgnoreCase)
        $fromClientFolder -or
            ($fromThisGame -and $name -ieq 'Bannerlord') -or
            ($fromThisGame -and $name -ieq 'Coop.CrashReporter')
    })
}

function Get-DeniedClientFileName {
    param([Parameter(Mandatory = $true)][System.Exception]$Cause)

    $exception = $Cause
    while ($null -ne $exception) {
        $message = [string]$exception.Message
        if ($message -match "Access to the path '(?<path>[^']+)' is denied") {
            return [IO.Path]::GetFileName($Matches['path'])
        }
        $exception = $exception.InnerException
    }
    return $null
}

function Get-ClientReplacementFailure {
    param(
        [Parameter(Mandatory = $true)][string]$ClientPath,
        [string]$FailedPath
    )

    $running = @(Get-LockedClientProcesses $ClientPath | ForEach-Object {
        $name = [string]$_.ProcessName
        if ($name -ieq 'Coop.CrashReporter') { 'Coop.CrashReporter.exe' }
        elseif ($name -ieq 'Bannerlord') { 'Bannerlord.exe' }
        else { [IO.Path]::GetFileName([string]$_.Path) }
    } | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -Unique)
    if ($running.Count -eq 1) {
        return "The old Coop client could not be replaced because $($running[0]) is still running. Close Bannerlord and Coop.CrashReporter.exe, then run the installer again."
    }
    if ($running.Count -gt 1) {
        return "The old Coop client could not be replaced because $($running -join ', ') are still running. Close Bannerlord and Coop.CrashReporter.exe, then run the installer again."
    }
    if ($FailedPath) {
        return "The old Coop client could not be replaced because access to '$FailedPath' was denied. Close Bannerlord and Coop.CrashReporter.exe, then run the installer again."
    }
    return 'The old Coop client could not be completely removed. Close Bannerlord and Coop.CrashReporter.exe, then try again.'
}

function Assert-ClientUnlocked {
    param([Parameter(Mandatory = $true)][string]$ClientPath)

    $running = @(Get-LockedClientProcesses $ClientPath)
    if ($running.Count -gt 0) {
        throw (Get-ClientReplacementFailure -ClientPath $ClientPath)
    }
}

function Remove-OldClient {
    param([Parameter(Mandatory = $true)][string]$ClientPath)

    if (-not (Test-Path -LiteralPath $ClientPath)) { return }
    Assert-ClientUnlocked $ClientPath
    try {
        Remove-Item -LiteralPath $ClientPath -Recurse -Force
    } catch {
        throw (Get-ClientReplacementFailure -ClientPath $ClientPath -FailedPath (Get-DeniedClientFileName $_.Exception))
    }
    if (Test-Path -LiteralPath $ClientPath) {
        throw (Get-ClientReplacementFailure -ClientPath $ClientPath)
    }
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
    $target = Join-Path $ModulesPath 'Coop'
    Assert-ClientUnlocked $target
    Get-Archive ([string]$Release.publicUrl) $archive ([long]$Release.bytes) ([string]$Release.sha256) 'Coop client'
    Expand-SevenZipArchive $SevenZip $archive $stage 'Coop client'
    $stagedModule = Join-Path $stage 'Coop'
    if (-not (Test-Path -LiteralPath (Join-Path $stagedModule 'SubModule.xml') -PathType Leaf) -or
        -not (Test-Path -LiteralPath (Join-Path $stagedModule 'bin\Win64_Shipping_Client\Coop.Core.dll') -PathType Leaf)) {
        throw 'The client archive does not contain a valid Coop module.'
    }
    Write-Host "Removing the old Coop client from $target..."
    Remove-OldClient $target
    try {
        Copy-Item -LiteralPath $stagedModule -Destination $target -Recurse -Force
    } catch {
        throw (Get-ClientReplacementFailure -ClientPath $target -FailedPath (Get-DeniedClientFileName $_.Exception))
    }
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

function Get-ServerInstallState {
    param([Parameter(Mandatory = $true)][string]$ServerPath)

    $path = Join-Path $ServerPath '.bannerlordcoop-install.json'
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { return $null }
    try {
        $state = Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
        if ($state.version -ne 1 -or
            [string]$state.baseFingerprint -notmatch '^[a-f0-9]{64}$' -or
            [string]$state.baseSha256 -notmatch '^[a-f0-9]{64}$' -or
            [string]$state.updateSha256 -notmatch '^[a-f0-9]{64}$') { return $null }
        return $state
    } catch { return $null }
}

function Write-ServerInstallState {
    param(
        [Parameter(Mandatory = $true)][string]$ServerPath,
        [Parameter(Mandatory = $true)][object]$Release,
        [string]$InstalledBaseSha256 = ''
    )

    $incremental = $Release.incremental
    if (-not $InstalledBaseSha256) { $InstalledBaseSha256 = [string]$incremental.base.sha256 }
    if ($InstalledBaseSha256 -notmatch '^[a-f0-9]{64}$') {
        throw 'The installed server base SHA-256 is invalid.'
    }
    $state = [ordered]@{
        version = 1
        baseFingerprint = [string]$incremental.baseFingerprint
        baseSha256 = $InstalledBaseSha256
        updateSha256 = [string]$incremental.update.sha256
        installedAt = [datetimeoffset]::UtcNow.ToString('o')
    }
    $path = Join-Path $ServerPath '.bannerlordcoop-install.json'
    $temporary = "$path.new"
    [IO.File]::WriteAllText(
        $temporary,
        (($state | ConvertTo-Json) + "`n"),
        (New-Object Text.UTF8Encoding($false))
    )
    Move-Item -LiteralPath $temporary -Destination $path -Force
}

function Assert-ServerStage {
    param([Parameter(Mandatory = $true)][string]$Stage)

    foreach ($required in @(
        'BannerlordCoopServer.exe',
        'engine\bin\Win64_Shipping_Server\TaleWorlds.Starter.DotNetCore.dll',
        'engine\Modules\Native\SubModule.xml',
        'engine\Modules\Coop\SubModule.xml',
        'engine\Modules\Coop\bin\Win64_Shipping_Server\Coop.Core.dll',
        'engine\Modules\DedicatedServer.Windows\SubModule.xml',
        'engine\Modules\DedicatedServer.Windows\bin\Win64_Shipping_Server\DedicatedServer.Windows.dll'
    )) {
        if (-not (Test-Path -LiteralPath (Join-Path $Stage $required))) {
            throw "The server release is missing $required."
        }
    }
}

function Assert-ServerStopped {
    param([Parameter(Mandatory = $true)][string]$ServerPath)

    $normalized = (Get-NormalizedPath $ServerPath) + [IO.Path]::DirectorySeparatorChar
    $running = @(Get-Process -ErrorAction SilentlyContinue | Where-Object {
        try { $_.Path -and (Get-NormalizedPath $_.Path).StartsWith($normalized, [StringComparison]::OrdinalIgnoreCase) } catch { $false }
    })
    if ($running.Count -gt 0) {
        throw 'The dedicated server is running. Stop it before installing an update.'
    }
}

function Install-ServerIncremental {
    param(
        [Parameter(Mandatory = $true)][object]$Release,
        [Parameter(Mandatory = $true)][string]$ServerPath,
        [Parameter(Mandatory = $true)][string]$SevenZip
    )

    Assert-ServerStopped $ServerPath
    $parent = Split-Path -Parent $ServerPath
    New-Item -ItemType Directory -Path $parent -Force | Out-Null
    $work = Join-Path $parent ('.bannerlordcoop-installer-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $work -Force | Out-Null
    $incremental = $Release.incremental
    $installed = Get-ServerInstallState $ServerPath
    $compatibleFingerprints = @([string]$incremental.baseFingerprint) + @(
        $incremental.compatibleBaseFingerprints | Where-Object { $null -ne $_ }
    )
    $sameBase = $null -ne $installed -and
        $compatibleFingerprints -ccontains [string]$installed.baseFingerprint
    try {
        if ($sameBase -and [string]$installed.updateSha256 -ceq [string]$incremental.update.sha256) {
            Write-Host 'The dedicated server is already up to date.' -ForegroundColor Green
            return
        }
        $updateArchive = Join-Path $work 'server-update.7z'
        $updateStage = Join-Path $work 'update-stage'
        Get-Archive ([string]$incremental.update.publicUrl) $updateArchive ([long]$incremental.update.bytes) ([string]$incremental.update.sha256) 'dedicated server update'
        Expand-SevenZipArchive $SevenZip $updateArchive $updateStage 'dedicated server update'

        if ($sameBase) {
            $requiredOwned = @(
                'BannerlordCoopServer.exe',
                'engine\Modules\Coop',
                'engine\Modules\DedicatedServer.Windows\SubModule.xml',
                'engine\Modules\DedicatedServer.Windows\bin\Win64_Shipping_Server\DedicatedServer.Windows.dll',
                'engine\Modules\DedicatedServer.Windows\bin\Win64_Shipping_Server\DedicatedServer.Core.dll',
                'engine\bin\Win64_Shipping_Server\DedicatedServer.Core.dll',
                'release-info.txt'
            )
            foreach ($relative in $requiredOwned) {
                if (-not (Test-Path -LiteralPath (Join-Path $updateStage $relative))) {
                    throw "The server update is missing $relative."
                }
            }
            $optionalOwned = @(
                'engine\bin\Win64_Shipping_Server\TaleWorlds.Starter.DotNetCore.deps.json',
                'engine\bin\Win64_Shipping_Server\System.Diagnostics.DiagnosticSource.dll',
                'engine\bin\Win64_Shipping_Server\System.Threading.Channels.dll',
                'engine\bin\Win64_Shipping_Server\System.Collections.Immutable.dll',
                'engine\bin\Win64_Shipping_Server\System.Text.Json.dll',
                'engine\bin\Win64_Shipping_Server\System.Reflection.Metadata.dll',
                'engine\bin\Win64_Shipping_Server\System.Text.Encoding.CodePages.dll',
                'engine\bin\Win64_Shipping_Server\System.IO.Pipelines.dll',
                'engine\bin\Win64_Shipping_Server\System.Text.Encodings.Web.dll',
                'engine\bin\Win64_Shipping_Server\Microsoft.Bcl.AsyncInterfaces.dll',
                'engine\bin\Win64_Shipping_Server\default_new_game.sav',
                'server-data\Game Saves\default_new_game.sav',
                'server-data\mod-config.json'
            )
            $owned = @($requiredOwned) + @($optionalOwned | Where-Object {
                Test-Path -LiteralPath (Join-Path $updateStage $_)
            })
            $backup = Join-Path $work 'rollback'
            New-Item -ItemType Directory -Path $backup -Force | Out-Null
            $applied = @()
            try {
                foreach ($relative in $owned) {
                    $target = Join-Path $ServerPath $relative
                    if ($relative -eq 'server-data\mod-config.json' -and
                        (Test-Path -LiteralPath $target -PathType Leaf)) {
                        continue
                    }
                    if (Test-Path -LiteralPath $target) {
                        $backupTarget = Join-Path $backup $relative
                        New-Item -ItemType Directory -Path (Split-Path -Parent $backupTarget) -Force | Out-Null
                        Copy-Item -LiteralPath $target -Destination $backupTarget -Recurse -Force
                    }
                    $applied += $relative
                    Remove-Item -LiteralPath $target -Recurse -Force -ErrorAction SilentlyContinue
                    New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force | Out-Null
                    Copy-Item -LiteralPath (Join-Path $updateStage $relative) -Destination $target -Recurse -Force
                }
                Assert-ServerStage $ServerPath
                Write-ServerInstallState $ServerPath $Release ([string]$installed.baseSha256)
            } catch {
                foreach ($relative in $applied) {
                    $target = Join-Path $ServerPath $relative
                    Remove-Item -LiteralPath $target -Recurse -Force -ErrorAction SilentlyContinue
                    $backupTarget = Join-Path $backup $relative
                    if (Test-Path -LiteralPath $backupTarget) {
                        New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force | Out-Null
                        Copy-Item -LiteralPath $backupTarget -Destination $target -Recurse -Force
                    }
                }
                throw
            }
            Unblock-Installation $ServerPath
            Write-Host 'Dedicated server updated without downloading the unchanged engine and assets.' -ForegroundColor Green
            return
        }

        $baseArchive = Join-Path $work 'server-base.7z'
        $stage = Join-Path $work 'complete-stage'
        Get-Archive ([string]$incremental.base.publicUrl) $baseArchive ([long]$incremental.base.bytes) ([string]$incremental.base.sha256) 'dedicated server base'
        Expand-SevenZipArchive $SevenZip $baseArchive $stage 'dedicated server base'
        Expand-SevenZipArchive $SevenZip $updateArchive $stage 'dedicated server update'
        Assert-ServerStage $stage
        if (Test-Path -LiteralPath (Join-Path $ServerPath 'server-data') -PathType Container) {
            Invoke-Robocopy -Arguments @((Join-Path $ServerPath 'server-data'), (Join-Path $stage 'server-data'), '/E', '/R:2', '/W:1', '/NFL', '/NDL', '/NJH', '/NJS', '/NP')
        }
        Write-ServerInstallState $stage $Release
        $previous = "$ServerPath.previous"
        Remove-Item -LiteralPath $previous -Recurse -Force -ErrorAction SilentlyContinue
        if (Test-Path -LiteralPath $ServerPath) { Move-Item -LiteralPath $ServerPath -Destination $previous }
        try { Move-Item -LiteralPath $stage -Destination $ServerPath } catch {
            if (Test-Path -LiteralPath $previous) { Move-Item -LiteralPath $previous -Destination $ServerPath }
            throw
        }
        Unblock-Installation $ServerPath
        Write-Host 'Dedicated server installed with an incremental-update base.' -ForegroundColor Green
        if (Test-Path -LiteralPath $previous) {
            Write-Host "The previous installation is retained for rollback at $previous" -ForegroundColor Green
        }
    } finally {
        Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
    }
}

function Install-Server {
    param(
        [Parameter(Mandatory = $true)][object]$Release,
        [Parameter(Mandatory = $true)][string]$ServerPath,
        [Parameter(Mandatory = $true)][string]$SevenZip
    )

    if ($null -ne $Release.incremental) {
        Install-ServerIncremental $Release $ServerPath $SevenZip
        return
    }
    $parent = Split-Path -Parent $ServerPath
    New-Item -ItemType Directory -Path $parent -Force | Out-Null
    $work = Join-Path $parent ('.bannerlordcoop-installer-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $work -Force | Out-Null
    try {
        Write-Host ''
        Write-Host 'Installing the Windows dedicated server...' -ForegroundColor Cyan
        $archive = Join-Path $work 'server.7z'
        $stage = Join-Path $work 'stage'
        Get-Archive ([string]$Release.publicUrl) $archive ([long]$Release.bytes) ([string]$Release.sha256) 'dedicated server'
        Expand-SevenZipArchive $SevenZip $archive $stage 'dedicated server'
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

function Show-InstallationComplete {
    param(
        [AllowNull()][string]$ClientPath,
        [AllowNull()][string]$ServerPath,
        [switch]$NoWait
    )

    Write-Host ''
    foreach ($line in @(
        '  ____                              _               _    ____                  '
        ' | __ )  __ _ _ __  _ __   ___ _ __| | ___  _ __ __| |  / ___|___   ___  _ __ '
        ' |  _ \ / _` | ''_ \| ''_ \ / _ \ ''__| |/ _ \| ''__/ _` | | |   / _ \ / _ \| ''_ \'
        ' | |_) | (_| | | | | | | |  __/ |  | | (_) | | | (_| | | |__| (_) | (_) | |_) |'
        ' |____/ \__,_|_| |_|_| |_|\___|_|  |_|\___/|_|  \__,_|  \____\___/ \___/| .__/'
        '                                                                        |_|   '
        '             |\/\/\/|                                       |\/\/\/|'
        '             |######|                                       |######|'
        '             |######|                                       |######|'
        '             |######|                                       |######|'
        '             |######|                                       |######|'
        '              \####/                                         \####/'
        '               \##/                                           \##/'
        '                \/                                             \/'
        '                ||                                             ||'
        '                ||                                             ||'
        '                ||                                             ||'
    )) {
        Write-Host $line -ForegroundColor DarkYellow
    }

    Write-Host ''
    Write-Host 'Installation complete!' -ForegroundColor Green
    Write-Host ''
    Write-Host 'Installation locations:' -ForegroundColor Cyan
    if ($ClientPath) { Write-Host "  Client: $ClientPath" }
    if ($ServerPath) { Write-Host "  Dedicated server: $ServerPath" }
    Write-Host ''
    Write-Host 'Press Enter to close the installer.' -ForegroundColor Yellow
    if (-not $NoWait) { [void](Read-Host) }
}

function Invoke-BannerlordCoopInstaller {
    Write-Host 'BannerlordCoop nightly installer' -ForegroundColor Cyan
    Write-Host 'This downloads and installs the latest completed Supporter and Tester nightly for you.'
    Write-Host ''

    $choice = Read-InstallChoice
    $installClient = $choice -eq 'Client' -or $choice -eq 'Both'
    $installServer = $choice -eq 'Server' -or $choice -eq 'Both'
    $script:NightlyAccessToken = Get-NightlyAccessToken
    $manifest = Get-ReleaseManifest ($choice -eq 'Client')
    $displayDate = Get-NightlyDisplayDate ([string]$manifest.releaseDate) ([string]$manifest.builtAt)
    Write-Host "Latest nightly: $displayDate ($(Get-ShortCommitSha ([string]$manifest.headSha)))"
    $modulesPath = if ($installClient) { Select-ClientModulesPath } else { $null }
    $serverPath = if ($installServer) { Select-ServerPath } else { $null }

    Write-Host ''
    Write-Host 'Ready to install:' -ForegroundColor Cyan
    if ($installClient) { Write-Host "  Client: $modulesPath\Coop" }
    if ($installServer) { Write-Host "  Dedicated server: $serverPath" }
    if (-not (Read-YesNo 'Continue with the installation?' $true)) { throw 'Installation cancelled.' }
    if ($installClient) { Assert-ClientUnlocked (Join-Path $modulesPath 'Coop') }

    $work = Join-Path ([IO.Path]::GetTempPath()) ('BannerlordCoopInstaller-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $work -Force | Out-Null
    try {
        $sevenZip = Get-SevenZip $work
        if ($installClient) { Install-Client $manifest.client $modulesPath $sevenZip $work }
        if ($installServer) { Install-Server $manifest.server $serverPath $sevenZip }
    } finally {
        Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
    }

    $clientPath = if ($installClient) { Join-Path $modulesPath 'Coop' } else { $null }
    Show-InstallationComplete -ClientPath $clientPath -ServerPath $serverPath
}

if ($env:BANNERLORDCOOP_INSTALLER_TEST -ne '1') {
    try {
        Invoke-BannerlordCoopInstaller
    } catch {
        Write-Host ''
        Write-Host "Installation failed: $($_.Exception.Message)" -ForegroundColor Red
        Write-Host 'If you need help, copy this message and ask in the Bannerlord Coop Discord.' -ForegroundColor Yellow
        if ($env:BANNERLORDCOOP_INSTALLER_LAUNCHER -eq '1') { exit 1 }
        throw
    }
}
