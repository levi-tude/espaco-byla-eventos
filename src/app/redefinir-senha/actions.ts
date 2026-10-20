"use server";

import { ActionError, type ActionResult, runAction } from "@/lib/action-result";
import { hashInviteToken, isInviteTokenFormat } from "@/lib/organizer/invite-token";
import { ORGANIZER_AREA_UNAVAILABLE_MESSAGE, organizerAreaEnabled } from "@/lib/organizer/settings";
import { parsePassword } from "@/lib/organizer/validation";
import { clientIp, consumeRateLimit, RATE_LIMIT_MESSAGE, RATE_LIMITS } from "@/lib/security/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";

const LINK_INVALID_MESSAGE = "Este link não vale mais. Peça um novo à ACDH Eventos.";
const RESET_FAILED_MESSAGE = "Não foi possível trocar a senha. Fale com a ACDH Eventos.";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
