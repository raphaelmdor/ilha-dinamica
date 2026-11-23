# Cria atalhos da Ilha Dinâmica na Área de Trabalho e no Menu Iniciar
$raiz = Split-Path -Parent $MyInvocation.MyCommand.Path
$exe = Join-Path $raiz 'node_modules\electron\dist\electron.exe'
$icone = Join-Path $raiz 'build\icon.ico'
$shell = New-Object -ComObject WScript.Shell
$locais = @(
    [Environment]::GetFolderPath('Desktop'),
    (Join-Path ([Environment]::GetFolderPath('Programs')) '')
)
foreach ($pasta in $locais) {
    $lnk = $shell.CreateShortcut((Join-Path $pasta 'Ilha Dinâmica.lnk'))
    $lnk.TargetPath = $exe
    $lnk.Arguments = '"' + $raiz + '"'
    $lnk.WorkingDirectory = $raiz
    $lnk.IconLocation = $icone
    $lnk.Description = 'Dynamic Island para Windows com comandos de voz'
    $lnk.Save()
    Write-Output "Atalho criado em $pasta"
}
