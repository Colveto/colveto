@echo off
rem Fabrique l'installateur Windows de Colveto (Colveto-x.y.z-win-x64.exe).
rem Prérequis : Node.js LTS (https://nodejs.org). Double-cliquez sur ce fichier.
chcp 65001 >nul
cd /d "%~dp0\.."
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js n'est pas installe. Installez la version LTS depuis https://nodejs.org puis relancez.
  pause
  exit /b 1
)
echo [1/3] Installation des dependances (quelques minutes)...
call npm ci
if errorlevel 1 goto erreur
echo [2/3] Construction de l'interface...
call npm run build
if errorlevel 1 goto erreur
echo [3/3] Fabrication de l'installateur Windows...
call npx electron-builder --win nsis --x64
if errorlevel 1 goto erreur
echo.
echo Termine : l'installateur est dans le dossier release
explorer release
pause
exit /b 0
:erreur
echo.
echo ERREUR : voir les messages ci-dessus.
pause
exit /b 1
