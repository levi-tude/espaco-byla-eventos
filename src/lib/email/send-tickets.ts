import "server-only";

import { buildTicketsEmail } from "@/lib/email/tickets-template";

export type SendTicketsEmailInput = {
  buyerEmail: string;
  buyerName: string;
  eventName: string;
  venue: string;
  startsAt: string;
  ticketCount: number;
  publicToken: string;
};

export type SendTicketsEmailResult = "sent" | "skipped" | "failed";

export async function sendTicketsEmail({
  buyerEmail,
  publicToken,
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
  const { subject, html, text } = buildTicketsEmail({ ...details, ticketUrl });

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to: [buyerEmail], subject, html, text }),
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
