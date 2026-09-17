import "server-only";

export type SendTicketsEmailInput = {
  buyerEmail: string;
  buyerName: string;
  eventName: string;
  publicToken: string;
};

export type SendTicketsEmailResult = "sent" | "skipped" | "failed";

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export async function sendTicketsEmail({
  buyerEmail,
  buyerName,
  eventName,
  publicToken,
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
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [buyerEmail],
        subject: `Seus ingressos — ${eventName}`,
        html: `
          <h1>Seus ingressos estão disponíveis</h1>
          <p>Olá, ${escapeHtml(buyerName)}!</p>
          <p>O pagamento para <strong>${escapeHtml(eventName)}</strong> foi confirmado.</p>
          <p><a href="${escapeHtml(ticketUrl)}">Abrir meus ingressos</a></p>
          <p>Apresente o QR Code na entrada do evento.</p>
        `,
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
