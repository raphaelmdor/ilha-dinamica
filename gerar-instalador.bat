@echo off
chcp 65001 >nul
title Ilha Dinamica - gerar instalador
cd /d "%~dp0"
set "LOG=%~dp0gerar-instalador-log.txt"
echo ==== %date% %time% ==== > "%LOG%"
echo Gerando o instalador da Ilha Dinamica. Isso pode levar alguns minutos na primeira vez...
echo.
call npx electron-builder --win nsis >> "%LOG%" 2>&1
if not errorlevel 1 goto pronto
echo Primeira tentativa falhou, tentando de novo sem editar o icone do .exe...
echo ---- segunda tentativa ---- >> "%LOG%"
call npx electron-builder --win nsis -c.win.signAndEditExecutable=false >> "%LOG%" 2>&1
if not errorlevel 1 goto pronto
echo.
echo ERRO ao gerar o instalador. Avise o Claude, o log esta em gerar-instalador-log.txt
pause
exit /b 1

:pronto
echo.
echo Pronto! O instalador esta na pasta dist. Abrindo a pasta...
start "" "%~dp0dist"
timeout /t 6 >nul
exit /b 0
