import { eventDateFormatter } from "@/lib/datetime";

export type TicketsEmailData = {
  buyerName: string;
  eventName: string;
  venue: string;
  startsAt: string;
  ticketCount: number;
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

function formatStartsAt(startsAt: string) {
  const date = new Date(startsAt);
  if (Number.isNaN(date.getTime())) return "";
  return eventDateFormatter({ dateStyle: "full", timeStyle: "short" }).format(
    date,
  );
}

export function buildTicketsEmail(data: TicketsEmailData): TicketsEmailContent {
  const name = firstName(data.buyerName);
  const when = formatStartsAt(data.startsAt);
  const count =
    data.ticketCount === 1 ? "1 ingresso" : `${data.ticketCount} ingressos`;

  const subject = `Seus ingressos — ${data.eventName}`;

  const details = [
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
                <h1 style="margin:0 0 12px;font-size:22px;line-height:28px;color:#111111;">Pagamento confirmado!</h1>
                <p style="margin:0 0 20px;font-size:15px;line-height:22px;color:#333333;">Olá, ${escapeHtml(name)}! Seus ingressos para <strong>${escapeHtml(data.eventName)}</strong> estão garantidos.</p>
                ${details}
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:20px 24px 8px;">
                <a href="${escapeHtml(data.ticketUrl)}" style="display:inline-block;background:${BRAND_BLUE};color:#ffffff;text-decoration:none;font-size:16px;font-weight:bold;padding:14px 28px;border-radius:8px;">Ver meus ingressos</a>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 24px 28px;">
                <p style="margin:0 0 8px;font-size:14px;line-height:20px;color:#555555;">Na entrada, abra este link no celular e mostre o QR Code de cada ingresso.</p>
                <p style="margin:0;font-size:13px;line-height:18px;color:#888888;">Guarde este e-mail. Se o botão não funcionar, copie este endereço no navegador:<br><a href="${escapeHtml(data.ticketUrl)}" style="color:${BRAND_BLUE};word-break:break-all;">${escapeHtml(data.ticketUrl)}</a></p>
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
    when ? `Quando: ${when}` : "",
    `Onde: ${data.venue}`,
    `Quantidade: ${count}`,
    "",
    `Ver meus ingressos: ${data.ticketUrl}`,
    "",
    "Na entrada, abra este link no celular e mostre o QR Code de cada ingresso.",
    "",
    "Espaço Byla",
  ]
    .filter((line, index, lines) => line !== "" || lines[index - 1] !== "")
    .join("\n");

  return { subject, html, text };
}
