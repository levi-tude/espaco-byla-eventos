import { createHash } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

import { ActionError } from "@/lib/action-result";
import {
  isHttpsUrl,
  normalizeEventInput,
  saveErrorMessage,
  UNLOCK_SECRET_MISSING_MESSAGE,
  UUID_PATTERN,
} from "@/lib/events/event-input";
import { hashUnlockCode } from "@/lib/tickets/unlock-code-crypto";

const input = {
  name: "  Show de teste ",
  venue: "Espaço Byla",
  description: "",
  ticketTypes: [{ preset: "inteira" as const, priceCents: 5000, maxUnits: null }],
  sessions: [
    {
      id: null,
      name: "",
      startsAt: "2026-12-01T20:00",
      endsAt: "",
      capacity: 100,
      inteiraQuota: null,
      meiaQuota: null,
      prices: [{ typeIndex: 0, priceCents: 5000, maxUnits: null, onSale: true }],
    },
  ],
};

describe("normalizeEventInput", () => {
  it("limpa os textos e devolve tipos e sessões para o banco", () => {
    const normalized = normalizeEventInput(input);
    expect(normalized.name).toBe("Show de teste");
    expect(normalized.coverImageUrl).toBeNull();
    expect(normalized.ticketTypes).toHaveLength(1);
    expect(normalized.sessions).toHaveLength(1);
  });

  it("recusa sem nome ou local", () => {
    expect(() => normalizeEventInput({ ...input, venue: " " })).toThrow(ActionError);
    expect(() => normalizeEventInput({ ...input, venue: " " })).toThrow("Preencha nome e local do evento.");
  });

  it("recusa capa sem https", () => {
    expect(() => normalizeEventInput({ ...input, coverImageUrl: "http://exemplo.com/a.jpg" })).toThrow(
      "Informe uma URL válida para a capa.",
    );
  });
});

describe("saveErrorMessage", () => {
  it("traduz códigos do organizador antes do texto genérico", () => {
    expect(saveErrorMessage("ORG_ESTADO:mudanca:nome", [])).toContain("Pedir mudança");
    expect(saveErrorMessage("ORG_LOTACAO:300", [])).toBe("Cada sessão pode ter no máximo 300 lugares.");
  });

  it("mantém as mensagens que já existiam", () => {
    expect(saveErrorMessage("COTA_INVALIDA", [])).toBe(
      "As quantidades de inteiras e meias precisam caber no total de ingressos.",
    );
  });

  it("erro desconhecido: texto genérico, nunca o texto cru do banco", () => {
    expect(saveErrorMessage("duplicate key value violates", [])).toBe("Não foi possível salvar o evento.");
  });
});

describe("auxiliares", () => {
  it("isHttpsUrl e UUID_PATTERN", () => {
    expect(isHttpsUrl("https://exemplo.com/a.jpg")).toBe(true);
    expect(isHttpsUrl("javascript:alert(1)")).toBe(false);
    expect(UUID_PATTERN.test("00000000-0000-4000-8000-000000000001")).toBe(true);
    expect(UUID_PATTERN.test("x")).toBe(false);
  });
});

describe("tipo com código de acesso", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const withCode = (maxUnits: number | null) => ({
    ...input,
    ticketTypes: [
      { preset: "inteira" as const, priceCents: 5000, maxUnits: null },
      {
        preset: null,
        id: null,
        name: "Projeto Capacitação",
        peoplePerUnit: 1,
        priceCents: 2500,
        maxUnits: null,
        unlockCodeOp: "set" as const,
        unlockCode: "bolsista2026",
      },
    ],
    sessions: [
      {
        ...input.sessions[0],
        prices: [
          { typeIndex: 0, priceCents: 5000, maxUnits: null, onSale: true },
          { typeIndex: 1, priceCents: 2500, maxUnits, onSale: true },
        ],
      },
    ],
  });

  it("grava HMAC com o segredo do servidor, não SHA-256 puro", () => {
    vi.stubEnv("UNLOCK_CODE_SECRET", "segredo-de-teste-com-mais-de-32-caracteres");
    const normalized = normalizeEventInput(withCode(12));
    const custom = normalized.ticketTypes[1] as { unlock_code_hash?: string };
    expect(custom.unlock_code_hash).toBe(hashUnlockCode("bolsista2026"));
    expect(custom.unlock_code_hash).not.toBe(
      createHash("sha256").update("bolsista2026", "utf8").digest("hex"),
    );
  });

  it("sem UNLOCK_CODE_SECRET não salva o código", () => {
    vi.stubEnv("UNLOCK_CODE_SECRET", "");
    expect(() => normalizeEventInput(withCode(12))).toThrow(UNLOCK_SECRET_MISSING_MESSAGE);
  });

  it("exige limite por sessão para o tipo com código", () => {
    vi.stubEnv("UNLOCK_CODE_SECRET", "segredo-de-teste-com-mais-de-32-caracteres");
    expect(() => normalizeEventInput(withCode(null))).toThrow(/Informe o limite de “Projeto Capacitação”/);
  });
});

