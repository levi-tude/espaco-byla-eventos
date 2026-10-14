import "server-only";

import { isUuid } from "@/lib/domain/ticket-types";
import {
  buildOrganizerNotice,
  type OrganizerNoticeData,
  type OrganizerOnlyNoticeKind,
  type TeamNoticeKind,
} from "@/lib/email/organizer-notice-template";
import { sendOrganizerNotice, type SendOrganizerNoticeResult } from "@/lib/email/send-organizer-notice";
import { RATE_LIMITS, releaseRateLimit, tryConsumeRateLimit } from "@/lib/security/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";

type AdminClient = ReturnType<typeof createAdminClient>;

function errorKind(error: unknown): string {
  return error instanceof Error ? error.name : "desconhecido";
}

/** Endereço completo de uma página do site (`/equipe/aprovacoes`, `/organizador/eventos/<id>`...). */
export function organizerNoticeLink(path: string): string {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ?? "";
  return `${appUrl}${path.startsWith("/") ? path : `/${path}`}`;
}

function teamEmail(): string | null {
  const to = process.env.ALERT_EMAIL?.trim();
  return to ? to : null;
}

/** Avisa a equipe (`ALERT_EMAIL`). Nunca lança. */
export async function notifyTeam(
  kind: TeamNoticeKind,
  data: OrganizerNoticeData,
): Promise<SendOrganizerNoticeResult> {
  try {
    const to = teamEmail();
    if (!to) {
      console.warn(`[aviso-organizador] ALERT_EMAIL não configurado; aviso ${kind} só no painel.`);
      return "skipped";
    }
    return await sendOrganizerNotice(to, buildOrganizerNotice(kind, data));
  } catch (error) {
    console.error(`[aviso-organizador] Falha no aviso ${kind} à equipe (${errorKind(error)}).`);
    return "failed";
  }
}

/** Avisa o organizador no e-mail da conta. Nunca lança. */
export async function notifyOrganizer(
  userId: string,
  kind: OrganizerOnlyNoticeKind,
  data: OrganizerNoticeData,
): Promise<SendOrganizerNoticeResult> {
  try {
    if (!isUuid(userId)) {
      console.warn(`[aviso-organizador] Conta inválida; aviso ${kind} não enviado.`);
      return "skipped";
    }
    const admin = createAdminClient();
    const { data: found, error } = await admin.auth.admin.getUserById(userId);
    const to = found?.user?.email;
    if (error || !to) {
      console.warn(`[aviso-organizador] Conta sem e-mail; aviso ${kind} não enviado.`);
      return "skipped";
    }
    return await sendOrganizerNotice(to, buildOrganizerNotice(kind, data), admin);
  } catch (error) {
    console.error(`[aviso-organizador] Falha no aviso ${kind} ao organizador (${errorKind(error)}).`);
    return "failed";
  }
}

/**
 * Evento enviado para aprovação: no máximo 1 aviso por evento a cada 6 h (enviar e
 * voltar várias vezes não gasta a cota de avisos). Se o banco não confirma o intervalo,
 * não envia (o painel mostra tudo); se o envio não sai, libera o intervalo. Nunca lança.
 */
export async function notifyTeamEventSubmitted(
  admin: AdminClient,
  eventId: string,
  eventName: string | null | undefined,
): Promise<SendOrganizerNoticeResult> {
  const rule = RATE_LIMITS.organizerSubmitNotice;
  const key = `evento:${eventId}`;
  try {
    const to = teamEmail();
    if (!to) {
      console.warn("[aviso-organizador] ALERT_EMAIL não configurado; evento enviado só no painel.");
      return "skipped";
    }
    if (!isUuid(eventId)) return "skipped";

    const slot = await tryConsumeRateLimit(admin, rule, key);
    if (slot === "limited") return "skipped";
    if (slot === "error") {
      console.error("[aviso-organizador] Não foi possível conferir o intervalo de 6 h; aviso não enviado.");
      return "failed";
    }

    const result = await sendOrganizerNotice(
      to,
      buildOrganizerNotice("equipe_evento_enviado", {
        eventName: eventName ?? undefined,
        link: organizerNoticeLink("/equipe/aprovacoes"),
      }),
      admin,
    );
    if (result === "failed" || result === "skipped") {
      await releaseRateLimit(admin, rule, key);
    }
    return result;
  } catch (error) {
    console.error(`[aviso-organizador] Falha no aviso de evento enviado (${errorKind(error)}).`);
    return "failed";
  }
}

/**
 * Pedidos "nova" do site, pela mesma função do menu da equipe (a tabela só é lida por
 * funções do banco). `null` se não der para contar: o aviso sai sem número.
 */
async function countNewSignupRequests(admin: AdminClient): Promise<number | null> {
  try {
    const { data: staff, error } = await admin
      .from("staff_profiles")
      .select("user_id")
      .eq("role", "admin")
      .order("user_id")
      .limit(1)
      .maybeSingle();
    if (error || !staff) return null;
    const { data, error: countError } = await admin.rpc("team_pending_counts", { p_staff: staff.user_id });
    if (countError || !Array.isArray(data)) return null;
    const count = data[0]?.signup_requests;
    return typeof count === "number" ? count : null;
  } catch {
    return null;
  }
}

/**
 * Pedido "Quero fazer meu evento": no máximo 1 aviso a cada 6 h, resumindo quantos
 * pedidos novos esperam. Se o banco não confirma o intervalo, não envia (o painel mostra
 * tudo). Se o envio não sai, libera o intervalo para o próximo pedido tentar. Nunca lança.
 */
export async function notifyTeamSignupRequest(admin: AdminClient): Promise<SendOrganizerNoticeResult> {
  const rule = RATE_LIMITS.organizerSignupNotice;
  try {
    const to = teamEmail();
    if (!to) {
      console.warn("[aviso-organizador] ALERT_EMAIL não configurado; pedido do site só no painel.");
      return "skipped";
    }

    const slot = await tryConsumeRateLimit(admin, rule, "site");
    if (slot === "limited") return "skipped";
    if (slot === "error") {
      console.error("[aviso-organizador] Não foi possível conferir o intervalo de 6 h; aviso não enviado.");
      return "failed";
    }

    const count = await countNewSignupRequests(admin);
    const result = await sendOrganizerNotice(
      to,
      buildOrganizerNotice("equipe_pedido_site", {
        count: count ?? undefined,
        link: organizerNoticeLink("/equipe/organizadores"),
      }),
      admin,
    );
    if (result === "failed" || result === "skipped") {
      await releaseRateLimit(admin, rule, "site");
    }
    return result;
  } catch (error) {
    console.error(`[aviso-organizador] Falha no aviso de pedido do site (${errorKind(error)}).`);
    return "failed";
  }
}
