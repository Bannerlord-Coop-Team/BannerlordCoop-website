@echo off
setlocal
title BannerlordCoop Nightly Installer

set "POWERSHELL_EXE=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
set "CURL_EXE=%SystemRoot%\System32\curl.exe"
set "FINDSTR_EXE=%SystemRoot%\System32\findstr.exe"
set "BANNERLORDCOOP_INSTALLER_TEMP=%TEMP%\BannerlordCoop-Nightly-Installer-%RANDOM%-%RANDOM%.ps1"
set "BANNERLORDCOOP_INSTALLER_LAUNCHER=1"
set "INSTALLER_PRIMARY=https://bannerlordcoop-nightly-gateway.garrett-luskey.workers.dev/install.ps1"
set "INSTALLER_MIRROR=https://raw.githubusercontent.com/Bannerlord-Coop-Team/BannerlordCoop-website/main/installer/install.ps1"

echo BannerlordCoop Nightly Installer
echo Installs or updates the Coop client, Windows dedicated server, or both.
echo.

if not exist "%POWERSHELL_EXE%" (
  echo Windows PowerShell could not be found.
  echo Expected: %POWERSHELL_EXE%
  goto :failed
)

echo Downloading the latest installer...
call :download_installer "%INSTALLER_PRIMARY%" "nightly gateway"
if not errorlevel 1 goto :download_complete

echo The nightly gateway download failed. Trying the GitHub mirror...
call :download_installer "%INSTALLER_MIRROR%" "GitHub mirror"
if errorlevel 1 goto :download_failed

:download_complete

"%POWERSHELL_EXE%" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%BANNERLORDCOOP_INSTALLER_TEMP%"
set "INSTALLER_EXIT=%ERRORLEVEL%"
del /q "%BANNERLORDCOOP_INSTALLER_TEMP%" >nul 2>&1

echo.
if not "%INSTALLER_EXIT%"=="0" (
  echo The installer stopped with an error. The details are shown above.
  goto :failed
)

exit /b 0

:download_installer
del /q "%BANNERLORDCOOP_INSTALLER_TEMP%" >nul 2>&1
"%POWERSHELL_EXE%" -NoLogo -NoProfile -ExecutionPolicy Bypass -Command "try { $ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -UseBasicParsing -Uri '%~1' -OutFile $env:BANNERLORDCOOP_INSTALLER_TEMP; exit 0 } catch { exit 1 }"
if not errorlevel 1 call :validate_installer
if not errorlevel 1 exit /b 0

if not exist "%CURL_EXE%" exit /b 1
echo PowerShell could not download from the %~2. Trying Windows curl...
del /q "%BANNERLORDCOOP_INSTALLER_TEMP%" >nul 2>&1
"%CURL_EXE%" --fail --location --silent --show-error --connect-timeout 15 --max-time 120 --retry 2 --retry-delay 1 --output "%BANNERLORDCOOP_INSTALLER_TEMP%" "%~1"
if errorlevel 1 exit /b 1
call :validate_installer
exit /b %ERRORLEVEL%

:validate_installer
if not exist "%BANNERLORDCOOP_INSTALLER_TEMP%" exit /b 1
if not exist "%FINDSTR_EXE%" exit /b 1
for %%I in ("%BANNERLORDCOOP_INSTALLER_TEMP%") do if %%~zI LSS 4096 exit /b 1
"%FINDSTR_EXE%" /b /l /c:"$ErrorActionPreference = 'Stop'" "%BANNERLORDCOOP_INSTALLER_TEMP%" >nul 2>&1
if errorlevel 1 exit /b 1
"%FINDSTR_EXE%" /b /l /c:"if ($env:BANNERLORDCOOP_INSTALLER_TEST -ne '1') {" "%BANNERLORDCOOP_INSTALLER_TEMP%" >nul 2>&1
if errorlevel 1 exit /b 1
"%POWERSHELL_EXE%" -NoLogo -NoProfile -ExecutionPolicy Bypass -Command "$tokens=$null; $errors=$null; [System.Management.Automation.Language.Parser]::ParseFile($env:BANNERLORDCOOP_INSTALLER_TEMP, [ref]$tokens, [ref]$errors) | Out-Null; if ($errors.Count -eq 0) { exit 0 } else { exit 1 }"
exit /b %ERRORLEVEL%

:download_failed
del /q "%BANNERLORDCOOP_INSTALLER_TEMP%" >nul 2>&1
echo.
echo The latest installer could not be downloaded from the nightly gateway or GitHub mirror.
echo Check your firewall or proxy, then try again.

:failed
echo.
pause
exit /b 1
