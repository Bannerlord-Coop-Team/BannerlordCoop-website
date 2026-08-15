@echo off
setlocal
title BannerlordCoop Nightly Installer

set "POWERSHELL_EXE=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
set "BANNERLORDCOOP_INSTALLER_TEMP=%TEMP%\BannerlordCoop-Nightly-Installer-%RANDOM%-%RANDOM%.ps1"

echo BannerlordCoop Nightly Installer
echo Installs or updates the Coop client, Windows dedicated server, or both.
echo.

if not exist "%POWERSHELL_EXE%" (
  echo Windows PowerShell could not be found.
  echo Expected: %POWERSHELL_EXE%
  goto :failed
)

echo Downloading the latest installer...
"%POWERSHELL_EXE%" -NoLogo -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -UseBasicParsing -Uri 'https://bannerlordcoop-nightly-gateway.garrett-luskey.workers.dev/install.ps1' -OutFile $env:BANNERLORDCOOP_INSTALLER_TEMP"
if errorlevel 1 goto :download_failed

"%POWERSHELL_EXE%" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%BANNERLORDCOOP_INSTALLER_TEMP%"
set "INSTALLER_EXIT=%ERRORLEVEL%"
del /q "%BANNERLORDCOOP_INSTALLER_TEMP%" >nul 2>&1

echo.
if not "%INSTALLER_EXIT%"=="0" (
  echo The installer stopped with an error. The details are shown above.
  goto :failed
)

echo The installer finished successfully.
pause
exit /b 0

:download_failed
del /q "%BANNERLORDCOOP_INSTALLER_TEMP%" >nul 2>&1
echo.
echo The latest installer could not be downloaded. Check your internet connection and try again.

:failed
echo.
pause
exit /b 1
