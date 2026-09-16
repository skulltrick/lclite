@echo off
rem ============================================================================
rem  LCLite - the friendly way to set up and manage your mods.
rem
rem  Double-click this file from anywhere: it works relative to its own folder,
rem  lclite/, which must sit in the root of your Lost City checkout, next to
rem  webclient/ and engine/.
rem
rem  With LCLite.exe next to it this opens the launcher window in your browser
rem  (pick a revision, install it, tick mods, play). Add --cli to get the plain
rem  terminal picker instead; without LCLite.exe everything below still works.
rem
rem  Everything is convergent: checked mods are applied, unchecked mods are
rem  stripped back to pristine upstream code. The heavy lifting lives in
rem  tools\lclite.mjs - this file is just the double-click face of it.
rem ============================================================================
setlocal
title LCLite
cd /d "%~dp0"

if /i "%~1"=="--cli" ( shift & goto :cli )

if exist "LCLite.exe" (
  if "%~1"=="" (
    rem double-click: the launcher lives on its own; this window is its
    rem console - close it (or use Quit in the UI) to stop the launcher
    start "LCLite launcher" /min "LCLite.exe"
    goto :done
  )
  rem flags pass through:  --play 289  --port 9000  --no-browser  --data D:\lclite
  "LCLite.exe" %*
  goto :done
)

:cli
where node >nul 2>nul
if errorlevel 1 goto :nonode

:prompt
node tools\lclite.mjs pick %*
set EC=%ERRORLEVEL%
if "%EC%"=="0" goto :done
if "%EC%"=="2" goto :drift
if "%EC%"=="3" exit /b 0

echo.
echo [!] LCLite hit a problem (exit code %EC%).
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
  node tools\lclite.mjs %*
  goto :done
)
goto :prompt

:menu
choice /c 12 /n /m "  1 = retry picker   2 = exit> "
if errorlevel 2 exit /b 2
goto :prompt

:done
endlocal & exit /b 0

:nonode
echo.
echo  LCLite needs Node.js 18+ - grab it from https://nodejs.org and rerun me.
echo.
pause
exit /b 1
