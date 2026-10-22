"use server";

import { revalidatePath } from "next/cache";

import { ActionError, runAction, type ActionResult } from "@/lib/action-result";
import { requireOrganizer } from "@/lib/auth/actor";
import { generateLoginCode, maskEmail, normalizeLoginCode } from "@/lib/auth/login-code";
import { sendLoginCodeEmail } from "@/lib/email/send-login-code";
import { financeRefusalMessage } from "@/lib/organizer/finance";
import { notifyOrganizer, notifyTeam, organizerNoticeLink } from "@/lib/organizer/notify";
import { ORGANIZER_TERMS_VERSION } from "@/lib/legal/organizer-terms";
import { parsePixDetails } from "@/lib/organizer/validation";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerClient } from "@/lib/supabase/server";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const GENERIC_ERROR = "Não foi possível esquecer o aparelho. Tente de novo.";
const ACCOUNT_PATH = "/organizador/conta";
const CODE_SEND_ERROR = "Não foi possível enviar o código. Tente de novo em instantes.";
const PIX_CHANGE_ERROR = "Não foi possível pedir a troca. Tente de novo.";

/** Reaceite dos Termos do organizador após mudança de versão (N16). */
export async function acceptOrganizerTermsAction(): Promise<ActionResult> {
  return runAction(async () => {
    const { userId } = await requireOrganizer();
    const admin = createAdminClient();
    const { error } = await admin.rpc("accept_organizer_terms", {
      p_user_id: userId,
      p_terms_version: ORGANIZER_TERMS_VERSION,
    });
    if (error) {
      if (/^ORG_/.test(error.message)) throw new ActionError(error.message.replace(/^ORG_\w+:\s*/, ""));
      console.error("[organizador] Falha ao aceitar os termos.", error.code);
      throw new ActionError("Não foi possível registrar o aceite. Tente de novo.");
    }
    // O aviso vive no layout: invalidar o layout inteiro (não só a page).
    revalidatePath("/organizador", "layout");
    revalidatePath("/organizador/conta", "page");
    return undefined;
  }, "Não foi possível registrar o aceite. Tente de novo.");
}

/** Com a sessão do próprio usuário: o banco só esquece aparelho da conta que está logada. */
export async function forgetMyDeviceAction(deviceId: string): Promise<ActionResult> {
  return runAction(async () => {
    await requireOrganizer();
    if (typeof deviceId !== "string" || !UUID_PATTERN.test(deviceId)) {
      throw new ActionError("Aparelho não encontrado.");
    }

    const supabase = await createServerClient();
    const { data, error } = await supabase.rpc("forget_my_device", { p_device_id: deviceId });
    if (error) {
      console.error("[aparelhos] Falha ao esquecer o aparelho.", error.code);
      throw new ActionError(GENERIC_ERROR);
    }
    if (data !== true) throw new ActionError("Este aparelho não está mais na lista. Atualize a página.");

    revalidatePath("/organizador/conta");
    return undefined;
  }, GENERIC_ERROR);
}

/** Recusa conhecida do banco (ORG_*) vira mensagem; o resto fica genérico e só o código vai ao log. */
function throwPixError(rpc: string, error: { message: string; code?: string }): never {
  if (/^ORG_[A-Z_]+/.test(error.message)) throw new ActionError(financeRefusalMessage(error.message));
  console.error(`[troca-pix] ${rpc} falhou.`, error.code);
  throw new Error(`${rpc} falhou`);
}

/** Passo 1 da troca: código de 6 números no e-mail da conta. */
export async function sendPixChangeCode(): Promise<ActionResult<{ email: string }>> {
  return runAction(async () => {
    const { userId } = await requireOrganizer();
    const {
      data: { user },
    } = await (await createServerClient()).auth.getUser();
    if (!user?.email || user.id !== userId) throw new ActionError(CODE_SEND_ERROR);

    const code = generateLoginCode();
    const { data: status, error } = await createAdminClient().rpc("issue_organizer_action_code", {
      p_actor: userId,
      p_purpose: "pix_change",
      p_code: code,
    });
    if (error) throwPixError("issue_organizer_action_code", error);
    if (status === "aguarde") throw new ActionError("Aguarde 1 minuto para pedir outro código.");
    if (status === "limite") throw new ActionError("Limite de códigos de hoje atingido. Tente amanhã.");
    if (status !== "ok") throw new ActionError(CODE_SEND_ERROR);

    const sent = await sendLoginCodeEmail({ to: user.email, code, purpose: "troca_pix" });
    if (sent !== "sent") {
      console.error("[troca-pix] Código não enviado por e-mail.", sent);
      throw new ActionError(CODE_SEND_ERROR);
    }
    return { email: maskEmail(user.email) };
  }, CODE_SEND_ERROR);
}

export type SubmitPixChangeInput = {
  code: string;
  pixKeyType: string;
  pixKey: string;
  pixHolderName: string;
  pixHolderDocument: string;
};

const CODE_STATUS_MESSAGE: Record<string, string> = {
  invalido: "Código incorreto. Confira e tente de novo.",
  bloqueado: "Muitas tentativas erradas. Peça um novo código.",
  expirado: "Código vencido ou já usado. Peça um novo código.",
};

/** Passo 2: código + chave nova. A troca só vale depois que o Espaço confirma. */
export async function submitPixChange(input: SubmitPixChangeInput): Promise<ActionResult<{ confirmAfter: string }>> {
  return runAction(async () => {
    const { userId } = await requireOrganizer();
    const raw = typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {};
    const code = normalizeLoginCode(raw.code);
    if (!code) throw new ActionError("Digite o código de 6 números que chegou no seu e-mail.");
    const pix = parsePixDetails(raw);
    if (!pix.ok) throw new ActionError(pix.error);

    const admin = createAdminClient();
    const { data, error } = await admin.rpc("request_pix_change", {
      p_actor: userId,
      p_code: code,
      p_pix_key_type: pix.value.pixKeyType,
      p_pix_key: pix.value.pixKey,
      p_holder_name: pix.value.pixHolderName,
      p_holder_document: pix.value.pixHolderDocument,
    });
    if (error) throwPixError("request_pix_change", error);
    const result = typeof data === "object" && data !== null ? (data as Record<string, unknown>) : {};
    if (result.status !== "ok") {
      throw new ActionError(CODE_STATUS_MESSAGE[String(result.status)] ?? PIX_CHANGE_ERROR);
    }
    const confirmAfter = typeof result.confirm_after === "string" ? result.confirm_after : "";
    revalidatePath(ACCOUNT_PATH);

    const { data: profile } = await admin
      .from("organizer_profiles")
      .select("public_name")
      .eq("user_id", userId)
      .maybeSingle();
    await Promise.all([
      notifyOrganizer(userId, "org_pix_troca_pedida", { link: organizerNoticeLink(ACCOUNT_PATH) }),
      notifyTeam("equipe_pix_troca_pedida", {
        organizerName: profile?.public_name ?? undefined,
        confirmAfter: confirmAfter || undefined,
        link: organizerNoticeLink("/equipe/organizadores"),
      }),
    ]);
    return { confirmAfter };
  }, PIX_CHANGE_ERROR);
}

export async function cancelPixChange(requestId: string): Promise<ActionResult> {
  return runAction(async () => {
    const { userId } = await requireOrganizer();
    if (typeof requestId !== "string" || !UUID_PATTERN.test(requestId)) {
      throw new ActionError("Pedido não encontrado. Atualize a página.");
    }
    const { error } = await createAdminClient().rpc("cancel_pix_change", {
      p_actor: userId,
      p_request_id: requestId,
    });
    if (error) throwPixError("cancel_pix_change", error);
    revalidatePath(ACCOUNT_PATH);
    return undefined;
  }, "Não foi possível cancelar a troca. Tente de novo.");
}
