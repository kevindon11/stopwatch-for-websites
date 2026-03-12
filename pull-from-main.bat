@echo off
setlocal EnableExtensions EnableDelayedExpansion

REM Always run from this script's directory.
cd /d "%~dp0"

REM Validate we're in a git repository.
git rev-parse --is-inside-work-tree >nul 2>&1
if errorlevel 1 (
  echo [ERROR] This folder is not a git repository.
  echo.
  pause
  exit /b 1
)

echo Fetching latest branches from origin...
git fetch origin --prune
if errorlevel 1 (
  echo [ERROR] Failed to fetch from origin.
  echo.
  pause
  exit /b 1
)

echo.
echo ==============================================
echo Pick what you want to update/check out
echo ==============================================

set /a count=0
set /a count+=1
set "item!count!=origin/main"
for /f "delims=" %%I in ('git log -1 --pretty^=format:"%%ad ^| %%h ^| %%s" --date^=short origin/main') do set "info!count!=%%I"
echo !count!^) main                 !info!count!!

for /f "delims=" %%B in ('git for-each-ref --sort=-committerdate --format="%%(refname:short)" refs/remotes/origin') do (
  if /I not "%%B"=="origin/HEAD" if /I not "%%B"=="origin/main" (
    git merge-base --is-ancestor "%%B" origin/main >nul 2>&1
    if errorlevel 1 (
      set /a count+=1
      set "item!count!=%%B"
      for /f "delims=" %%I in ('git log -1 --pretty^=format:"%%ad ^| %%h ^| %%s" --date^=short "%%B"') do set "info!count!=%%I"
      echo !count!^) %%B  !info!count!!
    )
  )
)

echo.
set /p choice=Enter the number to use ^(or Q to quit^): 
if /I "%choice%"=="Q" goto :done
if "%choice%"=="" goto :invalid
for /f "delims=0123456789" %%X in ("%choice%") do goto :invalid
if %choice% LSS 1 goto :invalid
if %choice% GTR %count% goto :invalid

set "target=!item%choice%!"
set "localBranch=!target:origin/=!"

echo.
echo You picked: !target!

git checkout "!localBranch!" >nul 2>&1
if errorlevel 1 (
  git checkout -b "!localBranch!" --track "!target!"
  if errorlevel 1 (
    echo [ERROR] Failed to checkout !target!.
    echo.
    pause
    exit /b 1
  )
)

echo Pulling latest changes for !localBranch!... 
git pull --ff-only origin "!localBranch!"
if errorlevel 1 (
  echo [ERROR] Pull failed. You may need manual conflict resolution.
  echo.
  pause
  exit /b 1
)

echo.
echo Done. You are now on !localBranch! and up to date.

echo.
set /p mergeToMain=Also merge !localBranch! into main now? ^(Y/N, default N^): 
if /I "!mergeToMain!"=="Y" goto :merge_main
if /I "!mergeToMain!"=="YES" goto :merge_main
if "!mergeToMain!"=="" goto :done
if /I "!mergeToMain!"=="N" goto :done
if /I "!mergeToMain!"=="NO" goto :done

echo [WARN] Unrecognized choice. Skipping merge into main.
goto :done

:merge_main
echo.
echo Preparing main branch...
git checkout main >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Could not checkout main.
  echo.
  pause
  exit /b 1
)

git pull --ff-only origin main
if errorlevel 1 (
  echo [ERROR] Could not update local main from origin/main.
  echo.
  pause
  exit /b 1
)

if /I "!localBranch!"=="main" (
  echo [INFO] Selected branch is main; nothing to merge.
  goto :done
)

echo Merging !localBranch! into main...
git merge "!localBranch!"
if errorlevel 1 (
  echo [ERROR] Merge failed. Resolve conflicts manually, then continue.
  echo.
  pause
  exit /b 1
)

echo [OK] Merged !localBranch! into main.


goto :done

:invalid
echo.
echo [ERROR] Invalid choice.

:done
echo.
pause
exit /b 0
