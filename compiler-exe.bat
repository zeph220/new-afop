@echo off
chcp 65001 >nul
title Veyra - compilation de l'exe
cd /d "%~dp0"

echo === Veyra : compilation de l'executable Windows ===
echo.

where npm >nul 2>nul
if errorlevel 1 (
  echo Node.js est introuvable. Installez-le depuis https://nodejs.org puis relancez ce fichier.
  pause
  exit /b 1
)

if not exist node_modules (
  echo Installation des dependances (premiere fois seulement^)...
  call npm install
  if errorlevel 1 goto :erreur
)

echo Compilation en cours (1 a 3 minutes^)...
call npm run build:exe
if errorlevel 1 goto :erreur

echo.
echo Termine : l'exe est dans le dossier "release".
start "" explorer "%~dp0release"
pause
exit /b 0

:erreur
echo.
echo La compilation a echoue : lisez les messages ci-dessus.
pause
exit /b 1
