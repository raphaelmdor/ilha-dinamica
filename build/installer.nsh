; Depois de instalar ou atualizar, faz o Windows recarregar os ícones
; (senão o menu Iniciar e a área de trabalho continuam com o ícone antigo em cache)
!macro customInstall
  nsExec::Exec '"$SYSDIR\ie4uinit.exe" -show'
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend
