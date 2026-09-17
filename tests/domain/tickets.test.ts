import { describe, expect, it } from "vitest";
import { createPublicToken, createTicketCode } from "@/lib/domain/tickets";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe("tickets", () => {
  it("createPublicToken e createTicketCode retornam UUID v4 não vazio", () => {
    const token = createPublicToken();
    const code = createTicketCode();

    expect(token.length).toBeGreaterThan(0);
    expect(code.length).toBeGreaterThan(0);
    expect(token).toMatch(UUID_V4);
    expect(code).toMatch(UUID_V4);
  });
});
