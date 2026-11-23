## Novidades da 4.2.3

- **Correção:** não aparece mais a janela "A JavaScript error occurred in the main process" (erro EPIPE). Ela surgia quando o ajudante de volume e brilho fechava e a ilha tentava mandar um comando para ele. Agora a ilha espera ele reabrir sozinho.
- Qualquer outro erro inesperado passa a ser só registrado no log, sem abrir janela de erro.
