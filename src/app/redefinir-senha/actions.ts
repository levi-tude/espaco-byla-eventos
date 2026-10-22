"use server";

import { after } from "next/server";

import { ActionError, type ActionResult, runAction } from "@/lib/action-result";
import { alertTeamSetup } from "@/lib/alerts/team-alert";
import { sendPasswordResetEmail } from "@/lib/email/send-password-reset";
import {
  hashInviteToken,
  isInviteTokenFormat,
  newInviteToken,
} from "@/lib/organizer/invite-token";
import { PASSWORD_RESET_PATH } from "@/lib/organizer/invite-token-format";
import { parseEmail, parsePassword } from "@/lib/organizer/validation";
import { clientIp, consumeRateLimit, RATE_LIMIT_MESSAGE, RATE_LIMITS } from "@/lib/security/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";

const LINK_INVALID_MESSAGE = "Este link não vale mais. Peça um novo à ACDH Eventos.";
const RESET_FAILED_MESSAGE = "Não foi possível trocar a senha. Fale com a ACDH Eventos.";
/** Mesma resposta exista ou não a conta (não revela cadastro). */
export const PASSWORD_RESET_REQUEST_MESSAGE =
  "Se este e-mail tiver uma conta, você vai receber um link para criar uma senha nova. Confira também a caixa de spam.";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ResetArea = "equipe" | "organizador";

async function alertPasswordResetSetup(details: string): Promise<void> {
  try {
    await alertTeamSetup(createAdminClient(), "senha_email_falhou", details);
  } catch (error) {
    const name = error instanceof Error ? error.name : "desconhecido";
    console.error("[nova-senha] Falha ao alertar a equipe.", { name });
  }
}

/**
 * RPC + e-mail + alertas. Roda depois da resposta (after), para o tempo de
 * resposta não revelar se a conta existe. after() é suportado no Node.js /
 * Docker / Cloud Run com output standalone do Next.
 */
async function deliverPasswordResetLink(email: string): Promise<void> {
  try {
    const token = newInviteToken();
    const tokenHash = hashInviteToken(token);
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("request_password_reset_link", {
      p_email: email,
      p_token_hash: tokenHash,
    });
    if (error) {
      console.error("[nova-senha] Pedido de link recusado pelo banco.", { code: error.code });
      await alertPasswordResetSetup(
        `Pedido de link de nova senha: função do banco falhou (code ${error.code ?? "sem código"}). Aplique a migration se ainda não estiver no projeto.`,
      );
      return;
    }

    const row = Array.isArray(data) ? data[0] : null;
    if (
      !row ||
      typeof row !== "object" ||
      typeof (row as { user_id?: unknown }).user_id !== "string" ||
      typeof (row as { email?: unknown }).email !== "string"
    ) {
      return;
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim()?.replace(/\/$/, "");
    if (!appUrl) {
      console.error("[nova-senha] Pedido de link sem NEXT_PUBLIC_APP_URL.");
      await alertPasswordResetSetup("Pedido de link de nova senha: falta NEXT_PUBLIC_APP_URL.");
      return;
    }

    const link = `${appUrl}${PASSWORD_RESET_PATH}#token=${token}`;
    const sent = await sendPasswordResetEmail({
      to: (row as { email: string }).email,
      link,
    });
    if (sent !== "sent") {
      console.error("[nova-senha] Link gerado no banco, mas o e-mail não saiu.", { sent });
    }
  } catch (error) {
    const name = error instanceof Error ? error.name : "desconhecido";
    console.error("[nova-senha] Falha após a resposta do pedido.", { name });
    await alertPasswordResetSetup(
      `Pedido de link de nova senha falhou depois da resposta (${name}).`,
    );
  }
}

/**
 * Pedido público de link de nova senha (uso único via banco + Resend).
 * Sempre a mesma mensagem e o mesmo tempo de resposta: não revela se o e-mail existe.
 */
export async function requestPasswordResetLink(email: string): Promise<ActionResult> {
  return runAction(async () => {
    const parsed = parseEmail(email);
    if (!parsed.ok) throw new ActionError(parsed.error);

    const admin = createAdminClient();
    const ip = await clientIp();
    if (!(await consumeRateLimit(admin, RATE_LIMITS.passwordResetRequestPerIp, ip))) {
      throw new ActionError(RATE_LIMIT_MESSAGE);
    }
    if (!(await consumeRateLimit(admin, RATE_LIMITS.passwordResetRequestPerEmail, parsed.value))) {
      throw new ActionError(RATE_LIMIT_MESSAGE);
    }

    after(() => deliverPasswordResetLink(parsed.value));
    return undefined;
  }, "Não foi possível pedir o link agora. Tente de novo em alguns minutos.");
}

/**
 * Link de nova senha (uso único, 24 h). O banco marca o link usado e derruba
 * sessões verificadas, aparelhos lembrados e sessões Auth antes da troca.
 */
export async function resetPasswordWithLink(
  token: string,
  password: string,
): Promise<ActionResult<{ area: ResetArea }>> {
  return runAction(async () => {
    if (!isInviteTokenFormat(token)) throw new ActionError(LINK_INVALID_MESSAGE);
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

    const { error: updateError } = await admin.auth.admin.updateUserById(userId, {
      password: parsed.value,
    });
    if (updateError) {
      console.error(
        `[nova-senha] Senha não trocada; o link já foi usado (${updateError.status ?? "sem status"}).`,
      );
      throw new ActionError(RESET_FAILED_MESSAGE);
    }

    const { data: staff } = await admin
      .from("staff_profiles")
      .select("user_id")
      .eq("user_id", userId)
      .maybeSingle();
    return { area: staff ? "equipe" : "organizador" };
  }, RESET_FAILED_MESSAGE);
}
