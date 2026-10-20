import { formatMoney } from "@/lib/domain/service-fee";
import { formatWaitUntil } from "@/lib/organizer/finance";

export const ORGANIZER_NOTICE_KINDS = [
  "equipe_pedido_site",
  "equipe_evento_enviado",
  "equipe_pedido_organizador",
  "org_evento_aprovado",
  "org_evento_recusado",
  "org_pedido_respondido",
  "org_conta_suspensa",
  "org_repasse_registrado",
  "org_pix_troca_pedida",
  "org_pix_troca_confirmada",
  "org_pix_troca_recusada",
  "equipe_pix_troca_pedida",
  "org_devolucao_pendente",
  "equipe_repasses_resumo",
  "org_pedido_estornado",
] as const;

export type OrganizerNoticeKind = (typeof ORGANIZER_NOTICE_KINDS)[number];
export type TeamNoticeKind = Extract<OrganizerNoticeKind, `equipe_${string}`>;
export type OrganizerOnlyNoticeKind = Extract<OrganizerNoticeKind, `org_${string}`>;

export type OrganizerRequestKind = "estorno" | "exclusao" | "mudanca";

/** Nunca leva nome ou e-mail de comprador, chave PIX ou token (spec 14). */
export type OrganizerNoticeData = {
  eventName?: string;
  note?: string;
  requestKind?: OrganizerRequestKind;
  outcome?: "atendido" | "recusado";
  count?: number;
  amountCents?: number;
  /** "AAAA-MM-DD" */
  day?: string;
  /** Nome público do organizador (avisos à equipe). */
  organizerName?: string;
  /** ISO: quando a troca de chave PIX pode ser confirmada. */
  confirmAfter?: string;
  /** Número curto do pedido ("1234"), sem dado do comprador. */
  orderNumber?: string;
  /** Chave PIX da ACDH Eventos para receber devoluções (não é dado de organizador). */
  espacoPixKey?: string;
  /** Resumo diário da equipe: só contagens e somas. */
  summary?: {
    latePayouts: number;
    latePayoutsCents: number;
    lateRefunds: number;
    feesPending: number;
    /** Ano seguinte sem feriados cadastrados (a partir de 1º/11). */
    calendarMissingYear: number | null;
  };
  link: string;
};

export type OrganizerNoticeContent = {
  subject: string;
  html: string;
  text: string;
};

const BRAND_BLUE = "#4080FC";
const MAX_EVENT_NAME = 160;
const MAX_NOTE = 1000;

const REQUEST_LABEL: Record<OrganizerRequestKind, string> = {
  estorno: "Estorno",
  exclusao: "Exclusão",
  mudanca: "Mudança",
};

const REQUEST_ACTION: Record<OrganizerRequestKind, string> = {
  estorno: "pediu o estorno de um pedido do evento",
  exclusao: "pediu a exclusão do evento",
  mudanca: "pediu uma mudança no evento",
};

const REQUEST_NAME: Record<OrganizerRequestKind, string> = {
  estorno: "pedido de estorno",
  exclusao: "pedido de exclusão",
  mudanca: "pedido de mudança",
};

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/** Uma linha só: o nome entra no assunto, onde quebra de linha não pode passar. */
function singleLine(value: string | undefined, max: number): string {
  return (value ?? "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function cleanNote(value: string | undefined): string {
  return (value ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f]+/g, " ")
    .trim()
    .slice(0, MAX_NOTE);
}

function safeLink(value: string): string | null {
  return /^https?:\/\/[^\s"'<>]+$/.test(value) ? value : null;
}

type Part = string | { strong: string };
type Paragraph = Part[];

function paragraphHtml(parts: Paragraph): string {
  const content = parts
    .map((part) =>
      typeof part === "string"
        ? escapeHtml(part).replaceAll("\n", "<br>")
        : `<strong>${escapeHtml(part.strong)}</strong>`,
    )
    .join("");
  return `<p style="margin:0 0 12px;font-size:15px;line-height:22px;color:#333333;">${content}</p>`;
}

function paragraphText(parts: Paragraph): string {
  return parts.map((part) => (typeof part === "string" ? part : part.strong)).join("");
}

type NoticeBody = {
  subject: string;
  title: string;
  paragraphs: Paragraph[];
  buttonLabel: string;
  footer: string;
};

const TEAM_FOOTER = "Aviso automático da área do organizador da ACDH Eventos.";
const ORGANIZER_FOOTER = "Se tiver dúvidas, fale com a equipe da ACDH Eventos.";

function noticeBody(kind: OrganizerNoticeKind, data: OrganizerNoticeData): NoticeBody {
  const eventName = singleLine(data.eventName, MAX_EVENT_NAME) || "evento sem nome";
  const event = { strong: eventName };
  const note = cleanNote(data.note);
  const requestKind = data.requestKind && REQUEST_LABEL[data.requestKind] ? data.requestKind : null;

  switch (kind) {
    case "equipe_pedido_site": {
      const count = Number.isInteger(data.count) && (data.count ?? 0) > 0 ? (data.count as number) : null;
      const first =
        count === null
          ? "Chegou um pedido novo em “Quero fazer meu evento”."
          : count === 1
            ? "Chegou 1 pedido novo em “Quero fazer meu evento” esperando resposta."
            : `Chegaram ${count} pedidos novos em “Quero fazer meu evento” esperando resposta.`;
      return {
        subject: "Novo pedido para fazer evento",
        title: "Novo pedido para fazer evento",
        paragraphs: [[first], ["Veja os dados e responda pelo contato que a pessoa deixou."]],
        buttonLabel: "Ver pedidos",
        footer: TEAM_FOOTER,
      };
    }
    case "equipe_evento_enviado":
      return {
        subject: `Evento para aprovar: ${eventName}`,
        title: "Evento para aprovar",
        paragraphs: [
          ["O organizador enviou o evento ", event, " para aprovação."],
          ["Confira os dados e aprove ou peça ajustes."],
        ],
        buttonLabel: "Ver aprovações",
        footer: TEAM_FOOTER,
      };
    case "equipe_pedido_organizador":
      return {
        subject: requestKind
          ? `Pedido do organizador: ${REQUEST_LABEL[requestKind]} — ${eventName}`
          : `Pedido do organizador — ${eventName}`,
        title: "Pedido do organizador",
        paragraphs: [
          requestKind
            ? ["O organizador ", REQUEST_ACTION[requestKind], " ", event, "."]
            : ["O organizador fez um pedido sobre o evento ", event, "."],
          ...(note ? [[`Motivo: ${note}`]] : []),
          ["Confira e responda pela área da equipe."],
        ],
        buttonLabel: "Ver pedido",
        footer: TEAM_FOOTER,
      };
    case "org_evento_aprovado":
      return {
        subject: "Seu evento foi aprovado",
        title: "Seu evento foi aprovado",
        paragraphs: [
          ["A equipe da ACDH Eventos aprovou o evento ", event, "."],
          ["Confira na sua área se as vendas já estão abertas. Se ainda não estiverem, você pode abrir quando quiser."],
        ],
        buttonLabel: "Ver meu evento",
        footer: ORGANIZER_FOOTER,
      };
    case "org_evento_recusado":
      return {
        subject: "Seu evento precisa de ajustes",
        title: "Seu evento precisa de ajustes",
        paragraphs: [
          ["A equipe da ACDH Eventos revisou o evento ", event, " e pediu alguns ajustes antes de aprovar."],
          ...(note ? [[`O que ajustar: ${note}`]] : []),
          ["Faça os ajustes e envie de novo para aprovação."],
        ],
        buttonLabel: "Ver meu evento",
        footer: ORGANIZER_FOOTER,
      };
    case "org_pedido_respondido": {
      const what = requestKind ? `Seu ${REQUEST_NAME[requestKind]}` : "Seu pedido";
      const result =
        data.outcome === "atendido" ? "foi atendido" : data.outcome === "recusado" ? "foi recusado" : "foi respondido";
      return {
        subject: "Resposta ao seu pedido",
        title: "Resposta ao seu pedido",
        paragraphs: [
          [`${what} no evento `, event, ` ${result}.`],
          ...(note ? [[`Resposta da equipe: ${note}`]] : []),
        ],
        buttonLabel: "Ver meu evento",
        footer: ORGANIZER_FOOTER,
      };
    }
    case "org_conta_suspensa":
      return {
        subject: "Sua conta foi suspensa",
        title: "Sua conta foi suspensa",
        paragraphs: [
          ["Sua conta de organizador na ACDH Eventos foi suspensa e o acesso à área do organizador está bloqueado."],
          ...(note ? [[`Motivo: ${note}`]] : []),
        ],
        buttonLabel: "Abrir o site",
        footer: ORGANIZER_FOOTER,
      };
    case "org_repasse_registrado": {
      const amount =
        Number.isSafeInteger(data.amountCents) && (data.amountCents as number) > 0
          ? formatMoney(data.amountCents as number)
          : null;
      const day = data.day && /^\d{4}-\d{2}-\d{2}$/.test(data.day) ? data.day.split("-").reverse().join("/") : null;
      return {
        subject: "Repasse registrado",
        title: "Repasse registrado",
        paragraphs: [
          amount
            ? ["A ACDH Eventos registrou o repasse de ", { strong: amount }, " do evento ", event, day ? ` (PIX de ${day}).` : "."]
            : ["A ACDH Eventos registrou o acerto do evento ", event, " (descontado de valores a devolver, sem PIX)."],
          ["Os detalhes estão na aba Financeiro do evento, na sua área."],
        ],
        buttonLabel: "Ver financeiro",
        footer: ORGANIZER_FOOTER,
      };
    }
    case "org_pix_troca_pedida":
      return {
        subject: "Pedido de troca da chave PIX",
        title: "Pedido de troca da chave PIX",
        paragraphs: [
          ["Recebemos um pedido para trocar a chave PIX dos seus repasses."],
          ["Se não foi você, cancele na sua conta e avise a ACDH Eventos."],
          ["Até a confirmação do Espaço, os repasses continuam na chave atual."],
        ],
        buttonLabel: "Ver minha conta",
        footer: ORGANIZER_FOOTER,
      };
    case "org_pix_troca_confirmada":
      return {
        subject: "Chave PIX trocada",
        title: "Chave PIX trocada",
        paragraphs: [["A ACDH Eventos confirmou a troca: os próximos repasses vão para a chave nova."]],
        buttonLabel: "Ver minha conta",
        footer: ORGANIZER_FOOTER,
      };
    case "org_pix_troca_recusada":
      return {
        subject: "Troca da chave PIX recusada",
        title: "Troca da chave PIX recusada",
        paragraphs: [
          ["A ACDH Eventos não confirmou a troca da chave PIX. Os repasses continuam na chave atual."],
          ...(note ? [[`Motivo: ${note}`]] : []),
        ],
        buttonLabel: "Ver minha conta",
        footer: ORGANIZER_FOOTER,
      };
    case "equipe_pix_troca_pedida": {
      const organizer = singleLine(data.organizerName, MAX_EVENT_NAME) || "um organizador";
      const when = data.confirmAfter ? formatWaitUntil(data.confirmAfter) : null;
      return {
        subject: `Troca de chave PIX pedida: ${organizer}`,
        title: "Troca de chave PIX pedida",
        paragraphs: [
          ["Troca de chave PIX pedida por ", { strong: organizer }, when ? `; pode ser confirmada a partir de ${when}.` : "."],
          ["Confira o titular e decida em Organizadores, na área da equipe."],
        ],
        buttonLabel: "Ver e decidir",
        footer: TEAM_FOOTER,
      };
    }
    case "org_devolucao_pendente": {
      const amount =
        Number.isSafeInteger(data.amountCents) && (data.amountCents as number) > 0
          ? formatMoney(data.amountCents as number)
          : "o valor indicado na sua área";
      const day = data.day && /^\d{4}-\d{2}-\d{2}$/.test(data.day) ? data.day.slice(5).split("-").reverse().join("/") : null;
      const key = singleLine(data.espacoPixKey, 77);
      return {
        subject: "Devolução à ACDH Eventos",
        title: "Devolução à ACDH Eventos",
        paragraphs: [
          ["Estornos ou contestações do evento ", event, " depois do repasse deixaram um valor a devolver."],
          [`Devolva ${amount} por PIX à ACDH Eventos${day ? ` até ${day}` : ""}.`],
          key ? ["Chave PIX da ACDH Eventos: ", { strong: key }] : ["A ACDH Eventos vai te mandar a chave PIX para a devolução."],
          ["Enquanto a devolução estiver atrasada, não dá para enviar novos eventos para aprovação."],
        ],
        buttonLabel: "Ver financeiro",
        footer: ORGANIZER_FOOTER,
      };
    }
    case "org_pedido_estornado": {
      const number = singleLine(data.orderNumber, 20);
      return {
        subject: "Pedido estornado no seu evento",
        title: "Pedido estornado",
        paragraphs: [
          [number ? `O pedido Nº ${number} do evento ` : "Um pedido do evento ", event, " foi estornado."],
          ["Se o repasse já foi feito, o valor será descontado do próximo."],
        ],
        buttonLabel: "Ver financeiro",
        footer: ORGANIZER_FOOTER,
      };
    }
    case "equipe_repasses_resumo": {
      const s = data.summary;
      const lines: Paragraph[] = [];
      if (s && s.latePayouts > 0) {
        lines.push([
          `${s.latePayouts} ${s.latePayouts === 1 ? "repasse atrasado" : "repasses atrasados"} (${formatMoney(s.latePayoutsCents)})`,
        ]);
      }
      if (s && s.lateRefunds > 0) {
        lines.push([`${s.lateRefunds} ${s.lateRefunds === 1 ? "devolução atrasada" : "devoluções atrasadas"}`]);
      }
      if (s && s.feesPending > 0) {
        lines.push([`${s.feesPending} ${s.feesPending === 1 ? "tarifa a conferir" : "tarifas a conferir"} há mais de 2 dias`]);
      }
      if (s?.calendarMissingYear) {
        lines.push([`Feriados de ${s.calendarMissingYear} ainda não cadastrados: peça ao desenvolvedor.`]);
      }
      return {
        subject: "Repasses: pendências de hoje",
        title: "Repasses: pendências de hoje",
        paragraphs: [...lines, ["Confira na página Repasses, na área da equipe."]],
        buttonLabel: "Ver repasses",
        footer: TEAM_FOOTER,
      };
    }
  }
}

function layout(body: NoticeBody, link: string | null): string {
  const button = link
    ? `<tr>
              <td align="center" style="padding:12px 24px 8px;">
                <a href="${escapeHtml(link)}" style="display:inline-block;background:${BRAND_BLUE};color:#ffffff;text-decoration:none;font-size:16px;font-weight:bold;padding:14px 28px;border-radius:8px;">${escapeHtml(body.buttonLabel)}</a>
              </td>
            </tr>`
    : "";
  return `<!doctype html>
<html lang="pt-BR">
  <body style="margin:0;padding:0;background:#f4f5f7;font-family:Arial,Helvetica,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:24px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:12px;overflow:hidden;">
            <tr>
              <td style="background:#111111;padding:20px 24px;color:#ffffff;font-size:18px;font-weight:bold;">ACDH Eventos</td>
            </tr>
            <tr>
              <td style="padding:28px 24px 8px;">
                <h1 style="margin:0 0 12px;font-size:22px;line-height:28px;color:#111111;">${escapeHtml(body.title)}</h1>
                ${body.paragraphs.map(paragraphHtml).join("\n                ")}
              </td>
            </tr>
            ${button}
            <tr>
              <td style="padding:16px 24px 28px;">
                <p style="margin:0;font-size:13px;line-height:18px;color:#888888;">${escapeHtml(body.footer)}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

/** Avisos da área do organizador (spec 14), para a equipe ou para o organizador. */
export function buildOrganizerNotice(kind: OrganizerNoticeKind, data: OrganizerNoticeData): OrganizerNoticeContent {
  const body = noticeBody(kind, data);
  const link = safeLink(data.link);
  const text = [
    body.title,
    "",
    ...body.paragraphs.map(paragraphText),
    ...(link ? ["", `${body.buttonLabel}: ${link}`] : []),
    "",
    body.footer,
    "",
    "ACDH Eventos",
  ].join("\n");
  return { subject: body.subject, html: layout(body, link), text };
}
