import "server-only";

import type { SupabaseAdmin } from "@/lib/domain/orders";
import { ticketKindLabels, ticketTypeLabel } from "@/lib/domain/ticket-types";
import { buildRefundEmail } from "@/lib/email/refund-template";
import {
  sendSessionNoticeEmail,
  sessionNoticeEmailConfig,
  type SessionNoticeEmailConfig,
} from "@/lib/email/send-session-notice";
import {
  buildScheduleChangeEmail,
  buildSessionCancelledEmail,
  type SessionNoticeEmailContent,
} from "@/lib/email/session-notice-template";
import { NOTICE_DAILY_SOFT_CAP, NOTICE_SEND_INTERVAL_MS, nextQuotaReset } from "@/lib/notices/rules";
import type { Database, Json } from "@/types/database";

type DeliveryRow = Database["public"]["Functions"]["claim_session_notice_deliveries"]["Returns"][number];
type TicketKind = keyof typeof ticketKindLabels;

export type SessionNoticeRunResult =
  | { status: "not_configured" }
  | { status: "error" }
  | { status: "ok"; claimed: number; sent: number; failed: number; pausedUntil: string | null };

export type SessionNoticeRunDeps = {
  config?: SessionNoticeEmailConfig | null;
  send?: typeof sendSessionNoticeEmail;
  pause?: (ms: number) => Promise<void>;
  now?: () => number;
};

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function parseTickets(value: Json | null): { holderName: string; kindLabel: string }[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((ticket) => {
    if (!ticket || typeof ticket !== "object" || Array.isArray(ticket)) return [];
    const { holder_name: holderName, kind, item_name: itemName } = ticket;
    if (typeof holderName !== "string" || typeof kind !== "string" || !(kind in ticketKindLabels)) {
      return [];
    }
    return [
      {
        holderName,
        kindLabel: ticketTypeLabel(typeof itemName === "string" ? itemName : null, kind as TicketKind),
      },
    ];
  });
}

/** Taxa gravada no pedido; sem ela o e-mail só não menciona a taxa. */
async function orderServiceFeeCents(admin: SupabaseAdmin, orderId: string): Promise<number> {
  try {
    const { data, error } = await admin
      .from("orders")
      .select("service_fee_cents")
      .eq("id", orderId)
      .maybeSingle();
    return error || !data ? 0 : data.service_fee_cents;
  } catch {
    return 0;
  }
}

/** Monta o e-mail da entrega; `null` se faltar dado essencial (a entrega volta para a fila). */
function buildContent(
  row: DeliveryRow,
  config: SessionNoticeEmailConfig,
  serviceFeeCents: number,
): SessionNoticeEmailContent | null {
  const orderUrl = `${config.appUrl}/pedidos/${encodeURIComponent(row.public_token)}`;
  const common = {
    buyerName: row.buyer_name,
    eventName: row.event_name,
    venue: row.event_venue,
    sessionName: row.session_name,
    orderUrl,
    replyAvailable: config.replyTo !== null,
  };
  switch (row.kind) {
    case "alteracao_horario":
      if (!row.previous_starts_at) return null;
      return buildScheduleChangeEmail({
        ...common,
        previousStartsAt: row.previous_starts_at,
        newStartsAt: row.session_starts_at,
        newEndsAt: row.session_ends_at,
      });
    case "cancelamento":
      return buildSessionCancelledEmail({
        ...common,
        startsAt: row.session_starts_at,
        endsAt: row.session_ends_at,
        reason: row.reason,
        isCourtesy: row.total_cents === 0,
        serviceFeeCents,
      });
    case "estorno_cancelamento":
      if (row.refund_amount_cents === null) return null;
      return buildRefundEmail({
        buyerName: row.buyer_name,
        eventName: row.event_name,
        startsAt: row.session_starts_at,
        sessionName: row.session_name,
        amountCents: row.refund_amount_cents,
        serviceFeeCents,
        tickets: parseTickets(row.tickets),
        orderUrl,
        sessionCancelled: true,
      });
    default:
      return null;
  }
}

/**
 * Envia as entregas pendentes dos avisos de sessão (o banco escolhe quem recebe e
 * nunca entrega o mesmo comunicado duas vezes ao mesmo pedido). Para quando o uso
 * do dia chega ao teto ou o limite estoura: a fila fica pausada até a renovação e
 * o restante continua no próximo envio (agendador ou botão "Continuar envio").
 */
export async function runSessionNotices(
  admin: SupabaseAdmin,
  input: { limit: number; noticeId?: string | null; orderId?: string | null },
  {
    config = sessionNoticeEmailConfig(),
    send = sendSessionNoticeEmail,
    pause = wait,
    now = Date.now,
  }: SessionNoticeRunDeps = {},
): Promise<SessionNoticeRunResult> {
  if (!config) {
    console.error(
      "[aviso-sessao] Avisos não enviados: configure RESEND_API_KEY, RESEND_FROM_EMAIL e NEXT_PUBLIC_APP_URL.",
    );
    return { status: "not_configured" };
  }

  const { data, error } = await admin.rpc("claim_session_notice_deliveries", {
    p_limit: input.limit,
    p_notice_id: input.noticeId ?? null,
    p_order_id: input.orderId ?? null,
  });
  if (error) {
    console.error("[aviso-sessao] Falha ao buscar avisos para enviar.", error);
    return { status: "error" };
  }

  const release = async (deliveryId: string, code: string, quota: boolean) => {
    const { error: releaseError } = await admin.rpc("release_session_notice_delivery", {
      p_delivery_id: deliveryId,
      p_error_code: code,
      p_quota: quota,
    });
    if (releaseError) {
      console.error("[aviso-sessao] Falha ao devolver o aviso para a fila.", releaseError);
    }
  };

  let pausedUntil: string | null = null;
  const pauseQueue = async () => {
    const until = nextQuotaReset(now());
    const { error: pauseError } = await admin.rpc("pause_session_notice_emails", { p_until: until });
    if (pauseError) console.error("[aviso-sessao] Falha ao pausar a fila de avisos.", pauseError);
    pausedUntil = until;
  };

  const rows = data ?? [];
  let sent = 0;
  let failed = 0;
  let attempted = 0;
  for (const row of rows) {
    if (pausedUntil) {
      await release(row.delivery_id, "cota", true);
      continue;
    }

    const mentionsRefund =
      row.kind === "estorno_cancelamento" || (row.kind === "cancelamento" && row.total_cents > 0);
    const serviceFeeCents = mentionsRefund ? await orderServiceFeeCents(admin, row.order_id) : 0;
    const content = buildContent(row, config, serviceFeeCents);
    if (!content) {
      failed += 1;
      console.error("[aviso-sessao] Aviso sem dados suficientes para montar o e-mail.", {
        deliveryId: row.delivery_id,
        kind: row.kind,
      });
      await release(row.delivery_id, "dados_incompletos", false);
      continue;
    }

    if (attempted > 0) await pause(NOTICE_SEND_INTERVAL_MS);
    attempted += 1;
    const result = await send({
      config,
      to: row.buyer_email,
      content,
      idempotencyKey: `aviso-sessao/${row.delivery_id}`,
    });

    if (result.status === "sent") {
      sent += 1;
      const { error: markError } = await admin.rpc("mark_session_notice_sent", {
        p_delivery_id: row.delivery_id,
      });
      if (markError) {
        console.error("[aviso-sessao] Aviso enviado, mas o envio não foi registrado.", markError);
      }
      if (result.quotaUsed !== null && result.quotaUsed >= NOTICE_DAILY_SOFT_CAP) await pauseQueue();
    } else if (result.status === "quota") {
      await release(row.delivery_id, "cota", true);
      await pauseQueue();
    } else {
      failed += 1;
      await release(row.delivery_id, "envio_falhou", false);
    }
  }

  return { status: "ok", claimed: rows.length, sent, failed, pausedUntil };
}
