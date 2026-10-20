import { isPastEventDay } from "@/lib/domain/past-events";

export const SHARE_PENDING_MESSAGE =
  "O link fica disponível quando a ACDH Eventos aprovar o evento.";

export const SHARE_REJECTED_MESSAGE =
  "Este evento foi recusado. Ajuste o que foi pedido e envie de novo para o link ficar disponível.";

export type EventShareModel =
  | { kind: "hidden" }
  | { kind: "pending"; message: string }
  | { kind: "rejected"; message: string }
  | {
      kind: "link";
      emphasis: "normal" | "quiet";
      url: string;
      whatsappUrl: string;
      eventName: string;
      whenLabel: string;
    };

export function publicAppBaseUrl(): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();
  return (configured && configured.length > 0 ? configured : "http://localhost:3000").replace(/\/$/, "");
}

export function publicEventUrl(appUrl: string, slug: string): string {
  return `${appUrl.replace(/\/$/, "")}/eventos/${slug}`;
}

/** Texto do WhatsApp: nome, data e URL, cada um numa linha. */
export function eventWhatsappText(name: string, whenLabel: string, url: string): string {
  return [name.trim(), whenLabel.trim(), url.trim()].filter((line) => line.length > 0).join("\n");
}

export function whatsappShareUrl(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

/**
 * Link público do evento.
 * À venda e com vendas pausadas: destaque normal. Encerrado: tom mais baixo.
 * Rascunho e em análise ainda não têm página pública. Recusado pede ajuste.
 */
export function eventShareModel(input: {
  name: string;
  slug: string;
  whenLabel: string;
  approvalStatus: string;
  organizerId: string | null;
  deletedAt: string | null;
  lastSessionAt: string | null;
  appUrl: string;
  now?: Date;
}): EventShareModel {
  if (input.deletedAt) return { kind: "hidden" };
  if (input.organizerId) {
    if (input.approvalStatus === "rascunho" || input.approvalStatus === "em_analise") {
      return { kind: "pending", message: SHARE_PENDING_MESSAGE };
    }
    if (input.approvalStatus === "recusado") {
      return { kind: "rejected", message: SHARE_REJECTED_MESSAGE };
    }
    if (input.approvalStatus !== "aprovado") {
      return { kind: "pending", message: SHARE_PENDING_MESSAGE };
    }
  }

  const url = publicEventUrl(input.appUrl, input.slug);
  const text = eventWhatsappText(input.name, input.whenLabel, url);
  return {
    kind: "link",
    emphasis: isPastEventDay(input.lastSessionAt, input.now) ? "quiet" : "normal",
    url,
    whatsappUrl: whatsappShareUrl(text),
    eventName: input.name,
    whenLabel: input.whenLabel.trim(),
  };
}
