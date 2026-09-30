import { describe, expect, it } from "vitest";

import { ticketQrDataUrl, ticketQrPng } from "@/lib/tickets/qr";

describe("QR do ingresso", () => {
  it("gera a mesma imagem para a página e para o e-mail", async () => {
    const code = "abc-123";
    const dataUrl = await ticketQrDataUrl(code);
    const png = await ticketQrPng(code);

    expect(dataUrl).toBe(`data:image/png;base64,${png.toString("base64")}`);
  });
});
