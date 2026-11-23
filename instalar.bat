@echo off
chcp 65001 >nul
title Ilha Dinamica - instalacao
cd /d "%~dp0"
set "LOG=%~dp0instalar-log.txt"
echo ==== %date% %time% ==== > "%LOG%"

where npm >nul 2>nul
if errorlevel 1 goto semnode
node -v >> "%LOG%" 2>&1

echo [1/3] Instalando dependencias...
call npm install >> "%LOG%" 2>&1

echo [2/3] Conferindo o Electron...
if exist "node_modules\electron\path.txt" goto abrir
echo Baixando o Electron direto do GitHub, uns 100 MB. Aguarde...
echo Rodando corrigir-electron.ps1 >> "%LOG%"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0corrigir-electron.ps1" >> "%LOG%" 2>&1
if not exist "node_modules\electron\path.txt" goto erroelectron

:abrir
echo [3/3] Criando atalhos e abrindo a Ilha Dinamica...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0criar-atalhos.ps1" >> "%LOG%" 2>&1
start "" wscript.exe "%~dp0abrir-ilha.vbs"
echo.
echo Pronto! A ilha roda sozinha, pode fechar esta janela.
echo Para abrir de novo use o atalho Ilha Dinamica na Area de Trabalho ou no Menu Iniciar.
timeout /t 8 >nul
exit /b 0

:semnode
echo Node.js nao encontrado. Instale em https://nodejs.org e rode de novo.
pause
exit /b 1

:erroelectron
echo.
echo ERRO: o Electron nao instalou. Avise o Claude, o log esta em instalar-log.txt
pause
exit /b 1
