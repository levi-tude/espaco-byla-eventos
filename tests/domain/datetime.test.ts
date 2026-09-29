import { describe, expect, it } from "vitest";
import {
  eventDateFormatter,
  parseEventInputValue,
  toEventInputValue,
} from "@/lib/datetime";

describe("horário dos eventos (Brasília)", () => {
  it("interpreta o valor do formulário como horário de Brasília", () => {
    expect(parseEventInputValue("2026-09-18T16:57").toISOString()).toBe(
      "2026-09-18T19:57:00.000Z",
    );
  });

  it("mantém datas que já têm fuso", () => {
    expect(
      parseEventInputValue("2026-09-18T19:57:00.000Z").toISOString(),
    ).toBe("2026-09-18T19:57:00.000Z");
  });

  it("preenche o formulário no horário de Brasília", () => {
    expect(toEventInputValue("2026-09-18T19:57:00+00:00")).toBe(
      "2026-09-18T16:57",
    );
    expect(toEventInputValue("2026-09-19T01:30:00Z")).toBe("2026-09-18T22:30");
    expect(toEventInputValue(null)).toBe("");
  });

  it("exibe no horário de Brasília independente do fuso do servidor", () => {
    const text = eventDateFormatter({ timeStyle: "short" }).format(
      new Date("2026-09-18T19:57:00Z"),
    );
    expect(text).toBe("16:57");
  });
});
