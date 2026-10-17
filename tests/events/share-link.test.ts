import { afterEach, describe, expect, it, vi } from "vitest";

import {
  eventShareModel,
  eventWhatsappText,
  publicAppBaseUrl,
  publicEventUrl,
  SHARE_PENDING_MESSAGE,
  SHARE_REJECTED_MESSAGE,
  whatsappShareUrl,
} from "@/lib/events/share-link";

const now = new Date("2026-10-17T15:00:00Z");

const base = {
  name: "Peça Y",
  slug: "peca-y",
  whenLabel: "12 de dezembro de 2099",
  approvalStatus: "aprovado",
  organizerId: null as string | null,
  deletedAt: null as string | null,
  lastSessionAt: "2099-12-12T22:00:00Z",
  appUrl: "https://espaco.example/",
  now,
};

afterEach(() => vi.unstubAllEnvs());

describe("link público do evento", () => {
  it("monta a URL absoluta e o texto do WhatsApp em três linhas", () => {
    expect(publicEventUrl("https://espaco.example/", "peca-y")).toBe("https://espaco.example/eventos/peca-y");
    const text = eventWhatsappText("Peça Y", "12 de dezembro de 2099", "https://espaco.example/eventos/peca-y");
    expect(text).toBe("Peça Y\n12 de dezembro de 2099\nhttps://espaco.example/eventos/peca-y");
    expect(whatsappShareUrl(text)).toBe(`https://wa.me/?text=${encodeURIComponent(text)}`);
  });

  it("usa o endereço configurado e, sem ele, o endereço local", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://espacobyla.example/");
    expect(publicAppBaseUrl()).toBe("https://espacobyla.example");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "  ");
    expect(publicAppBaseUrl()).toBe("http://localhost:3000");
  });

  it("evento do Espaço e evento aprovado, inclusive com venda ainda fechada, ganham o link", () => {
    const link = eventShareModel(base);
    expect(link).toMatchObject({
      kind: "link",
      emphasis: "normal",
      url: "https://espaco.example/eventos/peca-y",
    });
    expect(eventShareModel({ ...base, organizerId: "org", approvalStatus: "aprovado" })).toMatchObject({
      kind: "link",
      emphasis: "normal",
    });
  });

  it("evento encerrado continua com o link, em tom mais baixo", () => {
    expect(
      eventShareModel({ ...base, lastSessionAt: "2020-01-01T15:00:00Z" }),
    ).toMatchObject({ kind: "link", emphasis: "quiet" });
  });

  it("rascunho e em análise esperam a aprovação; recusado pede ajuste", () => {
    expect(eventShareModel({ ...base, organizerId: "org", approvalStatus: "rascunho" })).toEqual({
      kind: "pending",
      message: SHARE_PENDING_MESSAGE,
    });
    expect(eventShareModel({ ...base, organizerId: "org", approvalStatus: "em_analise" })).toEqual({
      kind: "pending",
      message: SHARE_PENDING_MESSAGE,
    });
    expect(eventShareModel({ ...base, organizerId: "org", approvalStatus: "outro" })).toEqual({
      kind: "pending",
      message: SHARE_PENDING_MESSAGE,
    });
    expect(eventShareModel({ ...base, organizerId: "org", approvalStatus: "recusado" })).toEqual({
      kind: "rejected",
      message: SHARE_REJECTED_MESSAGE,
    });
  });

  it("evento excluído não mostra nada", () => {
    expect(eventShareModel({ ...base, deletedAt: "2026-10-10T10:00:00Z" })).toEqual({ kind: "hidden" });
  });
});
