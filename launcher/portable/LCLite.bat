@echo off
rem Portable LCLite entry point. Double-click me — or LCLite.exe, same thing.
rem This shim exists so a downloaded folder has an obvious thing to double-click,
rem and so a missing exe explains itself instead of flashing a console window.
setlocal
cd /d "%~dp0"
if not exist "LCLite.exe" (
    echo LCLite.exe is missing from this folder.
    echo Re-download it from https://github.com/skulltrick/lclite/releases/latest
    echo.
    pause
    exit /b 1
)
start "" "LCLite.exe" %*
