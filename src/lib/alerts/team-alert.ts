import "server-only";

import type { SupabaseAdmin } from "@/lib/domain/orders";
import {
  releaseRateLimit,
  tryConsumeRateLimit,
  type RateLimitRule,
} from "@/lib/security/rate-limit";

export type TeamAlertKind =
  | "valor_divergente"
  | "confirmacao_falhou"
  | "email_nao_enviado"
  | "pago_sem_vaga"
  | "pago_apos_cancelamento"
  | "estorno_falhou"
  | "estorno_externo"
  | "email_estorno_nao_enviado";

/** Alertas de configuração do site, sem pedido associado. */
export type TeamSetupAlertKind = "webhook_sem_chave";

const ALERT_SUBJECTS: Record<TeamAlertKind, string> = {
  valor_divergente: "Pagamento com valor diferente do pedido",
  confirmacao_falhou: "Pagamento recebido, mas o ingresso não foi liberado",
  email_nao_enviado: "Pedido pago, mas o e-mail com os ingressos não saiu",
  pago_sem_vaga: "Pagamento recebido sem vaga no evento — decidir",
  pago_apos_cancelamento: "Pagamento recebido depois do cancelamento — decidir",
  estorno_falhou: "Estorno recusado pelo Mercado Pago",
  estorno_externo: "Estorno feito fora do site",
  email_estorno_nao_enviado: "Pedido estornado, mas o e-mail ao comprador não saiu",
};

const SETUP_ALERT_SUBJECTS: Record<TeamSetupAlertKind, string> = {
  webhook_sem_chave: "Avisos de pagamento recusados: falta a chave secreta do Mercado Pago",
};

/** A página do pedido reconsulta o pagamento a cada poucos segundos: 1 alerta por pedido/tipo por dia. */
const ALERT_DEDUP: RateLimitRule = {
  bucket: "alert:order",
  limit: 1,
  windowSeconds: 86_400,
};

/** Cada aviso do Mercado Pago dispararia de novo: 1 alerta por tipo por dia. */
const SETUP_ALERT_DEDUP: RateLimitRule = {
  bucket: "alert:setup",
  limit: 1,
  windowSeconds: 86_400,
};

type OrderSummary = {
  buyer_name: string;
  buyer_email: string;
  events: { name: string } | null;
};

type AlertLog = Record<string, string>;

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

function joinLines(lines: string[]): string {
  return lines
    .filter((line, index, all) => line !== "" || all[index - 1] !== "")
    .join("\n");
}

/**
 * Envia um alerta deduplicado. Perder alerta é pior que duplicar: se o banco falha na
 * deduplicação, envia mesmo assim; se o envio falha, libera a deduplicação para a
 * próxima tentativa. Nunca lança.
 */
async function deliverAlert(
  admin: SupabaseAdmin,
  rule: RateLimitRule,
  dedupKey: string,
  subject: string,
  buildText: () => Promise<string>,
  log: AlertLog,
): Promise<void> {
  let reserved = false;
  try {
    const to = process.env.ALERT_EMAIL;
    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.RESEND_FROM_EMAIL;

    if (!to || !apiKey || !from) {
      console.warn("[alerta] ALERT_EMAIL não configurado; alerta só no log.", log);
      return;
    }

    const dedup = await tryConsumeRateLimit(admin, rule, dedupKey);
    if (dedup === "limited") return;
    if (dedup === "error") {
      console.warn("[alerta] Não foi possível conferir alerta repetido; enviando mesmo assim.", log);
    }
    reserved = dedup === "allowed";

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject: `[Alerta] ${subject}`,
        text: await buildText(),
      }),
    });

    if (response.ok) return;
    console.error(`[alerta] Resend recusou o alerta (${response.status}).`, log);
  } catch (error) {
    console.error("[alerta] Falha ao enviar alerta.", { ...log, error });
  }

  if (reserved && !(await releaseRateLimit(admin, rule, dedupKey))) {
    console.error("[alerta] Alerta não saiu e novas tentativas ficam bloqueadas até 24h.", log);
  }
}

/** Avisa a equipe por e-mail. Nunca lança: alerta não pode travar a confirmação. */
export async function alertTeam(
  admin: SupabaseAdmin,
  kind: TeamAlertKind,
  orderId: string,
  details: string,
): Promise<void> {
  await deliverAlert(
    admin,
    ALERT_DEDUP,
    `${kind}:${orderId}`,
    ALERT_SUBJECTS[kind],
    async () => {
      const order = await loadOrderSummary(admin, orderId);
      const appUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
      return joinLines([
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
      ]);
    },
    { kind, orderId },
  );
}

/** Avisa a equipe sobre configuração faltando no site. Nunca lança. */
export async function alertTeamSetup(
  admin: SupabaseAdmin,
  kind: TeamSetupAlertKind,
  details: string,
): Promise<void> {
  await deliverAlert(
    admin,
    SETUP_ALERT_DEDUP,
    kind,
    SETUP_ALERT_SUBJECTS[kind],
    async () => joinLines([SETUP_ALERT_SUBJECTS[kind], "", details]),
    { kind },
  );
}
