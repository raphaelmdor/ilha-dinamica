# Baixa e extrai o Electron direto do GitHub (contorna o bloqueio de scripts do npm)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$raiz = Split-Path -Parent $MyInvocation.MyCommand.Path
$pastaElectron = Join-Path $raiz 'node_modules\electron'
$versao = (Get-Content (Join-Path $pastaElectron 'package.json') -Raw | ConvertFrom-Json).version
$nomeZip = "electron-v$versao-win32-x64.zip"
Write-Output "Electron $versao"

# 1) Tenta o cache do npm/electron; 2) senao baixa do GitHub
$zip = Get-ChildItem -Path (Join-Path $env:LOCALAPPDATA 'electron\Cache') -Recurse -Filter $nomeZip -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName
if ($zip) {
    Write-Output "Usando cache: $zip"
} else {
    $zip = Join-Path $env:TEMP $nomeZip
    $url = "https://github.com/electron/electron/releases/download/v$versao/$nomeZip"
    Write-Output "Baixando $url"
    Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing
}
Write-Output ("Tamanho do zip: {0:N1} MB" -f ((Get-Item $zip).Length / 1MB))

$dist = Join-Path $pastaElectron 'dist'
if (Test-Path $dist) { Remove-Item $dist -Recurse -Force }
Write-Output 'Extraindo...'
Expand-Archive -Path $zip -DestinationPath $dist -Force
if (-not (Test-Path (Join-Path $dist 'electron.exe'))) { throw 'electron.exe nao apareceu depois de extrair (antivirus?)' }
Set-Content -Path (Join-Path $pastaElectron 'path.txt') -Value 'electron.exe' -NoNewline -Encoding ASCII
Write-Output 'Electron instalado com sucesso.'
