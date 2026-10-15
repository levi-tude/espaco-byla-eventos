"use server";

import { ActionError, type ActionResult, runAction } from "@/lib/action-result";
import { alertTeamOrphanAccount } from "@/lib/alerts/team-alert";
import { generateLoginCode, normalizeLoginCode } from "@/lib/auth/login-code";
import { sendLoginCodeEmail } from "@/lib/email/send-login-code";
import { ORGANIZER_TERMS_VERSION } from "@/lib/legal/organizer-terms";
import { hashInviteToken, isInviteTokenFormat } from "@/lib/organizer/invite-token";
import { ORGANIZER_AREA_UNAVAILABLE_MESSAGE, organizerAreaEnabled } from "@/lib/organizer/settings";
import { parseEmail, parseOrganizerProfile, parsePassword } from "@/lib/organizer/validation";
import { BOT_BLOCKED_MESSAGE, isBotRequest } from "@/lib/security/bot";
import { clientIp, consumeRateLimit, RATE_LIMIT_MESSAGE, type RateLimitRule, RATE_LIMITS } from "@/lib/security/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";

type AdminClient = ReturnType<typeof createAdminClient>;

const INVITE_INVALID_MESSAGE = "Este convite não vale mais. Peça um novo ao Espaço Byla.";
const FALLBACK_MESSAGE = "Não foi possível continuar agora. Tente de novo em alguns minutos.";
const SEND_FAILED_MESSAGE = "Não conseguimos enviar o código agora. Tente de novo em alguns minutos.";
const ACCOUNT_FAILED_MESSAGE = "Não foi possível criar a conta. Fale com o Espaço Byla.";
const EMAIL_NOT_CONFIRMED_MESSAGE = "Confirme o e-mail com o código antes de continuar.";
const TERMS_REQUIRED_MESSAGE = "Marque que leu e aceita os Termos do organizador e a Política de Privacidade.";

const SEND_STATUS_MESSAGES: Record<string, string> = {
  limite: "Você já pediu 3 códigos para este convite. Peça um novo convite ao Espaço Byla.",
  email_indisponivel: "Este e-mail não pode ser usado. Use outro e-mail ou fale com o Espaço Byla.",
  invalido: INVITE_INVALID_MESSAGE,
};

const VERIFY_STATUS_MESSAGES: Record<string, string> = {
  invalido: "Código incorreto. Confira os números e tente de novo.",
  expirado: "Este código venceu. Toque em “Reenviar código”.",
  bloqueado: "Muitas tentativas erradas. Toque em “Reenviar código” para receber outro.",
  convite_invalido: INVITE_INVALID_MESSAGE,
};

export type CompleteSignupInput = {
  profile: unknown;
  password: string;
  termsAccepted: boolean;
};

/** Só o código ORG_* vai para o log: nunca e-mail, token, código ou documento. */
function dbCode(message: string | undefined): string {
  return /\bORG_[A-Z]+/.exec(message ?? "")?.[0] ?? "erro inesperado";
}

/** Formato do token (sem banco) e área ligada. Só o hash vai ao banco, nunca o token. */
async function openInvite(token: unknown): Promise<{ tokenHash: string }> {
  if (!isInviteTokenFormat(token)) throw new ActionError(INVITE_INVALID_MESSAGE);
  if (!(await organizerAreaEnabled())) throw new ActionError(ORGANIZER_AREA_UNAVAILABLE_MESSAGE);
  return { tokenHash: hashInviteToken(token) };
}

async function limitByIp(admin: AdminClient, rule: RateLimitRule): Promise<void> {
  if (!(await consumeRateLimit(admin, rule, await clientIp()))) throw new ActionError(RATE_LIMIT_MESSAGE);
}

/** Passo 1: confere o convite. Qualquer falha tem a mesma resposta. */
export async function checkInvite(token: string): Promise<ActionResult<{ valid: true }>> {
  return runAction(async () => {
    const { tokenHash } = await openInvite(token);
    const admin = createAdminClient();
    await limitByIp(admin, RATE_LIMITS.inviteCheckPerIp);

    const { data, error } = await admin.rpc("check_organizer_invite", { p_token_hash: tokenHash });
    if (error) console.error(`[convite] Falha ao conferir o convite (${dbCode(error.message)}).`);
    if (error || data !== "valido") throw new ActionError(INVITE_INVALID_MESSAGE);
    return { valid: true as const };
  }, INVITE_INVALID_MESSAGE);
}

/** Único passo do convite que manda e-mail: por isso tem anti-robô. */
export async function sendInviteEmailCode(token: string, email: string, humanToken: string): Promise<ActionResult> {
  return runAction(async () => {
    const { tokenHash } = await openInvite(token);
    const parsedEmail = parseEmail(email);
    if (!parsedEmail.ok) throw new ActionError(parsedEmail.error);

    if (await isBotRequest(humanToken, "org_invite")) throw new ActionError(BOT_BLOCKED_MESSAGE);
    const admin = createAdminClient();
    await limitByIp(admin, RATE_LIMITS.inviteCodePerIp);

    const code = generateLoginCode();
    const { data, error } = await admin.rpc("start_invite_email_code", {
      p_token_hash: tokenHash,
      p_email: parsedEmail.value,
      p_code: code,
    });
    if (error) {
      console.error(`[convite] Falha ao gerar o código do e-mail (${dbCode(error.message)}).`);
      throw new ActionError(FALLBACK_MESSAGE);
    }
    if (data !== "ok") throw new ActionError(SEND_STATUS_MESSAGES[data] ?? FALLBACK_MESSAGE);

    const sent = await sendLoginCodeEmail({ to: parsedEmail.value, code, purpose: "cadastro" });
    if (sent !== "sent") {
      console.error(`[convite] Código do cadastro não enviado (${sent}).`);
      throw new ActionError(SEND_FAILED_MESSAGE);
    }
    return undefined;
  }, FALLBACK_MESSAGE);
}

/** O código é comparado dentro do banco (hash com sal, 5 tentativas). */
export async function verifyInviteEmailCode(token: string, code: string): Promise<ActionResult> {
  return runAction(async () => {
    const { tokenHash } = await openInvite(token);
    const normalized = normalizeLoginCode(code);
    if (!normalized) throw new ActionError("Digite os 6 números do código.");

    const admin = createAdminClient();
    await limitByIp(admin, RATE_LIMITS.inviteCheckPerIp);

    const { data, error } = await admin.rpc("verify_invite_email_code", {
      p_token_hash: tokenHash,
      p_code: normalized,
    });
    if (error) {
      console.error(`[convite] Falha ao conferir o código do e-mail (${dbCode(error.message)}).`);
      throw new ActionError(FALLBACK_MESSAGE);
    }
    if (data !== "ok") throw new ActionError(VERIFY_STATUS_MESSAGES[data] ?? FALLBACK_MESSAGE);
    return undefined;
  }, FALLBACK_MESSAGE);
}

/** Apaga a conta criada quando o convite não pôde ser aceito; se não der, avisa a equipe. Nunca lança. */
async function removeOrphanAccount(admin: AdminClient, userId: string): Promise<void> {
  let deleted = false;
  try {
    const { error } = await admin.auth.admin.deleteUser(userId);
    deleted = !error;
  } catch {
    deleted = false;
  }
  if (deleted) return;
  console.error(`[convite] Conta sem perfil não foi apagada; apagar à mão (${userId}).`);
  try {
    await alertTeamOrphanAccount(admin, userId);
  } catch {
    console.error("[convite] Aviso da conta sem perfil não saiu.");
  }
}

/**
 * Último passo. A conta só é criada depois de o banco confirmar convite e e-mail;
 * o e-mail da conta vem do banco (o confirmado pelo código), nunca do navegador.
 */
export async function completeOrganizerSignup(
  token: string,
  input: CompleteSignupInput,
): Promise<ActionResult<{ email: string }>> {
  return runAction(async () => {
    const { tokenHash } = await openInvite(token);
    if (input?.termsAccepted !== true) throw new ActionError(TERMS_REQUIRED_MESSAGE);
    const profile = parseOrganizerProfile(input.profile);
    if (!profile.ok) throw new ActionError(profile.error);
    const names = [profile.value.fullName, profile.value.publicName];
    const password = parsePassword(input.password, { names });
    if (!password.ok) throw new ActionError(password.error);

    const admin = createAdminClient();
    await limitByIp(admin, RATE_LIMITS.inviteCompletePerIp);

    const { data: email, error: emailError } = await admin.rpc("invite_verified_email", { p_token_hash: tokenHash });
    if (emailError) {
      console.error(`[convite] Falha ao ler o e-mail confirmado (${dbCode(emailError.message)}).`);
      throw new ActionError(FALLBACK_MESSAGE);
    }
    if (typeof email !== "string" || !email) throw new ActionError(EMAIL_NOT_CONFIRMED_MESSAGE);
    const withEmail = parsePassword(input.password, { email, names });
    if (!withEmail.ok) throw new ActionError(withEmail.error);

    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password: password.value,
      email_confirm: true,
    });
    const userId = created?.user?.id;
    if (createError || !userId) {
      console.error(`[convite] Conta não criada (${createError?.status ?? "sem id"}).`);
      throw new ActionError(ACCOUNT_FAILED_MESSAGE);
    }

    const value = profile.value;
    const { error: acceptError } = await admin.rpc("accept_organizer_invite", {
      p_token_hash: tokenHash,
      p_user_id: userId,
      p_full_name: value.fullName,
      p_public_name: value.publicName,
      p_phone: value.phone,
      p_pix_key_type: value.pixKeyType,
      p_pix_key: value.pixKey,
      p_pix_holder_name: value.pixHolderName,
      p_pix_holder_document: value.pixHolderDocument,
      p_terms_version: ORGANIZER_TERMS_VERSION,
    });
    if (acceptError) {
      console.error(`[convite] Convite não aceito; desfazendo a conta (${dbCode(acceptError.message)}).`);
      await removeOrphanAccount(admin, userId);
      throw new ActionError(ACCOUNT_FAILED_MESSAGE);
    }
    return { email };
  }, ACCOUNT_FAILED_MESSAGE);
}
