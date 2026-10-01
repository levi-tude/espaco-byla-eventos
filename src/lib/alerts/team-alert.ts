import "server-only";

import type { SupabaseAdmin } from "@/lib/domain/orders";
import { consumeRateLimit, type RateLimitRule } from "@/lib/security/rate-limit";

export type TeamAlertKind =
  | "valor_divergente"
  | "confirmacao_falhou"
  | "email_nao_enviado"
  | "pago_sem_vaga"
  | "pago_apos_cancelamento";

const ALERT_SUBJECTS: Record<TeamAlertKind, string> = {
  valor_divergente: "Pagamento com valor diferente do pedido",
  confirmacao_falhou: "Pagamento recebido, mas o ingresso não foi liberado",
  email_nao_enviado: "Pedido pago, mas o e-mail com os ingressos não saiu",
  pago_sem_vaga: "Pagamento recebido sem vaga no evento — decidir",
  pago_apos_cancelamento: "Pagamento recebido depois do cancelamento — decidir",
};

/** A página do pedido reconsulta o pagamento a cada poucos segundos: 1 alerta por pedido/tipo por dia. */
const ALERT_DEDUP: RateLimitRule = {
  bucket: "alert:order",
  limit: 1,
  windowSeconds: 86_400,
};

type OrderSummary = {
  buyer_name: string;
  buyer_email: string;
  events: { name: string } | null;
};

async function loadOrderSummary(
  admin: SupabaseAdmin,
  orderId: string,
): Promise<OrderSummary | null> {
  const { data } = await admin
    .from("orders")
    .select("buyer_name, buyer_email, events(name)")
    .eq("id", orderId)
    .maybeSingle();
  return (data as OrderSummary | null) ?? null;
}

/** Avisa a equipe por e-mail. Nunca lança: alerta não pode travar a confirmação. */
export async function alertTeam(
  admin: SupabaseAdmin,
  kind: TeamAlertKind,
  orderId: string,
  details: string,
): Promise<void> {
  try {
    const to = process.env.ALERT_EMAIL;
    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.RESEND_FROM_EMAIL;
    const appUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");

    if (!to || !apiKey || !from) {
      console.warn("[alerta] ALERT_EMAIL não configurado; alerta só no log.", {
        kind,
        orderId,
      });
      return;
    }

    if (!(await consumeRateLimit(admin, ALERT_DEDUP, `${kind}:${orderId}`))) {
      return;
    }

    const order = await loadOrderSummary(admin, orderId);
    const text = [
      ALERT_SUBJECTS[kind],
      "",
      details,
      "",
      `Evento: ${order?.events?.name ?? "não encontrado"}`,
      `Comprador: ${order ? `${order.buyer_name} <${order.buyer_email}>` : "não encontrado"}`,
      `Pedido (código interno): ${orderId}`,
      appUrl ? `Área da equipe: ${appUrl}/equipe` : "",
      "",
      "Confira o pagamento no painel do Mercado Pago antes de liberar ou devolver.",
    ]
      .filter((line, index, lines) => line !== "" || lines[index - 1] !== "")
      .join("\n");

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject: `[Alerta] ${ALERT_SUBJECTS[kind]}`,
        text,
      }),
    });

    if (!response.ok) {
      console.error(`[alerta] Resend recusou o alerta (${response.status}).`, {
        kind,
        orderId,
      });
    }
  } catch (error) {
    console.error("[alerta] Falha ao enviar alerta.", { kind, orderId, error });
  }
}
