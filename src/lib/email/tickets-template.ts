import { formatSessionSubject, formatSessionWhen } from "@/lib/datetime";

export type TicketsEmailTicket = {
  holderName: string;
  kindLabel: string;
  code: string;
  /** Content-ID da imagem do QR anexada ao e-mail (`cid:`). */
  qrContentId: string;
};

export type TicketsEmailData = {
  buyerName: string;
  eventName: string;
  /** Só quando a sessão tem nome (ex.: "Sessão infantil"). */
  sessionName?: string | null;
  venue: string;
  /** Início e término da sessão do pedido. */
  startsAt: string;
  endsAt?: string | null;
  /** "A1B2C3D4" (8 primeiros caracteres do pedido; nunca o token público). */
  orderNumber: string;
  tickets: TicketsEmailTicket[];
  ticketUrl: string;
};

export type TicketsEmailContent = {
  subject: string;
  html: string;
  text: string;
};

const BRAND_BLUE = "#4080FC";

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

function ticketBlock(
  ticket: TicketsEmailTicket,
  index: number,
  total: number,
  data: TicketsEmailData,
  when: string,
) {
  const title = total > 1 ? `Ingresso ${index + 1} de ${total}` : "Seu ingresso";
  const session = data.sessionName
    ? `<p style="margin:0 0 2px;font-size:15px;font-weight:bold;color:#111111;">${escapeHtml(data.sessionName)}</p>`
    : "";
  const whenLine = when
    ? `<p style="margin:0;font-size:14px;line-height:20px;color:#111111;">${escapeHtml(when)}</p>`
    : "";
  return `<tr>
              <td align="center" style="padding:12px 24px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e4e4e7;border-radius:12px;">
                  <tr>
                    <td align="center" style="padding:20px 16px;">
                      <p style="margin:0 0 4px;font-size:12px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;color:#888888;">${title}</p>
                      <p style="margin:0 0 12px;font-size:14px;color:#555555;">${escapeHtml(data.eventName)}</p>
                      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 12px;background:#f4f5f7;border-radius:8px;">
                        <tr>
                          <td align="center" style="padding:10px 12px;">${session}${whenLine}<p style="margin:2px 0 0;font-size:13px;color:#555555;">${escapeHtml(data.venue)}</p></td>
                        </tr>
                      </table>
                      <p style="margin:0 0 12px;font-size:16px;font-weight:bold;color:#111111;">${escapeHtml(ticket.holderName)} · ${escapeHtml(ticket.kindLabel)}</p>
                      <img src="cid:${escapeHtml(ticket.qrContentId)}" width="220" height="220" alt="QR Code do ingresso" style="display:block;width:220px;height:220px;border:0;">
                      <p style="margin:12px 0 4px;font-size:12px;color:#888888;">Código para digitação manual</p>
                      <p style="margin:0;font-family:'Courier New',monospace;font-size:12px;color:#333333;word-break:break-all;">${escapeHtml(ticket.code)}</p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>`;
}

export function buildTicketsEmail(data: TicketsEmailData): TicketsEmailContent {
  const name = firstName(data.buyerName);
  const when = formatSessionWhen(data.startsAt, data.endsAt);
  const subjectWhen = formatSessionSubject(data.startsAt);
  const total = data.tickets.length;
  const count = total === 1 ? "1 ingresso" : `${total} ingressos`;

  const subject = subjectWhen
    ? `Seus ingressos — ${data.eventName} · ${subjectWhen}`
    : `Seus ingressos — ${data.eventName}`;

  const details = [
    `<strong>Pedido nº</strong> ${escapeHtml(data.orderNumber)}`,
    data.sessionName ? `<strong>Sessão:</strong> ${escapeHtml(data.sessionName)}` : "",
    when ? `<strong>Quando:</strong> ${escapeHtml(when)}` : "",
    `<strong>Onde:</strong> ${escapeHtml(data.venue)}`,
    `<strong>Quantidade:</strong> ${count}`,
  ]
    .filter(Boolean)
    .map(
      (line) =>
        `<p style="margin:0 0 8px;font-size:15px;line-height:22px;color:#333333;">${line}</p>`,
    )
    .join("");

  const tickets = data.tickets
    .map((ticket, index) => ticketBlock(ticket, index, total, data, when))
    .join("");

  const html = `<!doctype html>
<html lang="pt-BR">
  <body style="margin:0;padding:0;background:#f4f5f7;font-family:Arial,Helvetica,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:24px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:12px;overflow:hidden;">
            <tr>
              <td style="background:#111111;padding:20px 24px;color:#ffffff;font-size:18px;font-weight:bold;">Espaço Byla Eventos</td>
            </tr>
            <tr>
              <td style="padding:28px 24px 8px;">
                <h1 style="margin:0 0 12px;font-size:22px;line-height:28px;color:#111111;">Pagamento confirmado!</h1>
                <p style="margin:0 0 20px;font-size:15px;line-height:22px;color:#333333;">Olá, ${escapeHtml(name)}! Seus ingressos para <strong>${escapeHtml(data.eventName)}</strong> estão garantidos.</p>
                ${details}
                <p style="margin:16px 0 0;font-size:14px;line-height:20px;color:#555555;">Na entrada, mostre o QR Code de cada ingresso. Cada um vale para uma pessoa e só pode ser usado uma vez.</p>
              </td>
            </tr>
            ${tickets}
            <tr>
              <td align="center" style="padding:20px 24px 8px;">
                <a href="${escapeHtml(data.ticketUrl)}" style="display:inline-block;background:${BRAND_BLUE};color:#ffffff;text-decoration:none;font-size:16px;font-weight:bold;padding:14px 28px;border-radius:8px;">Ver meus ingressos</a>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 24px 28px;">
                <p style="margin:0;font-size:13px;line-height:18px;color:#888888;">Guarde este e-mail. Se o QR Code não aparecer, use o botão acima ou copie este endereço no navegador:<br><a href="${escapeHtml(data.ticketUrl)}" style="color:${BRAND_BLUE};word-break:break-all;">${escapeHtml(data.ticketUrl)}</a></p>
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
    `Pagamento confirmado. Seus ingressos para ${data.eventName} estão garantidos.`,
    "",
    `Pedido nº ${data.orderNumber}`,
    ...(data.sessionName ? [`Sessão: ${data.sessionName}`] : []),
    ...(when ? [`Quando: ${when}`] : []),
    `Onde: ${data.venue}`,
    `Quantidade: ${count}`,
    "",
    ...data.tickets.map(
      (ticket, index) =>
        `Ingresso ${index + 1} de ${total}: ${ticket.holderName} (${ticket.kindLabel}) — código ${ticket.code}`,
    ),
    "",
    `Ver meus ingressos (com QR Code): ${data.ticketUrl}`,
    "",
    "Na entrada, mostre o QR Code de cada ingresso. Cada um vale para uma pessoa e só pode ser usado uma vez.",
    "",
    "Espaço Byla Eventos",
  ]
    .filter((line, index, lines) => line !== "" || lines[index - 1] !== "")
    .join("\n");

  return { subject, html, text };
}
