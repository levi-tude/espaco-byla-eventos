import { eventDateFormatter } from "@/lib/datetime";

export type ReminderEmailData = {
  buyerName: string;
  eventName: string;
  venue: string;
  startsAt: string;
  items: { name: string; quantity: number }[];
  resumeUrl: string;
  unsubscribeUrl: string;
};

export type ReminderEmailContent = {
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
  return eventDateFormatter({ dateStyle: "full", timeStyle: "short" }).format(date);
}

/** Texto ao comprador: sem dados de pagamento e sem citar fornecedores. */
export function buildReminderEmail(data: ReminderEmailData): ReminderEmailContent {
  const name = firstName(data.buyerName);
  const when = formatStartsAt(data.startsAt);
  const items = data.items.map((item) => `${item.quantity} × ${item.name}`);

  const subject = `Você não terminou sua compra para ${data.eventName}`;

  const paragraph = (content: string) =>
    `<p style="margin:0 0 12px;font-size:15px;line-height:22px;color:#333333;">${content}</p>`;

  const details = [
    when ? `<strong>Quando:</strong> ${escapeHtml(when)}` : "",
    `<strong>Onde:</strong> ${escapeHtml(data.venue)}`,
  ]
    .filter(Boolean)
    .map(paragraph)
    .join("");

  const itemList = items.length
    ? `${paragraph("<strong>Sua seleção:</strong>")}
                <ul style="margin:0 0 16px;padding-left:20px;font-size:15px;line-height:22px;color:#333333;">${items
                  .map((item) => `<li style="margin:0 0 4px;">${escapeHtml(item)}</li>`)
                  .join("")}</ul>`
    : "";

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
                <h1 style="margin:0 0 12px;font-size:22px;line-height:28px;color:#111111;">Você não terminou sua compra</h1>
                ${paragraph(`Olá, ${escapeHtml(name)}! Você começou a comprar ingressos para <strong>${escapeHtml(data.eventName)}</strong>, mas o pagamento não foi concluído.`)}
                ${details}
                ${itemList}
                ${paragraph("Se ainda quiser ir, é só continuar: sua seleção e seus dados já vêm preenchidos. Os lugares não ficam guardados, então a disponibilidade é conferida na hora.")}
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:12px 24px 8px;">
                <a href="${escapeHtml(data.resumeUrl)}" style="display:inline-block;background:${BRAND_BLUE};color:#ffffff;text-decoration:none;font-size:16px;font-weight:bold;padding:14px 28px;border-radius:8px;">Continuar compra</a>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 24px 28px;">
                <p style="margin:0 0 12px;font-size:13px;line-height:18px;color:#888888;">Se o botão não funcionar, copie este endereço no navegador:<br><a href="${escapeHtml(data.resumeUrl)}" style="color:${BRAND_BLUE};word-break:break-all;">${escapeHtml(data.resumeUrl)}</a></p>
                <p style="margin:0;font-size:13px;line-height:18px;color:#888888;">Você recebeu este aviso porque iniciou uma compra no site do Espaço Byla. Enviamos só um lembrete por compra. <a href="${escapeHtml(data.unsubscribeUrl)}" style="color:#888888;text-decoration:underline;">Não quero receber lembretes</a></p>
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
    `Você começou a comprar ingressos para ${data.eventName}, mas o pagamento não foi concluído.`,
    "",
    when ? `Quando: ${when}` : "",
    `Onde: ${data.venue}`,
    "",
    ...(items.length ? ["Sua seleção:", ...items.map((item) => `- ${item}`), ""] : []),
    "Se ainda quiser ir, é só continuar: sua seleção e seus dados já vêm preenchidos. Os lugares não ficam guardados, então a disponibilidade é conferida na hora.",
    "",
    `Continuar compra: ${data.resumeUrl}`,
    "",
    "Você recebeu este aviso porque iniciou uma compra no site do Espaço Byla. Enviamos só um lembrete por compra.",
    `Não quero receber lembretes: ${data.unsubscribeUrl}`,
    "",
    "Espaço Byla",
  ]
    .filter((line, index, lines) => line !== "" || lines[index - 1] !== "")
    .join("\n");

  return { subject, html, text };
}
