@echo off
rem ============================================================================
rem  LCLite installer - interactive mod picker for the Lost City webclient.
rem
rem  Double-click this file (or run install.bat from a terminal) from anywhere:
rem  it works relative to its own folder, lclite/, which must sit in the root
rem  of your Lost City checkout, next to webclient/ and engine/.
rem
rem  Everything is convergent: checked mods are applied, unchecked mods are
rem  stripped back to pristine upstream code. Rerun it any time to change
rem  your mod set; it also reseats itself after a Lost City rev update.
rem ============================================================================
setlocal
title LCLite installer
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 goto :nonode

:prompt
node install.mjs pick %*
set EC=%ERRORLEVEL%
if "%EC%"=="0" goto :done
if "%EC%"=="2" goto :drift
if "%EC%"=="3" exit /b 0

echo.
echo [!] The installer hit a problem (exit code %EC%).
goto :menu_after_fail

:drift
echo.
echo Some hunks failed to find their anchors - Lost City updated code under them.
echo Open lclite\mods\^<mod^>\patches\^<file^>.json and reseat the "find" lines
echo (see README.md - Upgrading to a newer Lost City rev), then retry.
goto :menu

:menu_after_fail
echo Retry from the menu?
echo   1 = open the mod picker again
echo   2 = apply ALL mods non-interactively
echo   3 = exit
choice /c 123 /n /m "  select> "
if errorlevel 3 exit /b 1
if errorlevel 2 (
  node install.mjs %*
  goto :done
)
goto :prompt

:done
echo.
if "%EC%"=="0" (
  echo All done. Start Lost City (its start.bat / npm run quickstart) and
  echo press F1 in the webclient for the LCLite panel.
)
pause
exit /b %EC%

:nonode
echo [!] Node.js was not found on PATH.
echo     LCLite needs Node 18+ to run its installer: https://nodejs.org/
echo     (the "LTS" installer, just double-click through it)
echo.
pause
exit /b 1
