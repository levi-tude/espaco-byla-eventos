"use server";

import { ActionError, type ActionResult, runAction } from "@/lib/action-result";
import { hashInviteToken, isInviteTokenFormat } from "@/lib/organizer/invite-token";
import { PASSWORD_RESET_PATH } from "@/lib/organizer/invite-token-format";
import { ORGANIZER_AREA_UNAVAILABLE_MESSAGE, organizerAreaEnabled } from "@/lib/organizer/settings";
import { parseEmail, parsePassword } from "@/lib/organizer/validation";
import { clientIp, consumeRateLimit, RATE_LIMIT_MESSAGE, RATE_LIMITS } from "@/lib/security/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerClient } from "@/lib/supabase/server";

const LINK_INVALID_MESSAGE = "Este link não vale mais. Peça um novo à ACDH Eventos.";
const RESET_FAILED_MESSAGE = "Não foi possível trocar a senha. Fale com a ACDH Eventos.";
/** Mesma resposta exista ou não a conta (não revela cadastro). */
export const PASSWORD_RESET_REQUEST_MESSAGE =
  "Se este e-mail tiver uma conta, você vai receber um link para criar uma senha nova. Confira também a caixa de spam.";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Pedido público de link de nova senha (Supabase Auth). Sempre a mesma mensagem
 * de sucesso: não revela se o e-mail existe.
 */
export async function requestPasswordResetLink(email: string): Promise<ActionResult> {
  return runAction(async () => {
    if (!(await organizerAreaEnabled())) throw new ActionError(ORGANIZER_AREA_UNAVAILABLE_MESSAGE);
    const parsed = parseEmail(email);
    if (!parsed.ok) throw new ActionError(parsed.error);

    const admin = createAdminClient();
    if (!(await consumeRateLimit(admin, RATE_LIMITS.passwordResetPerIp, await clientIp()))) {
      throw new ActionError(RATE_LIMIT_MESSAGE);
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim()?.replace(/\/$/, "");
    if (!appUrl) {
      console.error("[nova-senha] Pedido de link sem NEXT_PUBLIC_APP_URL.");
      return undefined;
    }

    const supabase = await createServerClient();
    const { error } = await supabase.auth.resetPasswordForEmail(parsed.value, {
      redirectTo: `${appUrl}${PASSWORD_RESET_PATH}`,
    });
    if (error) {
      console.error("[nova-senha] Pedido de link recusado.", {
        status: error.status ?? "sem status",
        name: error.name,
      });
    }
    return undefined;
  }, "Não foi possível pedir o link agora. Tente de novo em alguns minutos.");
}

/**
 * Link de nova senha gerado pelo Admin (uso único, 24 h). O banco marca o link
 * usado e derruba as sessões verificadas antes de a senha ser trocada.
 */
export async function resetPasswordWithLink(token: string, password: string): Promise<ActionResult> {
  return runAction(async () => {
    if (!isInviteTokenFormat(token)) throw new ActionError(LINK_INVALID_MESSAGE);
    if (!(await organizerAreaEnabled())) throw new ActionError(ORGANIZER_AREA_UNAVAILABLE_MESSAGE);
    // Nome e e-mail da conta só aparecem depois de gastar o link: aqui vale a regra sem eles.
    const parsed = parsePassword(password);
    if (!parsed.ok) throw new ActionError(parsed.error);

    const admin = createAdminClient();
    if (!(await consumeRateLimit(admin, RATE_LIMITS.passwordResetPerIp, await clientIp()))) {
      throw new ActionError(RATE_LIMIT_MESSAGE);
    }

    const { data: userId, error } = await admin.rpc("use_password_reset_invite", {
      p_token_hash: hashInviteToken(token),
    });
    if (error || typeof userId !== "string" || !UUID_PATTERN.test(userId)) {
      const code = /\bORG_[A-Z]+/.exec(error?.message ?? "")?.[0] ?? "erro inesperado";
      console.error(`[nova-senha] Link recusado (${code}).`);
      throw new ActionError(LINK_INVALID_MESSAGE);
    }

    const { error: updateError } = await admin.auth.admin.updateUserById(userId, { password: parsed.value });
    if (updateError) {
      console.error(`[nova-senha] Senha não trocada; o link já foi usado (${updateError.status ?? "sem status"}).`);
      throw new ActionError(RESET_FAILED_MESSAGE);
    }
    return undefined;
  }, RESET_FAILED_MESSAGE);
}
