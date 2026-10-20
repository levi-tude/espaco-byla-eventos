"use server";

import { revalidatePath } from "next/cache";

import { ActionError, runAction, type ActionResult } from "@/lib/action-result";
import { requireTeamAdmin } from "@/lib/auth/actor";
import { requireFinanceAdmin } from "@/lib/auth/finance-admin";
import { organizerErrorMessage } from "@/lib/organizer/errors";
import { financeRefusalMessage } from "@/lib/organizer/finance";
import { hashInviteToken, inviteLink, newInviteToken, whatsappInviteUrl } from "@/lib/organizer/invite-token";
import { notifyOrganizer, organizerNoticeLink } from "@/lib/organizer/notify";
import { type PixChangeDetails, parsePixChangeDetails } from "@/lib/organizer/pix-change";
import { RATE_LIMIT_MESSAGE } from "@/lib/security/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";

const PAGE_PATH = "/equipe/organizadores";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LABEL_MAX = 80;
const REASON_MIN = 5;
const REASON_MAX = 500;
const INVITE_DAYS = 7;
const RESET_HOURS = 24;

const INVITE_ERROR = "Não foi possível gerar o convite. Confira os dados e tente de novo.";
const RESET_ERROR = "Não foi possível gerar o link. Tente de novo.";
const ACCOUNT_NOT_FOUND = "Conta não encontrada.";
const REASON_MESSAGE = `Escreva o motivo (de ${REASON_MIN} a ${REASON_MAX} caracteres).`;

export type GeneratedLink = { link: string; whatsappUrl: string; expiresAt: string };
export type OrganizerStatus = "ativo" | "suspenso" | "encerrado";

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function appUrl(): string {
  const url = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (!url) {
    console.error("[organizadores] Endereço do site não configurado; link não gerado.");
    throw new ActionError("Não foi possível gerar o link agora. Fale com o desenvolvedor.");
  }
  return url;
}

function whatsappResetUrl(link: string): string {
  const text =
    "Olá! Este é o seu link para criar uma nova senha no site do ACDH Eventos. " +
    `O link vale por ${RESET_HOURS} horas e só pode ser usado uma vez: ${link}`;
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

/** Só o código do erro vai para o registro (nunca token, hash ou dados da conta). */
function logRpcError(rpc: string, error: { code?: string }) {
  console.error(`[organizadores] Falha em ${rpc}.`, error.code ?? "sem-codigo");
}

export async function createInvite(input: {
  label: string;
  requestId?: string | null;
}): Promise<ActionResult<GeneratedLink>> {
  return runAction(async () => {
    const { userId } = await requireTeamAdmin();
    if (typeof input !== "object" || input === null || typeof input.label !== "string") {
      throw new ActionError(INVITE_ERROR);
    }
    const label = input.label.trim();
    if (label.length > LABEL_MAX) throw new ActionError(`O apelido pode ter até ${LABEL_MAX} caracteres.`);
    const requestId = input.requestId ?? null;
    if (requestId !== null && !isUuid(requestId)) throw new ActionError("Pedido não encontrado.");
    const baseUrl = appUrl();

    const token = newInviteToken();
    const { error } = await createAdminClient().rpc("create_organizer_invite", {
      p_admin: userId,
      p_token_hash: hashInviteToken(token),
      p_kind: "convite",
      p_label: label || null,
      p_request_id: requestId,
      p_target_user_id: null,
    });
    if (error) {
      logRpcError("create_organizer_invite", error);
      if (error.message.includes("ORG_LIMITE")) throw new ActionError(RATE_LIMIT_MESSAGE);
      throw new ActionError(organizerErrorMessage(error.message, { area: "admin" }) ?? INVITE_ERROR);
    }

    revalidatePath(PAGE_PATH);
    const link = inviteLink(baseUrl, token, "convite");
    return {
      link,
      whatsappUrl: whatsappInviteUrl(link),
      expiresAt: new Date(Date.now() + INVITE_DAYS * 86_400_000).toISOString(),
    };
  }, INVITE_ERROR);
}

export async function revokeInvite(inviteId: string): Promise<ActionResult> {
  const fallback = "Não foi possível revogar o convite. Tente de novo.";
  return runAction(async () => {
    const { userId } = await requireTeamAdmin();
    if (!isUuid(inviteId)) throw new ActionError("Convite não encontrado.");

    const { data, error } = await createAdminClient().rpc("revoke_organizer_invite", {
      p_admin: userId,
      p_invite_id: inviteId,
    });
    if (error) {
      logRpcError("revoke_organizer_invite", error);
      throw new ActionError(fallback);
    }
    if (data !== true) throw new ActionError("Este convite já não está ativo. Atualize a página.");

    revalidatePath(PAGE_PATH);
    return undefined;
  }, fallback);
}

export async function archiveSignupRequest(requestId: string): Promise<ActionResult> {
  const fallback = "Não foi possível arquivar o pedido. Tente de novo.";
  return runAction(async () => {
    const { userId } = await requireTeamAdmin();
    if (!isUuid(requestId)) throw new ActionError("Pedido não encontrado.");

    const { data, error } = await createAdminClient().rpc("archive_signup_request", {
      p_admin: userId,
      p_id: requestId,
    });
    if (error) {
      logRpcError("archive_signup_request", error);
      throw new ActionError(fallback);
    }
    if (data !== true) throw new ActionError("Este pedido já foi arquivado. Atualize a página.");

    revalidatePath(PAGE_PATH);
    return undefined;
  }, fallback);
}

export async function setOrganizerStatus(
  userId: string,
  status: OrganizerStatus,
  reason: string,
): Promise<ActionResult> {
  const fallback = "Não foi possível mudar a situação da conta. Tente de novo.";
  return runAction(async () => {
    const admin = await requireTeamAdmin();
    if (!isUuid(userId)) throw new ActionError(ACCOUNT_NOT_FOUND);
    if (status !== "ativo" && status !== "suspenso" && status !== "encerrado") {
      throw new ActionError("Confira os dados e tente de novo.");
    }
    // Reativar não pede motivo: o banco apaga o motivo ao voltar para "ativo".
    let cleanReason: string | null = null;
    if (status !== "ativo") {
      cleanReason = typeof reason === "string" ? reason.trim() : "";
      if (cleanReason.length < REASON_MIN || cleanReason.length > REASON_MAX) {
        throw new ActionError(REASON_MESSAGE);
      }
    }

    const client = createAdminClient();
    // Conta já suspensa: o banco não muda nada nem grava o motivo novo, então não há aviso a mandar.
    let alreadySuspended = false;
    if (status === "suspenso") {
      const { data: accounts, error: listError } = await client.rpc("list_organizers", { p_admin: admin.userId });
      if (listError) {
        logRpcError("list_organizers", listError);
        throw new ActionError(fallback);
      }
      const current = (accounts ?? []).find((account) => account.user_id === userId);
      if (!current) throw new ActionError(ACCOUNT_NOT_FOUND);
      alreadySuspended = current.status === "suspenso";
    }

    const { error } = await client.rpc("set_organizer_status", {
      p_admin: admin.userId,
      p_user_id: userId,
      p_status: status,
      p_reason: cleanReason,
    });
    if (error) {
      logRpcError("set_organizer_status", error);
      throw new ActionError(fallback);
    }

    if (status === "suspenso" && cleanReason && !alreadySuspended) {
      await notifyOrganizer(userId, "org_conta_suspensa", {
        note: cleanReason,
        link: organizerNoticeLink("/organizador"),
      });
    }
    revalidatePath(PAGE_PATH);
    return undefined;
  }, fallback);
}

export async function forgetAccountDevices(userId: string): Promise<ActionResult<{ forgotten: number }>> {
  const fallback = "Não foi possível esquecer os aparelhos. Tente de novo.";
  return runAction(async () => {
    const admin = await requireTeamAdmin();
    if (!isUuid(userId)) throw new ActionError(ACCOUNT_NOT_FOUND);

    const { data, error } = await createAdminClient().rpc("admin_forget_devices", {
      p_admin: admin.userId,
      p_user_id: userId,
    });
    if (error) {
      logRpcError("admin_forget_devices", error);
      throw new ActionError(fallback);
    }

    revalidatePath(PAGE_PATH);
    return { forgotten: typeof data === "number" ? data : 0 };
  }, fallback);
}

export async function createPasswordResetLink(userId: string): Promise<ActionResult<GeneratedLink>> {
  return runAction(async () => {
    const admin = await requireTeamAdmin();
    if (!isUuid(userId)) throw new ActionError(ACCOUNT_NOT_FOUND);
    const baseUrl = appUrl();

    const token = newInviteToken();
    const { error } = await createAdminClient().rpc("create_organizer_invite", {
      p_admin: admin.userId,
      p_token_hash: hashInviteToken(token),
      p_kind: "redefinir_senha",
      p_label: null,
      p_request_id: null,
      p_target_user_id: userId,
    });
    if (error) {
      logRpcError("create_organizer_invite", error);
      if (error.message.includes("ORG_LIMITE")) throw new ActionError(RATE_LIMIT_MESSAGE);
      if (error.message.includes("ORG_CONVITE")) {
        throw new ActionError("Esta conta não está ativa. Reative a conta antes de gerar o link.");
      }
      if (error.message.includes("ORG_ACESSO")) throw new ActionError(ACCOUNT_NOT_FOUND);
      throw new ActionError(RESET_ERROR);
    }

    const link = inviteLink(baseUrl, token, "redefinir_senha");
    return {
      link,
      whatsappUrl: whatsappResetUrl(link),
      expiresAt: new Date(Date.now() + RESET_HOURS * 3_600_000).toISOString(),
    };
  }, RESET_ERROR);
}

function throwPixError(rpc: string, error: { message: string; code?: string }): never {
  if (/^(ORG|TAXA)_[A-Z_]+/.test(error.message)) throw new ActionError(financeRefusalMessage(error.message));
  logRpcError(rpc, error);
  throw new Error(`${rpc} falhou`);
}

/** "Ver e decidir": chave atual e nova completas, só para o Admin do Espaço. */
export async function loadPixChangeDetails(requestId: string): Promise<ActionResult<PixChangeDetails>> {
  return runAction(async () => {
    const { userId } = await requireFinanceAdmin({ write: true });
    if (!isUuid(requestId)) throw new ActionError("Pedido não encontrado. Atualize a página.");
    const { data, error } = await createAdminClient().rpc("pix_change_details", {
      p_admin: userId,
      p_request_id: requestId,
    });
    if (error) throwPixError("pix_change_details", error);
    const details = parsePixChangeDetails(data);
    if (!details) throw new Error("pix_change_details: resposta inválida");
    return details;
  }, "Não foi possível abrir o pedido de troca.");
}

export async function decidePixChange(input: {
  requestId: string;
  approve: boolean;
  note?: string | null;
}): Promise<ActionResult<{ status: "confirmada" | "recusada" }>> {
  return runAction(async () => {
    const { userId } = await requireFinanceAdmin({ write: true });
    const raw = typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {};
    if (!isUuid(raw.requestId)) throw new ActionError("Pedido não encontrado. Atualize a página.");
    if (typeof raw.approve !== "boolean") throw new ActionError("Escolha confirmar ou recusar.");
    const note = typeof raw.note === "string" ? raw.note.trim() : "";
    if (!raw.approve && (note.length < REASON_MIN || note.length > REASON_MAX)) throw new ActionError(REASON_MESSAGE);
    if (note.length > REASON_MAX) throw new ActionError(REASON_MESSAGE);

    const { data, error } = await createAdminClient().rpc("decide_pix_change", {
      p_admin: userId,
      p_request_id: raw.requestId,
      p_approve: raw.approve,
      p_note: note || null,
    });
    if (error) throwPixError("decide_pix_change", error);
    const result = typeof data === "object" && data !== null ? (data as Record<string, unknown>) : {};
    const status = raw.approve ? "confirmada" : "recusada";
    revalidatePath(PAGE_PATH);
    if (typeof result.organizer_id === "string") {
      await notifyOrganizer(result.organizer_id, raw.approve ? "org_pix_troca_confirmada" : "org_pix_troca_recusada", {
        note: raw.approve ? undefined : note,
        link: organizerNoticeLink("/organizador/conta"),
      });
    }
    return { status };
  }, "Não foi possível registrar a decisão.");
}
