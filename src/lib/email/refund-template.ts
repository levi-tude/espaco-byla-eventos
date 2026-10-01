import { eventDateFormatter } from "@/lib/datetime";

export type RefundEmailData = {
  buyerName: string;
  eventName: string;
  startsAt: string;
  amountCents: number;
  tickets: { holderName: string; kindLabel: string }[];
  orderUrl: string;
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

function formatStartsAt(startsAt: string) {
  const date = new Date(startsAt);
  if (Number.isNaN(date.getTime())) return "";
  return eventDateFormatter({ dateStyle: "full", timeStyle: "short" }).format(date);
}

/** Texto ao comprador: não cita fornecedores (banco, provedor de pagamento etc.). */
const TIMING_LINES = [
  "Cartão de crédito: o valor aparece como crédito na fatura, em até 2 faturas, conforme o banco do cartão.",
  "PIX: o valor volta para a conta de origem do pagamento.",
];

export function buildRefundEmail(data: RefundEmailData): RefundEmailContent {
  const name = firstName(data.buyerName);
  const when = formatStartsAt(data.startsAt);
  const amount = currency.format(data.amountCents / 100);
  const total = data.tickets.length;
  const count = total === 1 ? "1 ingresso" : `${total} ingressos`;

  const subject = `Seu pedido foi estornado — ${data.eventName}`;

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
                <h1 style="margin:0 0 12px;font-size:22px;line-height:28px;color:#111111;">Seu pedido foi estornado</h1>
                ${paragraph(`Olá, ${escapeHtml(name)}! O pedido para <strong>${escapeHtml(data.eventName)}</strong>${when ? ` (${escapeHtml(when)})` : ""} foi estornado.`)}
                ${paragraph(`<strong>Valor devolvido:</strong> ${escapeHtml(amount)} (100% do pedido), para o mesmo meio de pagamento usado na compra.`)}
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
    `O pedido para ${data.eventName}${when ? ` (${when})` : ""} foi estornado.`,
    `Valor devolvido: ${amount} (100% do pedido), para o mesmo meio de pagamento usado na compra.`,
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
