import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PagBankPaymentProvider } from "@/lib/payments/pagbank";

const fixture = readFileSync(
  join(process.cwd(), "tests/payments/fixtures/pagbank-paid.json"),
  "utf8",
);

describe("PagBankPaymentProvider.parseWebhook", () => {
  it("interpreta um pagamento PIX confirmado e assinado", async () => {
    const token = "token-ficticio-de-teste";
    const signature = createHash("sha256")
      .update(`${token}-${fixture}`)
      .digest("hex");
    const provider = new PagBankPaymentProvider({ token });
    const request = new Request("https://eventos.example/api/payments/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-authenticity-token": signature,
      },
      body: fixture,
    });

    await expect(provider.parseWebhook(request)).resolves.toEqual({
      kind: "paid",
      externalId: "00000000-0000-4000-8000-000000000001",
    });
  });

  it("ignora payload com assinatura inválida", async () => {
    const provider = new PagBankPaymentProvider({
      token: "token-ficticio-de-teste",
    });
    const request = new Request("https://eventos.example/api/payments/webhook", {
      method: "POST",
      headers: { "x-authenticity-token": "assinatura-invalida" },
      body: fixture,
    });

    await expect(provider.parseWebhook(request)).resolves.toEqual({
      kind: "ignored",
    });
  });
});
