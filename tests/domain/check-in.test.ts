import { describe, expect, it } from "vitest";
import { evaluateCheckIn } from "@/lib/domain/check-in";

describe("check-in", () => {
  it("libera ingresso pago do evento certo", () => {
    expect(
      evaluateCheckIn({
        ticketEventId: "e1",
        eventId: "e1",
        status: "pago",
      }),
    ).toEqual({ ok: true });
  });
  it("bloqueia já usado", () => {
    expect(
      evaluateCheckIn({
        ticketEventId: "e1",
        eventId: "e1",
        status: "check_in",
      }),
    ).toEqual({ ok: false, reason: "ja_usado" });
  });
});
