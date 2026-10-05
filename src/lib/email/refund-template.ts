import { formatSessionWhen } from "@/lib/datetime";
import { sessionName as cleanSessionName } from "@/lib/domain/sessions";

export type RefundEmailData = {
  buyerName: string;
  eventName: string;
  /** Início da sessão do pedido. */
  startsAt: string;
  sessionName?: string | null;
  amountCents: number;
  /** Taxa de serviço do pedido; > 0 deixa claro que ela também foi devolvida. */
  serviceFeeCents?: number;
  tickets: { holderName: string; kindLabel: string }[];
  orderUrl: string;
  /** Estorno de sessão cancelada: assunto e abertura "Sessão cancelada — valor devolvido". */
  sessionCancelled?: boolean;
};

export type RefundEmailContent = {
  subject: string;
  html: string;
  text: string;
};

const BRAND_BLUE = "#4080FC";

const currency = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function firstName(fullName: string) {
  return fullName.trim().split(/\s+/)[0] || fullName.trim();
}

/** "Sessão infantil · Sábado, 10 de outubro de 2026 · 16h00" (nome só se existir). */
function formatSession(startsAt: string, name?: string | null) {
  return [cleanSessionName(name), formatSessionWhen(startsAt)].filter(Boolean).join(" · ");
}

/** Texto ao comprador: não cita fornecedores (banco, provedor de pagamento etc.). */
const TIMING_LINES = [
  "Cartão de crédito: o valor aparece como crédito na fatura, em até 2 faturas, conforme o banco do cartão.",
  "PIX: o valor volta para a conta de origem do pagamento.",
];

export function buildRefundEmail(data: RefundEmailData): RefundEmailContent {
  const name = firstName(data.buyerName);
  const when = formatSession(data.startsAt, data.sessionName);
  const amount = currency.format(data.amountCents / 100);
  const total = data.tickets.length;
  const count = total === 1 ? "1 ingresso" : `${total} ingressos`;
  const share =
    (data.serviceFeeCents ?? 0) > 0
      ? "100% do pedido, incluindo a taxa de serviço"
      : "100% do pedido";

  const cancelled = data.sessionCancelled === true;
  const title = cancelled ? "Sessão cancelada — valor devolvido" : "Seu pedido foi estornado";
  const subject = cancelled
    ? `Sessão cancelada — valor devolvido — ${data.eventName}`
    : `Seu pedido foi estornado — ${data.eventName}`;
  const opening = (event: string, session: string) =>
    cancelled
      ? `A sessão de ${event}${session} foi cancelada e o seu pedido foi estornado.`
      : `O pedido para ${event}${session} foi estornado.`;

  const paragraph = (content: string) =>
    `<p style="margin:0 0 12px;font-size:15px;line-height:22px;color:#333333;">${content}</p>`;

  const ticketItems = data.tickets
    .map(
      (ticket) =>
        `<li style="margin:0 0 4px;">${escapeHtml(ticket.holderName)} · ${escapeHtml(ticket.kindLabel)}</li>`,
    )
    .join("");

  const html = `<!doctype html>
<html lang="pt-BR">
  <body style="margin:0;padding:0;background:#f4f5f7;font-family:Arial,Helvetica,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:24px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:12px;overflow:hidden;">
            <tr>
              <td style="background:#111111;padding:20px 24px;color:#ffffff;font-size:18px;font-weight:bold;">Espaço Byla</td>
            </tr>
            <tr>
              <td style="padding:28px 24px 8px;">
                <h1 style="margin:0 0 12px;font-size:22px;line-height:28px;color:#111111;">${escapeHtml(title)}</h1>
                ${paragraph(`Olá, ${escapeHtml(name)}! ${opening(`<strong>${escapeHtml(data.eventName)}</strong>`, when ? ` (${escapeHtml(when)})` : "")}`)}
                ${paragraph(`<strong>Valor devolvido:</strong> ${escapeHtml(amount)} (${share}), para o mesmo meio de pagamento usado na compra.`)}
                ${paragraph(`<strong>Ingressos cancelados (${escapeHtml(count)}):</strong>`)}
                <ul style="margin:0 0 16px;padding-left:20px;font-size:15px;line-height:22px;color:#333333;">${ticketItems}</ul>
                ${paragraph("<strong>Quando o dinheiro aparece:</strong>")}
                <ul style="margin:0 0 16px;padding-left:20px;font-size:14px;line-height:20px;color:#555555;">${TIMING_LINES.map((line) => `<li style="margin:0 0 4px;">${escapeHtml(line)}</li>`).join("")}</ul>
                ${paragraph("Os QR Codes deste pedido não valem mais para entrar no evento.")}
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:12px 24px 8px;">
                <a href="${escapeHtml(data.orderUrl)}" style="display:inline-block;background:${BRAND_BLUE};color:#ffffff;text-decoration:none;font-size:16px;font-weight:bold;padding:14px 28px;border-radius:8px;">Ver pedido</a>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 24px 28px;">
                <p style="margin:0;font-size:13px;line-height:18px;color:#888888;">Se tiver dúvidas, fale com a equipe do Espaço Byla.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  const text = [
    `Olá, ${name}!`,
    "",
    opening(data.eventName, when ? ` (${when})` : ""),
    `Valor devolvido: ${amount} (${share}), para o mesmo meio de pagamento usado na compra.`,
    "",
    `Ingressos cancelados (${count}):`,
    ...data.tickets.map((ticket) => `- ${ticket.holderName} (${ticket.kindLabel})`),
    "",
    "Quando o dinheiro aparece:",
    ...TIMING_LINES.map((line) => `- ${line}`),
    "",
    "Os QR Codes deste pedido não valem mais para entrar no evento.",
    `Ver pedido: ${data.orderUrl}`,
    "",
    "Espaço Byla",
  ].join("\n");

  return { subject, html, text };
}
