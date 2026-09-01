@echo off
setlocal
cd /d "%~dp0"

echo.
echo ==========================================
echo   Animal Care Co-op - lokalny launcher
echo ==========================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [BLAD] Nie znaleziono Node.js w PATH.
  echo Zainstaluj Node.js 22+ i uruchom start.bat ponownie.
  echo.
  pause
  exit /b 1
)

call npm start
if errorlevel 1 (
  echo.
  echo [BLAD] Launcher zakonczyl sie bledem.
  pause
  exit /b 1
)
