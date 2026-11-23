' Abre a Ilha Dinamica sem nenhuma janela de terminal
Set fso = CreateObject("Scripting.FileSystemObject")
raiz = fso.GetParentFolderName(WScript.ScriptFullName)
exe = raiz & "\node_modules\electron\dist\electron.exe"
CreateObject("WScript.Shell").Run """" & exe & """ """ & raiz & """", 1, False
