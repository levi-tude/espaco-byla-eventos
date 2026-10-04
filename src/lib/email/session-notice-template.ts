import { formatSessionShort, formatSessionWhen } from "@/lib/datetime";
import { sessionName as cleanSessionName } from "@/lib/domain/sessions";

export type SessionNoticeEmailContent = {
  subject: string;
  html: string;
  text: string;
};

type CommonData = {
  buyerName: string;
  eventName: string;
  venue: string | null;
  sessionName?: string | null;
  orderUrl: string;
  /** Há e-mail de contato para respostas (`reply_to`): só então o texto convida a responder. */
  replyAvailable: boolean;
};

export type ScheduleChangeEmailData = CommonData & {
  previousStartsAt: string;
  newStartsAt: string;
  newEndsAt?: string | null;
};

export type SessionCancelledEmailData = CommonData & {
  startsAt: string;
  endsAt?: string | null;
  reason: string | null;
  /** Cortesia: não há valor a devolver, então o e-mail não fala de devolução. */
  isCourtesy: boolean;
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

function formatSession(startsAt: string, endsAt?: string | null, name?: string | null) {
  return [cleanSessionName(name), formatSessionWhen(startsAt, endsAt)].filter(Boolean).join(" · ");
}

function contactLine(replyAvailable: boolean) {
  return replyAvailable
    ? "Em caso de dúvidas, responda este e-mail."
    : "Se tiver dúvidas, fale com a equipe do Espaço Byla.";
}

const paragraph = (content: string) =>
  `<p style="margin:0 0 12px;font-size:15px;line-height:22px;color:#333333;">${content}</p>`;

function layout(input: { title: string; body: string; buttonLabel: string; buttonUrl: string; footer: string }) {
  return `<!doctype html>
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
                <h1 style="margin:0 0 12px;font-size:22px;line-height:28px;color:#111111;">${escapeHtml(input.title)}</h1>
                ${input.body}
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:12px 24px 8px;">
                <a href="${escapeHtml(input.buttonUrl)}" style="display:inline-block;background:${BRAND_BLUE};color:#ffffff;text-decoration:none;font-size:16px;font-weight:bold;padding:14px 28px;border-radius:8px;">${escapeHtml(input.buttonLabel)}</a>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 24px 28px;">
                <p style="margin:0;font-size:13px;line-height:18px;color:#888888;">${escapeHtml(input.footer)}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

/** E-mail de mudança de horário. Texto neutro: não promete reembolso (decisão 14 da spec, adiada). */
export function buildScheduleChangeEmail(data: ScheduleChangeEmailData): SessionNoticeEmailContent {
  const name = firstName(data.buyerName);
  const newWhen = formatSession(data.newStartsAt, data.newEndsAt, data.sessionName);
  const before = formatSessionShort(data.previousStartsAt);
  const footer = contactLine(data.replyAvailable);
  const subject = `Mudança de horário — ${data.eventName}`;

  const body = [
    paragraph(`Olá, ${escapeHtml(name)}! O horário da sua sessão de <strong>${escapeHtml(data.eventName)}</strong> mudou.`),
    `<div style="margin:0 0 12px;padding:14px 16px;border-radius:8px;background:#eef3ff;border:1px solid #c9d8ff;">
                  <p style="margin:0 0 4px;font-size:13px;line-height:18px;color:#555555;">Novo horário</p>
                  <p style="margin:0;font-size:17px;line-height:24px;font-weight:bold;color:#111111;">${escapeHtml(newWhen)}</p>
                </div>`,
    paragraph(`Antes: <s style="color:#888888;">${escapeHtml(before)}</s>`),
    data.venue ? paragraph(`<strong>Local:</strong> ${escapeHtml(data.venue)}`) : "",
    paragraph("<strong>Seus ingressos continuam valendo.</strong> Não precisa fazer nada."),
  ].join("\n                ");

  const html = layout({ title: "O horário da sua sessão mudou", body, buttonLabel: "Ver meus ingressos", buttonUrl: data.orderUrl, footer });

  const text = [
    `Olá, ${name}!`,
    "",
    `O horário da sua sessão de ${data.eventName} mudou.`,
    `Novo horário: ${newWhen}`,
    `Antes: ${before}`,
    ...(data.venue ? [`Local: ${data.venue}`] : []),
    "",
    "Seus ingressos continuam valendo. Não precisa fazer nada.",
    `Ver meus ingressos: ${data.orderUrl}`,
    "",
    footer,
    "",
    "Espaço Byla",
  ].join("\n");

  return { subject, html, text };
}

/** E-mail de cancelamento da sessão, enviado na hora do cancelamento (decisão 13 da spec). */
export function buildSessionCancelledEmail(data: SessionCancelledEmailData): SessionNoticeEmailContent {
  const name = firstName(data.buyerName);
  const when = formatSession(data.startsAt, data.endsAt, data.sessionName);
  const footer = contactLine(data.replyAvailable);
  const reason = data.reason?.trim() || null;
  const subject = `Sessão cancelada — ${data.eventName}`;
  const refundLine =
    "O valor pago será devolvido integralmente e você receberá outro e-mail quando a devolução for feita.";

  const body = [
    paragraph(`Olá, ${escapeHtml(name)}! A sessão de <strong>${escapeHtml(data.eventName)}</strong> (${escapeHtml(when)}) foi cancelada.`),
    reason ? paragraph(`<strong>Motivo:</strong> ${escapeHtml(reason)}`) : "",
    paragraph("Seus ingressos <strong>não valem mais para entrada</strong>."),
    data.isCourtesy ? "" : paragraph(refundLine),
  ]
    .filter(Boolean)
    .join("\n                ");

  const html = layout({ title: "Sessão cancelada", body, buttonLabel: "Ver pedido", buttonUrl: data.orderUrl, footer });

  const text = [
    `Olá, ${name}!`,
    "",
    `A sessão de ${data.eventName} (${when}) foi cancelada.`,
    ...(reason ? [`Motivo: ${reason}`] : []),
    "Seus ingressos não valem mais para entrada.",
    ...(data.isCourtesy ? [] : [refundLine]),
    "",
    `Ver pedido: ${data.orderUrl}`,
    "",
    footer,
    "",
    "Espaço Byla",
  ].join("\n");

  return { subject, html, text };
}
