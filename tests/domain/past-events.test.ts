import { describe, expect, it } from "vitest";

import {
  isPastEventDay,
  nextPastLimit,
  parsePastLimit,
  pastEventDateLabel,
} from "@/lib/domain/past-events";

describe("pastEventDateLabel", () => {
  it("um dia", () => {
    expect(pastEventDateLabel(["2026-10-10T22:00:00Z"])).toBe("10 de outubro de 2026");
  });

  it("várias sessões no mesmo dia contam como um dia (horário de Brasília)", () => {
    expect(pastEventDateLabel(["2026-10-10T22:00:00Z", "2026-10-11T02:00:00Z"])).toBe(
      "10 de outubro de 2026",
    );
  });

  it("dois dias no mesmo mês", () => {
    expect(pastEventDateLabel(["2026-10-11T22:00:00Z", "2026-10-10T22:00:00Z"])).toBe(
      "10 e 11 de outubro de 2026",
    );
  });

  it("três ou mais dias viram intervalo", () => {
    expect(
      pastEventDateLabel(["2026-10-10T22:00:00Z", "2026-10-11T22:00:00Z", "2026-10-12T22:00:00Z"]),
    ).toBe("De 10 a 12 de outubro de 2026");
  });

  it("meses diferentes", () => {
    expect(pastEventDateLabel(["2026-09-30T22:00:00Z", "2026-10-01T22:00:00Z"])).toBe(
      "30 de setembro e 1 de outubro de 2026",
    );
  });

  it("anos diferentes", () => {
    expect(
      pastEventDateLabel(["2026-12-30T22:00:00Z", "2026-12-31T22:00:00Z", "2027-01-01T22:00:00Z"]),
    ).toBe("De 30 de dezembro de 2026 a 1 de janeiro de 2027");
  });

  it("sem datas válidas", () => {
    expect(pastEventDateLabel([])).toBe("");
    expect(pastEventDateLabel(["xyz"])).toBe("");
  });
});

describe("parsePastLimit", () => {
  it.each([
    [undefined, 12],
    ["", 12],
    ["abc", 12],
    ["-12", 12],
    ["0", 12],
    ["12", 12],
    ["24", 24],
    ["25", 24],
    ["120", 120],
    ["999", 120],
    ["9999999", 12],
    [["36", "48"], 36],
  ])("%j vira %i", (value, expected) => {
    expect(parsePastLimit(value as string | string[] | undefined)).toBe(expected);
  });
});

describe("nextPastLimit", () => {
  it("soma 12 até o máximo", () => {
    expect(nextPastLimit(12)).toBe(24);
    expect(nextPastLimit(108)).toBe(120);
    expect(nextPastLimit(120)).toBeNull();
  });
});

describe("isPastEventDay", () => {
  const last = "2026-10-10T23:00:00Z"; // 20h00 de 10/10 em Brasília

  it("ainda não é passado no mesmo dia, mesmo depois da sessão", () => {
    expect(isPastEventDay(last, new Date("2026-10-11T02:59:00Z"))).toBe(false);
  });

  it("vira passado à meia-noite de Brasília", () => {
    expect(isPastEventDay(last, new Date("2026-10-11T03:00:00Z"))).toBe(true);
  });

  it("sem data não é passado", () => {
    expect(isPastEventDay(null, new Date("2030-01-01T00:00:00Z"))).toBe(false);
  });
});
