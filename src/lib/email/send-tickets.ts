import "server-only";

import { ticketTypeLabel } from "@/lib/domain/ticket-types";
import { buildTicketsEmail } from "@/lib/email/tickets-template";
import { ticketQrPng } from "@/lib/tickets/qr";
import type { Enums } from "@/types/database";

export type SendTicketsEmailInput = {
  buyerEmail: string;
  buyerName: string;
  eventName: string;
  venue: string;
  startsAt: string;
  tickets: {
    code: string;
    holderName: string;
    kind: Enums<"ticket_kind">;
    typeName?: string | null;
  }[];
  publicToken: string;
};

export type SendTicketsEmailResult = "sent" | "skipped" | "failed";

export async function sendTicketsEmail({
  buyerEmail,
  publicToken,
  tickets,
  ...details
}: SendTicketsEmailInput): Promise<SendTicketsEmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");

  if (!apiKey || !from || !appUrl) {
    console.warn(
      "[email] Ingressos não enviados: configure RESEND_API_KEY, RESEND_FROM_EMAIL e NEXT_PUBLIC_APP_URL.",
    );
    return "skipped";
  }

  const ticketUrl = `${appUrl}/pedidos/${encodeURIComponent(publicToken)}`;

  try {
    const qrImages = await Promise.all(
      tickets.map((ticket) => ticketQrPng(ticket.code)),
    );
    const emailTickets = tickets.map((ticket, index) => ({
      holderName: ticket.holderName,
      kindLabel: ticketTypeLabel(ticket.typeName, ticket.kind),
      code: ticket.code,
      qrContentId: `ingresso-${index + 1}`,
    }));
    const { subject, html, text } = buildTicketsEmail({
      ...details,
      tickets: emailTickets,
      ticketUrl,
    });
    const attachments = emailTickets.map((ticket, index) => ({
      filename: `${ticket.qrContentId}.png`,
      content: qrImages[index].toString("base64"),
      content_type: "image/png",
      content_id: ticket.qrContentId,
    }));

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [buyerEmail],
        subject,
        html,
        text,
        attachments,
      }),
    });

    if (!response.ok) {
      console.error(
        `[email] Resend recusou o envio dos ingressos (${response.status}).`,
      );
      return "failed";
    }

    return "sent";
  } catch (error) {
    console.error("[email] Falha ao enviar os ingressos.", error);
    return "failed";
  }
}
