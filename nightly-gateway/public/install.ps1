$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
# Windows adds Expect: 100-continue on POST; some DPI and proxies then return an empty body.
try { [Net.ServicePointManager]::Expect100Continue = $false } catch { }

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
$script:NightlyAuthorizationSkipLiveProbes = $env:BANNERLORDCOOP_INSTALLER_TEST -eq '1'
$script:NightlySessionRetrySeconds = if ($script:NightlyAuthorizationSkipLiveProbes) { 0 } else { 1 }
$script:NightlyObservedProcessNames = $null

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
            if ($statusCode -ge 100 -and $statusCode -le 599) { return $statusCode }
        } catch { }
        try { $exception = $exception.InnerException } catch { break }
    }
    $text = ''
    try { $text = [string]$ErrorRecord.Exception.Message } catch { }
    if ($text -match ':\s*(\d{3})\s+\(' -or $text -match '\((\d{3})\)') {
        $parsed = [int]$Matches[1]
        if ($parsed -ge 100 -and $parsed -le 599) { return $parsed }
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

function Get-NightlyErrorRecordText {
    param($ErrorRecord)

    if ($null -eq $ErrorRecord) { return '' }
    try {
        $details = [string]$ErrorRecord.ErrorDetails.Message
        if (-not [string]::IsNullOrWhiteSpace($details)) { return $details.Trim() }
    } catch { }
    try {
        $response = $ErrorRecord.Exception.Response
        if ($null -ne $response) {
            $stream = $null
            try {
                $stream = $response.GetResponseStream()
                if ($null -ne $stream) {
                    return [string](New-Object IO.StreamReader($stream)).ReadToEnd()
                }
            } catch { }
        }
    } catch { }
    return ''
}

function Get-NightlyGatewayErrorCodeFromText {
    param([string]$Text)

    if ([string]::IsNullOrWhiteSpace($Text)) { return '' }
    try { return Get-NightlyGatewayErrorCode ($Text | ConvertFrom-Json) } catch { }
    if ($Text -match '"error"\s*:\s*"([a-z_]+)"') { return $Matches[1] }
    return ''
}

function ConvertTo-NightlyJsonObject {
    param($Value)

    if ($null -eq $Value) { return $null }
    if ($Value -is [string]) {
        $text = $Value.Trim()
        if ($text.StartsWith('{') -or $text.StartsWith('[')) {
            try { return ($text | ConvertFrom-Json) } catch { }
        }
    }
    return $Value
}

function Get-NightlyResponseSnippet {
    param($Response, [string]$Text)

    $value = ''
    if (-not [string]::IsNullOrWhiteSpace($Text)) {
        $value = $Text
    } elseif ($null -ne $Response) {
        if ($Response -is [string]) {
            $value = [string]$Response
        } else {
            try { $value = [string]($Response | ConvertTo-Json -Compress) } catch { $value = [string]$Response }
        }
    }
    if ([string]::IsNullOrWhiteSpace($value)) { return '' }
    $value = ($value -replace '\s+', ' ').Trim()
    $value = $value -replace '(?i)("(?:access_token|device_code|pin|refresh_token)"\s*:\s*")[^"]+"', '$1[redacted]"'
    if ($value.Length -gt 180) { $value = $value.Substring(0, 180) + '...' }
    return $value
}

function Get-NightlyFailureDetailSuffix {
    param(
        $SessionResponse,
        $ErrorRecord,
        [string]$Kind
    )

    $statusCode = 0
    if ($null -ne $ErrorRecord) { $statusCode = Get-HttpStatusCode $ErrorRecord }
    $body = Get-NightlyErrorRecordText $ErrorRecord
    $errorCode = Get-NightlyGatewayErrorCode $SessionResponse
    if (-not $errorCode) { $errorCode = Get-NightlyGatewayErrorCodeFromText $body }
    $exceptionMessage = ''
    if ($null -ne $ErrorRecord) {
        try { $exceptionMessage = [string]$ErrorRecord.Exception.Message } catch { }
    }
    $snippet = Get-NightlyResponseSnippet $SessionResponse $body
    $parts = @()
    if ($statusCode -gt 0) { $parts += "HTTP $statusCode" }
    if ($errorCode) { $parts += "error=$errorCode" }
    if ($Kind -and $Kind -cne 'empty') { $parts += "kind=$Kind" }
    if (-not [string]::IsNullOrWhiteSpace($exceptionMessage)) { $parts += $exceptionMessage }
    if ($snippet -and $snippet -cne $exceptionMessage) { $parts += "body=$snippet" }
    if ($parts.Count -eq 0) { return '' }
    return ' Details: ' + ($parts -join '; ')
}

function Add-NightlyDiagnosisDetails {
    param(
        $Diagnosis,
        $SessionResponse,
        $ErrorRecord,
        [string]$Kind
    )

    $Diagnosis.Message = [string]$Diagnosis.Message + (Get-NightlyFailureDetailSuffix `
        -SessionResponse $SessionResponse -ErrorRecord $ErrorRecord -Kind $Kind)
    return $Diagnosis
}

function Test-NightlyAccessTokenResponse {
    param($Response)

    if ($null -eq $Response) { return $false }
    return [string]$Response.token_type -ceq 'Bearer' -and
        [string]$Response.access_token -match '^[A-Za-z0-9_-]{43}$'
}

function Test-NightlyDeviceSessionResponse {
    param($Response)

    if ($null -eq $Response -or $Response -is [string] -or $Response -is [xml]) { return $false }
    return [string]$Response.device_code -match '^[A-Za-z0-9_-]{43}$' -and
        [string]$Response.user_code -match '^[A-Z2-9]{4}-[A-Z2-9]{4}$' -and
        [string]$Response.verification_uri -match '^https://bannerlordcoop-nightly-gateway\.garrett-luskey\.workers\.dev/activate\?'
}

function Get-NightlyObservedProcessNames {
    if ($null -ne $script:NightlyObservedProcessNames) {
        return @($script:NightlyObservedProcessNames)
    }
    if ($script:NightlyAuthorizationSkipLiveProbes) { return @() }
    try {
        return @(Get-Process -ErrorAction SilentlyContinue | ForEach-Object { $_.ProcessName })
    } catch {
        return @()
    }
}

function Get-NightlyDpiToolName {
    param([string[]]$ProcessNames)

    foreach ($name in @($ProcessNames)) {
        if ($name -match '^(?i:goodbyedpi|gdpi)$') { return 'GoodbyeDPI' }
        if ($name -match '^(?i:winws|zapret)$') { return 'zapret' }
        if ($name -match '^(?i:ciadpi|byedpi|bye-dpi)$') { return 'ByeDPI' }
        if ($name -match '^(?i:spoofdpi)$') { return 'SpoofDPI' }
        if ($name -match '^(?i:powertunnel)$') { return 'PowerTunnel' }
        if ($name -match '^(?i:greentunnel)$') { return 'GreenTunnel' }
        if ($name -match '^(?i:youtubeunblock)$') { return 'youtubeUnblock' }
    }
    return ''
}

function Test-NightlyPhoneQrRecommended {
    param([string[]]$ProcessNames)

    if (-not $PSBoundParameters.ContainsKey('ProcessNames')) {
        $ProcessNames = Get-NightlyObservedProcessNames
    }
    if (Get-NightlyDpiToolName $ProcessNames) { return $true }
    if ($script:NightlyAuthorizationSkipLiveProbes) { return $false }
    return Test-WinDivertServiceRunning
}

function Initialize-QrGaloisField {
    if ($null -ne $script:QrGfExp) { return }
    $exp = New-Object 'int[]' 512
    $log = New-Object 'int[]' 256
    $x = 1
    for ($i = 0; $i -lt 255; $i++) {
        $exp[$i] = $x
        $log[$x] = $i
        $x = $x -shl 1
        if ($x -ge 256) { $x = $x -bxor 285 }
    }
    for ($i = 255; $i -lt 512; $i++) { $exp[$i] = $exp[$i - 255] }
    $script:QrGfExp = $exp
    $script:QrGfLog = $log
}

function Get-QrGfMultiply {
    param([int]$Left, [int]$Right)

    if ($Left -eq 0 -or $Right -eq 0) { return 0 }
    Initialize-QrGaloisField
    return $script:QrGfExp[$script:QrGfLog[$Left] + $script:QrGfLog[$Right]]
}

function Get-QrReedSolomonRemainder {
    param([int[]]$Data, [int]$Degree)

    Initialize-QrGaloisField
    $generator = @(1)
    for ($i = 0; $i -lt $Degree; $i++) {
        $next = New-Object 'int[]' ($generator.Count + 1)
        for ($j = 0; $j -lt $generator.Count; $j++) {
            $next[$j] = $next[$j] -bxor $generator[$j]
            $next[$j + 1] = $next[$j + 1] -bxor (Get-QrGfMultiply $generator[$j] $script:QrGfExp[$i])
        }
        $generator = $next
    }
    $remainder = New-Object 'int[]' $Degree
    foreach ($byte in $Data) {
        $factor = $byte -bxor $remainder[0]
        for ($i = 0; $i -lt ($Degree - 1); $i++) { $remainder[$i] = $remainder[$i + 1] }
        $remainder[$Degree - 1] = 0
        if ($factor -eq 0) { continue }
        for ($i = 0; $i -lt $Degree; $i++) {
            $remainder[$i] = $remainder[$i] -bxor (Get-QrGfMultiply $generator[$i + 1] $factor)
        }
    }
    return ,$remainder
}

function Get-QrByteCodewords {
    param([byte[]]$Payload)

    # Version 5-L holds 108 data codewords; activate URLs stay under that.
    $capacity = 108
    if ($Payload.Length -gt 104) {
        throw 'The verification link is too long to encode as a QR code.'
    }
    $bits = New-Object System.Collections.Generic.List[int]
    foreach ($bit in @(0, 1, 0, 0)) { $bits.Add($bit) }
    for ($i = 7; $i -ge 0; $i--) { $bits.Add((($Payload.Length -shr $i) -band 1)) }
    foreach ($byte in $Payload) {
        for ($i = 7; $i -ge 0; $i--) { $bits.Add((($byte -shr $i) -band 1)) }
    }
    $terminator = [Math]::Min(4, (8 * $capacity) - $bits.Count)
    for ($i = 0; $i -lt $terminator; $i++) { $bits.Add(0) }
    while ($bits.Count % 8 -ne 0) { $bits.Add(0) }
    $pad = @(0xEC, 0x11)
    $padIndex = 0
    while ($bits.Count -lt (8 * $capacity)) {
        $byte = $pad[$padIndex % 2]
        $padIndex += 1
        for ($i = 7; $i -ge 0; $i--) { $bits.Add((($byte -shr $i) -band 1)) }
    }
    $codewords = New-Object 'int[]' $capacity
    for ($i = 0; $i -lt $capacity; $i++) {
        $value = 0
        for ($b = 0; $b -lt 8; $b++) { $value = ($value -shl 1) -bor $bits[(8 * $i) + $b] }
        $codewords[$i] = $value
    }
    return ,$codewords
}

function Test-QrFunctionModule {
    param([int]$Row, [int]$Column, [int]$Size)

    if ($Row -le 8 -and $Column -le 8) { return $true }
    if ($Row -le 8 -and $Column -ge ($Size - 8)) { return $true }
    if ($Row -ge ($Size - 8) -and $Column -le 8) { return $true }
    if ($Row -eq 6 -or $Column -eq 6) { return $true }
    return ($Row -ge 28 -and $Row -le 32 -and $Column -ge 28 -and $Column -le 32)
}

function Set-QrFinder {
    param($Modules, [int]$Row, [int]$Column)

    for ($r = -1; $r -le 7; $r++) {
        for ($c = -1; $c -le 7; $c++) {
            $rr = $Row + $r
            $cc = $Column + $c
            if ($rr -lt 0 -or $cc -lt 0 -or $rr -ge $Modules.Length -or $cc -ge $Modules.Length) { continue }
            $on = ($r -ge 0 -and $r -le 6 -and $c -ge 0 -and $c -le 6) -and (
                $r -eq 0 -or $r -eq 6 -or $c -eq 0 -or $c -eq 6 -or
                ($r -ge 2 -and $r -le 4 -and $c -ge 2 -and $c -le 4)
            )
            $Modules[$rr][$cc] = [int]$on
        }
    }
}

function Set-QrAlignment {
    param($Modules, [int]$CenterRow, [int]$CenterColumn)

    for ($r = -2; $r -le 2; $r++) {
        for ($c = -2; $c -le 2; $c++) {
            $on = $r -eq -2 -or $r -eq 2 -or $c -eq -2 -or $c -eq 2 -or ($r -eq 0 -and $c -eq 0)
            $Modules[$CenterRow + $r][$CenterColumn + $c] = [int]$on
        }
    }
}

function Test-QrMask {
    param([int]$Pattern, [int]$Row, [int]$Column)

    switch ($Pattern) {
        0 { return (($Row + $Column) % 2) -eq 0 }
        1 { return ($Row % 2) -eq 0 }
        2 { return ($Column % 3) -eq 0 }
        3 { return (($Row + $Column) % 3) -eq 0 }
        4 { return (([int][Math]::Floor($Row / 2) + [int][Math]::Floor($Column / 3)) % 2) -eq 0 }
        5 { return (($Row * $Column) % 2) + (($Row * $Column) % 3) -eq 0 }
        6 { return (((($Row * $Column) % 2) + (($Row * $Column) % 3)) % 2) -eq 0 }
        7 { return (((($Row + $Column) % 2) + (($Row * $Column) % 3)) % 2) -eq 0 }
        default { return $false }
    }
}

function Get-QrBitLength {
    param([uint32]$Value)

    $length = 0
    while ($Value -ne 0) {
        $length += 1
        $Value = $Value -shr 1
    }
    return $length
}

function Get-QrFormatInfo {
    param([int]$Mask)

    # Level L is 01. Place LSB-first to match common scanner format layout.
    $data = [uint32]((1 -shl 3) -bor $Mask)
    $generator = [uint32]1335
    $remainder = $data -shl 10
    while ((Get-QrBitLength $remainder) -ge (Get-QrBitLength $generator)) {
        $remainder = $remainder -bxor ($generator -shl ((Get-QrBitLength $remainder) - (Get-QrBitLength $generator)))
    }
    return [int](21522 -bxor (($data -shl 10) -bor $remainder))
}

function Test-QrFormatBit {
    param([int]$FormatInfo, [int]$Index)

    return [int](($FormatInfo -shr $Index) -band 1)
}

function Set-QrFormatBits {
    param($Modules, [int]$Mask)

    $info = Get-QrFormatInfo $Mask
    $size = $Modules.Length
    for ($i = 0; $i -lt 15; $i++) {
        $bit = Test-QrFormatBit $info $i
        if ($i -lt 6) { $Modules[$i][8] = $bit }
        elseif ($i -lt 8) { $Modules[$i + 1][8] = $bit }
        else { $Modules[$size - 15 + $i][8] = $bit }
    }
    for ($i = 0; $i -lt 15; $i++) {
        $bit = Test-QrFormatBit $info $i
        if ($i -lt 8) { $Modules[8][$size - $i - 1] = $bit }
        elseif ($i -lt 9) { $Modules[8][15 - $i] = $bit }
        else { $Modules[8][14 - $i] = $bit }
    }
    $Modules[$size - 8][8] = 1
}

function Get-QrCodeModules {
    param(
        [Parameter(Mandatory = $true)][string]$Text,
        [int]$Mask = 7
    )

    $payload = [Text.Encoding]::UTF8.GetBytes($Text)
    $data = Get-QrByteCodewords $payload
    $ec = Get-QrReedSolomonRemainder -Data $data -Degree 26
    $bits = New-Object System.Collections.Generic.List[int]
    foreach ($byte in @($data + $ec)) {
        for ($i = 7; $i -ge 0; $i--) { $bits.Add((($byte -shr $i) -band 1)) }
    }
    for ($i = 0; $i -lt 7; $i++) { $bits.Add(0) }

    $size = 37
    $base = New-Object 'object[]' $size
    for ($r = 0; $r -lt $size; $r++) { $base[$r] = New-Object 'int[]' $size }
    Set-QrFinder $base 0 0
    Set-QrFinder $base 0 ($size - 7)
    Set-QrFinder $base ($size - 7) 0
    Set-QrAlignment $base 30 30
    for ($i = 8; $i -lt ($size - 8); $i++) {
        $base[6][$i] = [int](($i % 2) -eq 0)
        $base[$i][6] = [int](($i % 2) -eq 0)
    }

    $bitIndex = 0
    $up = $true
    $column = $size - 1
    while ($column -gt 0) {
        if ($column -eq 6) { $column -= 1 }
        for ($row = 0; $row -lt $size; $row++) {
            $r = if ($up) { $size - 1 - $row } else { $row }
            foreach ($offset in @(0, 1)) {
                $c = $column - $offset
                if (Test-QrFunctionModule $r $c $size) { continue }
                $bit = 0
                if ($bitIndex -lt $bits.Count) {
                    $bit = $bits[$bitIndex]
                    $bitIndex += 1
                }
                $base[$r][$c] = $bit
            }
        }
        $up = -not $up
        $column -= 2
    }

    if ($Mask -lt 0 -or $Mask -gt 7) { $Mask = 7 }
    for ($r = 0; $r -lt $size; $r++) {
        for ($c = 0; $c -lt $size; $c++) {
            if (Test-QrFunctionModule $r $c $size) { continue }
            if (Test-QrMask $Mask $r $c) {
                $base[$r][$c] = 1 - $base[$r][$c]
            }
        }
    }
    Set-QrFormatBits $base $Mask
    return ,$base
}

function Get-QrCodeText {
    param([Parameter(Mandatory = $true)][string]$Text)

    $modules = Get-QrCodeModules $Text
    $size = $modules.Length
    $quiet = 2
    $lines = New-Object System.Collections.Generic.List[string]
    $width = $size + (2 * $quiet)
    for ($r = 0; $r -lt $width; $r += 2) {
        $line = ''
        for ($c = 0; $c -lt $width; $c++) {
            $topRow = $r - $quiet
            $bottomRow = $r + 1 - $quiet
            $col = $c - $quiet
            $top = 0
            $bottom = 0
            if ($topRow -ge 0 -and $topRow -lt $size -and $col -ge 0 -and $col -lt $size) {
                $top = $modules[$topRow][$col]
            }
            if ($bottomRow -ge 0 -and $bottomRow -lt $size -and $col -ge 0 -and $col -lt $size) {
                $bottom = $modules[$bottomRow][$col]
            }
            if ($top -eq 1 -and $bottom -eq 1) { $line += [char]0x2588 }
            elseif ($top -eq 1) { $line += [char]0x2580 }
            elseif ($bottom -eq 1) { $line += [char]0x2584 }
            else { $line += ' ' }
        }
        $lines.Add($line)
    }
    return ($lines -join [Environment]::NewLine)
}

function Get-NightlyPhoneVerificationHtml {
    param([Parameter(Mandatory = $true)][string]$VerificationUri)

    $modules = Get-QrCodeModules $VerificationUri
    $size = $modules.Length
    $quiet = 4
    $view = $size + (2 * $quiet)
    $rects = New-Object System.Collections.Generic.List[string]
    for ($r = 0; $r -lt $size; $r++) {
        for ($c = 0; $c -lt $size; $c++) {
            if ($modules[$r][$c] -ne 1) { continue }
            $rects.Add("<rect x=`"$($c + $quiet)`" y=`"$($r + $quiet)`" width=`"1`" height=`"1`"/>")
        }
    }
    $safeUri = [Net.WebUtility]::HtmlEncode($VerificationUri)
    return @"
<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Bannerlord Coop verification</title>
<style>
body { margin: 0; font: 16px/1.4 Segoe UI, sans-serif; background: #111; color: #eee; text-align: center; padding: 24px; }
svg { width: min(72vw, 72vh); height: auto; background: #fff; }
a { color: #8ec8ff; word-break: break-all; }
</style></head>
<body>
<p>Scan this with your phone using <strong>mobile data</strong>, not this Wi-Fi.</p>
<svg viewBox="0 0 $view $view" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges">
<rect width="$view" height="$view" fill="#fff"/>
<g fill="#000">$($rects -join '')</g>
</svg>
<p><a href="$safeUri">$safeUri</a></p>
</body></html>
"@
}

function Show-NightlyPhoneVerification {
    param(
        [Parameter(Mandatory = $true)][string]$VerificationUri,
        [string]$ToolName = 'GoodbyeDPI'
    )

    Write-Host ''
    Write-Host "$ToolName is running, so Discord on this PC may not load." -ForegroundColor Yellow
    Write-Host 'Scan this QR with your phone using mobile data, not this Wi-Fi.'
    Write-Host $VerificationUri -ForegroundColor Yellow
    Write-Host (Get-QrCodeText $VerificationUri)
    if ($script:NightlyAuthorizationSkipLiveProbes) { return }
    $html = Join-Path ([IO.Path]::GetTempPath()) ('BannerlordCoop-verify-' + [guid]::NewGuid().ToString('N') + '.html')
    [IO.File]::WriteAllText($html, (Get-NightlyPhoneVerificationHtml $VerificationUri))
    Start-Process $html
}

function Test-CloudflareWarpRunning {
    param([string[]]$ProcessNames)

    return [bool](@($ProcessNames) | Where-Object { $_ -match '^(?i:warp-svc|warpsvc|cloudflarewarp|cloudflare warp)$' })
}

function Test-WinDivertServiceRunning {
    try {
        return [bool]@(Get-Service -ErrorAction SilentlyContinue | Where-Object {
            $_.Status -eq 'Running' -and $_.Name -match '(?i)windivert'
        })
    } catch {
        return $false
    }
}

function Test-PrivateOrLocalAddress {
    param([string]$Address)

    $parsed = $null
    try { $parsed = [Net.IPAddress]::Parse($Address) } catch { return $false }
    if ([Net.IPAddress]::IsLoopback($parsed)) { return $true }
    if ($parsed.AddressFamily -eq [Net.Sockets.AddressFamily]::InterNetworkV6) {
        if ($parsed.IsIPv6LinkLocal) { return $true }
        $bytes = $parsed.GetAddressBytes()
        return ($bytes[0] -band 0xfe) -eq 0xfc
    }
    $bytes = $parsed.GetAddressBytes()
    return ($bytes[0] -eq 10) -or
        ($bytes[0] -eq 192 -and $bytes[1] -eq 168) -or
        ($bytes[0] -eq 172 -and $bytes[1] -ge 16 -and $bytes[1] -le 31) -or
        ($bytes[0] -eq 169 -and $bytes[1] -eq 254)
}

function Get-NightlyHttpsInspectionProduct {
    param([string]$Issuer)

    if ([string]::IsNullOrWhiteSpace($Issuer)) { return '' }
    if ($Issuer -match '(?i)cloudflare|google trust|gts we|let''s encrypt|lets encrypt|digicert|amazon|microsoft') {
        return ''
    }
    if ($Issuer -match '(?i)kaspersky') { return 'Kaspersky' }
    if ($Issuer -match '(?i)bitdefender') { return 'Bitdefender' }
    if ($Issuer -match '(?i)\bavast\b') { return 'Avast' }
    if ($Issuer -match '(?i)\bavg\b') { return 'AVG' }
    if ($Issuer -match '(?i)\beset\b') { return 'ESET' }
    if ($Issuer -match '(?i)norton|symantec') { return 'Norton' }
    if ($Issuer -match '(?i)fortinet|fortigate') { return 'Fortinet' }
    if ($Issuer -match '(?i)sophos') { return 'Sophos' }
    if ($Issuer -match '(?i)trend.?micro') { return 'Trend Micro' }
    if ($Issuer -match '(?i)cisco|umbrella') { return 'Cisco' }
    if ($Issuer -match '(?i)palo alto') { return 'Palo Alto' }
    if ($Issuer -match '(?i)https.?inspect|ssl.?inspect|web.?filter') { return 'HTTPS inspection' }
    return ''
}

function Get-NightlyResponseInterceptKind {
    param($Response)

    if ($null -eq $Response) { return 'empty' }
    if ($Response -is [string]) {
        if ($Response -match '(?i)just a moment|cf-browser-verification|cdn-cgi/challenge-platform|attention required') {
            return 'cloudflare_challenge'
        }
        if ($Response -match '(?i)<html|<!doctype') { return 'html' }
        return 'text'
    }
    if ($Response -is [xml]) { return 'html' }
    if (Test-NightlyDeviceSessionResponse $Response) { return 'session' }
    return 'invalid'
}

function Get-NightlyGatewayTlsIssuer {
    $hostName = ([Uri]$script:NightlyGatewayUri).Host
    $client = $null
    $ssl = $null
    try {
        $client = New-Object Net.Sockets.TcpClient
        $client.ReceiveTimeout = 4000
        $client.SendTimeout = 4000
        $pending = $client.BeginConnect($hostName, 443, $null, $null)
        if (-not $pending.AsyncWaitHandle.WaitOne(4000, $false)) { return '' }
        $client.EndConnect($pending)
        $ssl = New-Object Net.Security.SslStream($client.GetStream(), $false, { $true })
        $ssl.ReadTimeout = 4000
        $ssl.WriteTimeout = 4000
        $ssl.AuthenticateAsClient($hostName)
        if ($null -eq $ssl.RemoteCertificate) { return '' }
        $cert = New-Object Security.Cryptography.X509Certificates.X509Certificate2($ssl.RemoteCertificate)
        return [string]$cert.Issuer
    } catch {
        return ''
    } finally {
        if ($null -ne $ssl) { $ssl.Dispose() }
        if ($null -ne $client) { $client.Close() }
    }
}

function Get-NightlyGatewayDnsAddresses {
    $hostName = ([Uri]$script:NightlyGatewayUri).Host
    try {
        return @([Net.Dns]::GetHostAddresses($hostName) | ForEach-Object { $_.ToString() })
    } catch {
        return @()
    }
}

function Get-NightlyAuthorizationDiagnosis {
    param(
        $SessionResponse,
        $ErrorRecord,
        [string[]]$ProcessNames,
        [string]$TlsIssuer,
        [string[]]$DnsAddresses,
        $WinDivertRunning
    )

    if (-not $PSBoundParameters.ContainsKey('ProcessNames')) {
        $ProcessNames = Get-NightlyObservedProcessNames
    }
    $probed = -not $script:NightlyAuthorizationSkipLiveProbes
    if ($probed) {
        if (-not $PSBoundParameters.ContainsKey('TlsIssuer')) {
            $TlsIssuer = Get-NightlyGatewayTlsIssuer
        }
        if (-not $PSBoundParameters.ContainsKey('DnsAddresses')) {
            $DnsAddresses = Get-NightlyGatewayDnsAddresses
        }
        if (-not $PSBoundParameters.ContainsKey('WinDivertRunning')) {
            $WinDivertRunning = Test-WinDivertServiceRunning
        }
    } elseif (-not $PSBoundParameters.ContainsKey('WinDivertRunning')) {
        $WinDivertRunning = $false
    }
    if ($null -eq $DnsAddresses) { $DnsAddresses = @() }

    $SessionResponse = ConvertTo-NightlyJsonObject $SessionResponse
    $dpiTool = Get-NightlyDpiToolName $ProcessNames
    $warpRunning = Test-CloudflareWarpRunning $ProcessNames
    $inspection = Get-NightlyHttpsInspectionProduct $TlsIssuer
    $dnsHijacked = [bool](@($DnsAddresses) | Where-Object { Test-PrivateOrLocalAddress $_ })
    $kind = Get-NightlyResponseInterceptKind $SessionResponse
    $statusCode = 0
    $errorCode = Get-NightlyGatewayErrorCode $SessionResponse
    if ($null -ne $ErrorRecord) {
        $statusCode = Get-HttpStatusCode $ErrorRecord
        if (-not $errorCode) { $errorCode = Get-NightlyGatewayErrorCodeFromText (Get-NightlyErrorRecordText $ErrorRecord) }
    }

    if ($dpiTool) {
        $message = if ($warpRunning) {
            "$dpiTool is still running and is blocking nightly authorization. Turn off $dpiTool, then run the installer again."
        } else {
            "$dpiTool is running and is blocking nightly authorization. Turn off $dpiTool, or enable Cloudflare WARP, then run the installer again."
        }
        return Add-NightlyDiagnosisDetails ([pscustomobject]@{ Code = 'dpi_tool'; Message = $message }) $SessionResponse $ErrorRecord $kind
    }
    if ($WinDivertRunning) {
        $message = if ($warpRunning) {
            'A GoodbyeDPI or zapret network driver is still active and is blocking nightly authorization. Turn that tool off, then run the installer again.'
        } else {
            'A GoodbyeDPI or zapret network driver is active and is blocking nightly authorization. Turn that tool off, or enable Cloudflare WARP, then run the installer again.'
        }
        return Add-NightlyDiagnosisDetails ([pscustomobject]@{ Code = 'windivert'; Message = $message }) $SessionResponse $ErrorRecord $kind
    }
    if ($inspection) {
        return Add-NightlyDiagnosisDetails ([pscustomobject]@{
            Code = 'https_inspection'
            Message = "Antivirus HTTPS scanning ($inspection) is intercepting the nightly gateway. Turn off HTTPS or encrypted scanning, or enable Cloudflare WARP, then run the installer again."
        }) $SessionResponse $ErrorRecord $kind
    }
    if ($dnsHijacked) {
        return Add-NightlyDiagnosisDetails ([pscustomobject]@{
            Code = 'dns_hijack'
            Message = 'DNS for the nightly gateway is being redirected locally. Set DNS to 1.1.1.1, or enable Cloudflare WARP, then run the installer again.'
        }) $SessionResponse $ErrorRecord $kind
    }
    if ($probed -and @($DnsAddresses).Count -eq 0) {
        return Add-NightlyDiagnosisDetails ([pscustomobject]@{
            Code = 'dns_failure'
            Message = 'The nightly gateway hostname could not be resolved. Set DNS to 1.1.1.1, or enable Cloudflare WARP, then run the installer again.'
        }) $SessionResponse $ErrorRecord $kind
    }
    if ($kind -ceq 'cloudflare_challenge') {
        return Add-NightlyDiagnosisDetails ([pscustomobject]@{
            Code = 'cloudflare_challenge'
            Message = 'Cloudflare challenged this installer request. Enable Cloudflare WARP, or turn off GoodbyeDPI / VPN / DNS tools, then run the installer again.'
        }) $SessionResponse $ErrorRecord $kind
    }
    if ($kind -ceq 'html' -or $kind -ceq 'text') {
        return Add-NightlyDiagnosisDetails ([pscustomobject]@{
            Code = 'html_intercept'
            Message = 'A network filter replaced the nightly authorization response. Enable Cloudflare WARP, or turn off GoodbyeDPI / antivirus HTTPS scanning, then run the installer again.'
        }) $SessionResponse $ErrorRecord $kind
    }
    if ($errorCode -ceq 'internal_error') {
        return Add-NightlyDiagnosisDetails ([pscustomobject]@{
            Code = 'internal_error'
            Message = 'The nightly authorization service failed. Wait a minute and run the installer again.'
        }) $SessionResponse $ErrorRecord $kind
    }
    if ($statusCode -gt 0) {
        return Add-NightlyDiagnosisDetails ([pscustomobject]@{
            Code = 'http_error'
            Message = "The nightly authorization service returned HTTP $statusCode. If you use GoodbyeDPI or another DNS tool, try Cloudflare WARP or turn that tool off, then run the installer again."
        }) $SessionResponse $ErrorRecord $kind
    }
    return Add-NightlyDiagnosisDetails ([pscustomobject]@{
        Code = 'invalid_response'
        Message = 'The nightly authorization service returned an invalid response. If you use GoodbyeDPI or another DNS tool, try Cloudflare WARP or turn that tool off, then run the installer again.'
    }) $SessionResponse $ErrorRecord $kind
}

function Get-NightlyDeviceSessionFromCurl {
    $curl = Join-Path $env:SystemRoot 'System32\curl.exe'
    if (-not (Test-Path -LiteralPath $curl -PathType Leaf)) { return $null }
    $output = & $curl --silent --show-error --connect-timeout 15 --max-time 30 `
        --user-agent 'BannerlordCoopInstaller' `
        -X POST --data 'client=installer' `
        -H 'Content-Type: application/x-www-form-urlencoded' `
        "$($script:NightlyGatewayUri)/v1/device/sessions" 2>&1
    return ConvertTo-NightlyJsonObject ([string]($output | Out-String))
}

function Get-NightlyDeviceSessionFailureMessage {
    param(
        $SessionResponse,
        $ErrorRecord
    )

    return [string](Get-NightlyAuthorizationDiagnosis -SessionResponse $SessionResponse -ErrorRecord $ErrorRecord).Message
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

    $session = $null
    $lastRecord = $null
    for ($attempt = 1; $attempt -le 2; $attempt++) {
        try {
            $session = ConvertTo-NightlyJsonObject (Invoke-RestMethod -Method Post `
                -Uri "$($script:NightlyGatewayUri)/v1/device/sessions" `
                -ContentType 'application/x-www-form-urlencoded' -Body 'client=installer')
            $lastRecord = $null
            if (Test-NightlyDeviceSessionResponse $session) { break }
        } catch {
            $lastRecord = $_
            $session = $null
        }
        if ($attempt -lt 2 -and $script:NightlySessionRetrySeconds -gt 0) {
            Start-Sleep -Seconds $script:NightlySessionRetrySeconds
        }
    }
    if (-not (Test-NightlyDeviceSessionResponse $session) -and -not $script:NightlyAuthorizationSkipLiveProbes) {
        $curlSession = Get-NightlyDeviceSessionFromCurl
        if (Test-NightlyDeviceSessionResponse $curlSession) { $session = $curlSession }
    }
    if (-not (Test-NightlyDeviceSessionResponse $session)) {
        throw (Get-NightlyDeviceSessionFailureMessage -SessionResponse $session -ErrorRecord $lastRecord)
    }
    Write-Host "Verification code: $($session.user_code)" -ForegroundColor Yellow
    $verificationUri = [string]$session.verification_uri
    if (Test-NightlyPhoneQrRecommended) {
        $dpiTool = Get-NightlyDpiToolName (Get-NightlyObservedProcessNames)
        if (-not $dpiTool) { $dpiTool = 'GoodbyeDPI' }
        Show-NightlyPhoneVerification -VerificationUri $verificationUri -ToolName $dpiTool
    }
    Write-Host 'Opening Discord verification in your browser...'
    Start-Process $verificationUri

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

function Get-InstallerPin {
    $value = [string]$env:BANNERLORDCOOP_INSTALLER_PIN
    if ([string]::IsNullOrWhiteSpace($value)) { return '' }
    $pin = $value.Trim()
    if ($pin -notmatch '^[A-Za-z0-9_-]{43}$') {
        throw 'The create-build installer pin is invalid. Ask staff for a new /create-build link.'
    }
    return $pin
}

function Get-CreateBuildPinRedeemDecision {
    param($Response, $ErrorRecord)

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

    if ($statusCode -eq 409 -or $errorCode -ceq 'already_used') {
        return [pscustomobject]@{
            Action = 'Fail'
            Token = ''
            Message = 'That create-build installer link was already used. Ask staff for a new /create-build link.'
        }
    }
    if ($errorCode -ceq 'expired_token') {
        return [pscustomobject]@{
            Action = 'Fail'
            Token = ''
            Message = 'That create-build installer link has expired. Ask staff for a new /create-build link.'
        }
    }
    if ($errorCode -ceq 'pin_incomplete') {
        return [pscustomobject]@{
            Action = 'Fail'
            Token = ''
            Message = 'That create-build installer is not ready yet. Ask staff to run /create-build again.'
        }
    }
    if ($statusCode -eq 400 -or $statusCode -eq 401 -or $errorCode -ceq 'invalid_request') {
        return [pscustomobject]@{
            Action = 'Fail'
            Token = ''
            Message = 'That create-build installer link is invalid. Ask staff for a new /create-build link.'
        }
    }
    if ($null -eq $ErrorRecord) {
        return [pscustomobject]@{
            Action = 'Fail'
            Token = ''
            Message = 'The create-build installer service returned an invalid response.'
        }
    }
    return [pscustomobject]@{ Action = 'Rethrow'; Token = ''; Message = '' }
}

function Get-CreateBuildPinAccessToken {
    param([Parameter(Mandatory = $true)][string]$Pin)

    Write-Host ''
    Write-Host 'Create-build installer' -ForegroundColor Cyan
    Write-Host 'Redeeming the one-time installer link for this exact client and dedicated-server pair.'
    $decision = $null
    try {
        $response = Invoke-RestMethod -Method Post -Uri "$($script:NightlyGatewayUri)/v1/pins/token" `
            -ContentType 'application/x-www-form-urlencoded' `
            -Body @{ pin = $Pin }
        $decision = Get-CreateBuildPinRedeemDecision -Response $response
    } catch {
        $decision = Get-CreateBuildPinRedeemDecision -ErrorRecord $_
    }
    if ($decision.Action -eq 'Accept') { return [string]$decision.Token }
    if ($decision.Action -eq 'Fail') { throw $decision.Message }
    throw
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

function Get-UnpublishedNightlyMessage {
    param([bool]$ClientOnly = $false)

    if ($ClientOnly) {
        return "Last night's supporter client nightly is not available yet. Nightlies usually finish after midnight Central and appear in Discord #nightly-releases. Wait for today's post, then run the installer again."
    }
    return "Last night's supporter client and dedicated-server nightly is not available yet. Nightlies usually finish after midnight Central and appear in Discord #nightly-releases. Wait for today's post, then run the installer again."
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
            throw (Get-UnpublishedNightlyMessage $ClientOnly)
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

function Test-PinClientArtifactUri {
    param([Parameter(Mandatory = $true)][string]$Uri)

    try { $parsed = [Uri]$Uri } catch { return $false }
    if ($parsed.Scheme -cne 'https' -or
        $parsed.Host -cne 'bannerlordcoop-nightly-gateway.garrett-luskey.workers.dev' -or
        -not [string]::IsNullOrEmpty($parsed.Query) -or
        -not [string]::IsNullOrEmpty($parsed.Fragment)) { return $false }
    return $parsed.AbsolutePath -cmatch '^/v1/artifacts/pins/\d{17,20}/Coop\.7z$'
}

function Test-PinServerArtifactUri {
    param([Parameter(Mandatory = $true)][string]$Uri)

    try { $parsed = [Uri]$Uri } catch { return $false }
    if ($parsed.Scheme -cne 'https' -or
        $parsed.Host -cne 'pub-bf6bfe4b880e4d1b83f4b09b10419f78.r2.dev' -or
        -not [string]::IsNullOrEmpty($parsed.Query) -or
        -not [string]::IsNullOrEmpty($parsed.Fragment)) { return $false }
    return $parsed.AbsolutePath -cmatch '^/manual/\d{17,20}/[A-Za-z0-9][A-Za-z0-9._-]{0,199}\.7z$'
}

function Get-PinManifest {
    $headers = Get-NightlyHeaders
    Write-Host 'Loading the pinned create-build release...'
    try {
        $manifest = Invoke-RestMethod -Method Get -Uri "$($script:NightlyGatewayUri)/v1/manifests/pin" -Headers $headers
    } catch {
        $statusCode = Get-HttpStatusCode $_
        if ($statusCode -eq 401 -or $statusCode -eq 403) {
            throw 'The create-build installer session expired. Ask staff for a new /create-build link.'
        }
        throw
    }
    $clientBytes = 0L
    $serverBytes = 0L
    $validClientBytes = [long]::TryParse([string]$manifest.client.bytes, [ref]$clientBytes)
    $validServerBytes = [long]::TryParse([string]$manifest.server.bytes, [ref]$serverBytes)
    if ($manifest.version -ne 1 -or
        [string]$manifest.kind -cne 'create-build-pin' -or
        [string]$manifest.releaseDate -notmatch '^\d{4}-\d{2}-\d{2}$' -or
        [string]$manifest.clientSha -notmatch '^[a-f0-9]{40}$' -or
        [string]$manifest.serverSha -notmatch '^[a-f0-9]{40}$' -or
        [string]$manifest.headSha -cne [string]$manifest.clientSha -or
        -not (Test-PinClientArtifactUri ([string]$manifest.client.publicUrl)) -or
        [string]$manifest.client.sha256 -notmatch '^[a-f0-9]{64}$' -or
        -not $validClientBytes -or $clientBytes -le 0 -or $clientBytes -gt 8388608L -or
        [string]$manifest.client.fileName -cne 'Coop.7z' -or
        -not (Test-PinServerArtifactUri ([string]$manifest.server.publicUrl)) -or
        [string]$manifest.server.sha256 -notmatch '^[a-f0-9]{64}$' -or
        -not $validServerBytes -or $serverBytes -le 0 -or $serverBytes -gt 6442450944L -or
        [string]$manifest.server.fileName -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]{0,199}\.7z$' -or
        $null -ne $manifest.server.incremental) {
        throw 'The create-build installer manifest is invalid.'
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

function Get-ArchiveAuthorization {
    param([Parameter(Mandatory = $true)][string]$Uri)

    try { $parsed = [Uri]$Uri } catch { throw 'The download URL is invalid.' }
    if ($parsed.Scheme -cne 'https') { throw 'The download URL is invalid.' }
    if ($parsed.Host -ceq ([Uri]$script:NightlyGatewayUri).Host) {
        if ([string]::IsNullOrWhiteSpace([string]$script:NightlyAccessToken)) {
            throw 'Nightly access has not been verified.'
        }
        return [string]$script:NightlyAccessToken
    }
    return $null
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
    $archiveAuthorization = Get-ArchiveAuthorization $Uri
    if ($archiveAuthorization) {
        $http.DefaultRequestHeaders.Authorization = New-Object System.Net.Http.Headers.AuthenticationHeaderValue(
            'Bearer',
            $archiveAuthorization
        )
    }
    try {
        $response = $http.GetAsync($Uri, [Net.Http.HttpCompletionOption]::ResponseHeadersRead).GetAwaiter().GetResult()
        if (-not $response.IsSuccessStatusCode) {
            $statusCode = [int]$response.StatusCode
            if ($statusCode -eq 404) {
                throw (Get-UnpublishedNightlyMessage ($Label -eq 'client'))
            }
            throw "$Label download failed (HTTP $statusCode)."
        }
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
    $installerPin = Get-InstallerPin
    if ($installerPin) {
        Write-Host 'BannerlordCoop create-build installer' -ForegroundColor Cyan
        Write-Host 'This installs one staff-created client and dedicated-server pair. The link works once and expires after 24 hours.'
    } else {
        Write-Host 'BannerlordCoop nightly installer' -ForegroundColor Cyan
        Write-Host 'This downloads and installs the latest completed Supporter and Tester nightly for you.'
    }
    Write-Host ''

    $choice = Read-InstallChoice
    $installClient = $choice -eq 'Client' -or $choice -eq 'Both'
    $installServer = $choice -eq 'Server' -or $choice -eq 'Both'
    if ($installerPin) {
        $script:NightlyAccessToken = Get-CreateBuildPinAccessToken $installerPin
        $manifest = Get-PinManifest
        Write-Host "Pinned create-build: $(Get-ShortCommitSha ([string]$manifest.clientSha)) / $(Get-ShortCommitSha ([string]$manifest.serverSha))"
    } else {
        $script:NightlyAccessToken = Get-NightlyAccessToken
        $manifest = Get-ReleaseManifest ($choice -eq 'Client')
        $displayDate = Get-NightlyDisplayDate ([string]$manifest.releaseDate) ([string]$manifest.builtAt)
        Write-Host "Latest nightly: $displayDate ($(Get-ShortCommitSha ([string]$manifest.headSha)))"
    }
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

function Get-InstallationSupportLines {
    param([string]$FailureMessage = '')

    $lines = @()
    if ($FailureMessage -notmatch 'GoodbyeDPI|zapret|ByeDPI|SpoofDPI|PowerTunnel|GreenTunnel|youtubeUnblock|Cloudflare WARP|HTTPS scanning|DNS for the nightly|hostname could not be resolved|network filter replaced|Cloudflare challenged|internal_error|HTTP 50|not available yet|#nightly-releases') {
        $lines += 'If a DNS tool such as GoodbyeDPI is interfering, try Cloudflare WARP or turn that tool off, then run the installer again.'
    }
    $lines += 'If you need help, copy this message and ask in the Bannerlord Coop Discord.'
    return $lines
}

if ($env:BANNERLORDCOOP_INSTALLER_TEST -ne '1') {
    try {
        Invoke-BannerlordCoopInstaller
    } catch {
        Write-Host ''
        Write-Host "Installation failed: $($_.Exception.Message)" -ForegroundColor Red
        foreach ($line in Get-InstallationSupportLines $_.Exception.Message) {
            Write-Host $line -ForegroundColor Yellow
        }
        if ($env:BANNERLORDCOOP_INSTALLER_LAUNCHER -eq '1') { exit 1 }
        throw
    }
}
