/** Erro cuja mensagem foi escrita para quem usa o site e pode ser exibida. */
export class ActionError extends Error {}

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string };

/**
 * Em produção o Next esconde a mensagem de erros lançados em Server Actions;
 * por isso as mensagens esperadas voltam como resultado e o resto vira genérico.
 */
export async function runAction<T>(
  action: () => Promise<T>,
  fallback: string,
): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await action() };
  } catch (error) {
    if (error instanceof ActionError) return { ok: false, error: error.message };
    console.error("[acao] Erro inesperado.", error);
    return { ok: false, error: fallback };
  }
}
