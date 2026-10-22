// Sem "use server": arquivos "use server" só podem exportar funções async.

/** Mesma resposta exista ou não a conta (não revela cadastro). */
export const PASSWORD_RESET_REQUEST_MESSAGE =
  "Se este e-mail tiver uma conta, você vai receber um link para criar uma senha nova. Confira também a caixa de spam.";

/**
 * Tempo mínimo de resposta do pedido (ms).
 * Orçamento: RESET_RPC_TIMEOUT_MS (1500) + RESET_SEND_TIMEOUT_MS (2000) = 3500 < 4000.
 * Sem after do Next: no Cloud Run a CPU é limitada depois da resposta.
 */
export const RESET_REQUEST_FLOOR_MS = 4000;
/** Timeout do RPC request_password_reset_link. */
export const RESET_RPC_TIMEOUT_MS = 1500;
/** Timeout do fetch Resend em send-password-reset. */
export const RESET_SEND_TIMEOUT_MS = 2000;
