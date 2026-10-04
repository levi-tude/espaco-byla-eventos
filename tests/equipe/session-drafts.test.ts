import { describe, expect, it } from "vitest";

import {
  addSessionDraft,
  applyPricesToAll,
  type DraftType,
  type EditorSession,
  initialSessionDrafts,
  limitedTypesForDraft,
  removeSessionDraft,
  scheduleChangesWithSales,
  sessionsToInput,
} from "@/components/equipe/session-drafts";
import { MAX_SESSIONS } from "@/lib/domain/session-editor";

const TYPES: DraftType[] = [
  { key: "preset:inteira", name: "Inteira", kind: "inteira", peoplePerUnit: 1 },
  { key: "preset:casadinha", name: "Casadinha", kind: "inteira", peoplePerUnit: 2 },
];

function savedSession(overrides: Partial<EditorSession> = {}): EditorSession {
  return {
    id: "40000000-0000-4000-8000-000000000001",
    name: null,
    startsAt: "2026-10-10T22:00:00.000Z",
    endsAt: null,
    capacity: 100,
    inteiraQuota: null,
    meiaQuota: 40,
    prices: {
      "preset:inteira": { priceCents: 5000, maxUnits: null, onSale: true },
      "preset:casadinha": { priceCents: 9000, maxUnits: 5, onSale: false },
    },
    sold: 3,
    occupied: 4,
    hasOrders: true,
    liveOrders: true,
    paidOrders: 2,
    ...overrides,
  };
}

describe("sessões na tela da equipe", () => {
  it("evento novo começa com uma sessão em branco", () => {
    const [draft, ...rest] = initialSessionDrafts();
    expect(rest).toEqual([]);
    expect(draft).toMatchObject({ id: null, startsAt: "", capacity: "", prices: {}, saved: null });
  });

  it("sessão salva vira texto no horário de Brasília, com preços em reais", () => {
    const [draft] = initialSessionDrafts([savedSession()]);
    expect(draft).toMatchObject({
      id: savedSession().id,
      startsAt: "2026-10-10T19:00",
      capacity: "100",
      inteiraQuota: "",
      meiaQuota: "40",
      prices: {
        "preset:inteira": { onSale: true, price: "50,00", maxUnits: "" },
        "preset:casadinha": { onSale: false, price: "90,00", maxUnits: "5" },
      },
    });
    expect(draft.saved).toMatchObject({ sold: 3, paidOrders: 2, startsAt: "2026-10-10T19:00" });
  });

  it("“Adicionar sessão” copia quantidades e preços da última, sem horário", () => {
    const drafts = addSessionDraft(initialSessionDrafts([savedSession()]));
    expect(drafts).toHaveLength(2);
    expect(drafts[1]).toMatchObject({
      id: null,
      startsAt: "",
      capacity: "100",
      meiaQuota: "40",
      saved: null,
      prices: { "preset:casadinha": { onSale: false, price: "90,00", maxUnits: "5" } },
    });
    drafts[1].prices["preset:inteira"].price = "1,00";
    expect(drafts[0].prices["preset:inteira"].price).toBe("50,00");
  });

  it("não passa do máximo de sessões", () => {
    let drafts = initialSessionDrafts();
    for (let i = 0; i < MAX_SESSIONS + 3; i += 1) drafts = addSessionDraft(drafts);
    expect(drafts).toHaveLength(MAX_SESSIONS);
  });

  it("voltar para uma sessão deixa todo tipo marcado à venda", () => {
    const drafts = addSessionDraft(initialSessionDrafts([savedSession()]));
    const [only] = removeSessionDraft(drafts, drafts[1].key);
    expect(only.prices["preset:casadinha"].onSale).toBe(true);
  });

  it("“Aplicar estes preços a todas as sessões” copia preços, limites e à venda", () => {
    let drafts = addSessionDraft(addSessionDraft(initialSessionDrafts([savedSession()])));
    drafts = drafts.map((draft, index) =>
      index === 2
        ? {
            ...draft,
            prices: {
              "preset:inteira": { onSale: true, price: "70", maxUnits: "9" },
              "preset:casadinha": { onSale: true, price: "120", maxUnits: "" },
            },
          }
        : draft,
    );
    const applied = applyPricesToAll(drafts, drafts[2].key, TYPES);
    for (const draft of applied) {
      expect(draft.prices["preset:inteira"]).toEqual({ onSale: true, price: "70", maxUnits: "9" });
      expect(draft.prices["preset:casadinha"].onSale).toBe(true);
    }
    applied[0].prices["preset:inteira"].price = "1";
    expect(applied[1].prices["preset:inteira"].price).toBe("70");
  });

  it("resumo de limites ignora tipo fora da venda (várias sessões)", () => {
    const [draft] = initialSessionDrafts([savedSession()]);
    expect(limitedTypesForDraft(draft, TYPES, false)).toEqual([
      { name: "Inteira", kind: "inteira", peoplePerUnit: 1, maxUnits: null },
    ]);
    expect(limitedTypesForDraft(draft, TYPES, true)).toHaveLength(2);
  });
});

describe("envio das sessões", () => {
  it("sessão única: todo tipo marcado fica à venda e precisa de preço", () => {
    const [draft] = initialSessionDrafts([savedSession()]);
    const result = sessionsToInput([draft], TYPES);
    expect(result).toEqual({
      ok: true,
      sessions: [
        {
          id: savedSession().id,
          name: "",
          startsAt: "2026-10-10T19:00",
          endsAt: "",
          capacity: 100,
          inteiraQuota: null,
          meiaQuota: 40,
          prices: [
            { typeIndex: 0, priceCents: 5000, maxUnits: null, onSale: true },
            { typeIndex: 1, priceCents: 9000, maxUnits: 5, onSale: true },
          ],
        },
      ],
    });
    draft.prices["preset:casadinha"].price = "";
    expect(sessionsToInput([draft], TYPES)).toEqual({
      ok: false,
      error: "Informe o preço de “Casadinha” (ex.: 45,00).",
    });
  });

  it("várias sessões: tipo fora da venda pode ficar sem preço; erro diz a sessão", () => {
    const drafts = addSessionDraft(initialSessionDrafts([savedSession()]));
    drafts[1].startsAt = "2026-10-10T20:30";
    drafts[1].prices["preset:casadinha"] = { onSale: false, price: "", maxUnits: "" };
    const result = sessionsToInput(drafts, TYPES);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.sessions[1].prices[1]).toEqual({
        typeIndex: 1,
        priceCents: null,
        maxUnits: null,
        onSale: false,
      });
    }
    drafts[1].capacity = "0";
    expect(sessionsToInput(drafts, TYPES)).toEqual({
      ok: false,
      error: "Sessão 2: Informe um total de ingressos válido.",
    });
  });

  it("limite inválido é recusado", () => {
    const [draft] = initialSessionDrafts([savedSession()]);
    draft.prices["preset:inteira"].maxUnits = "0";
    expect(sessionsToInput([draft], TYPES)).toEqual({
      ok: false,
      error: "Informe um limite válido para “Inteira” ou deixe em branco.",
    });
  });

  it("aviso de horário só para sessão salva com pedidos pagos e horário mudado", () => {
    const drafts = initialSessionDrafts([
      savedSession(),
      savedSession({
        id: "40000000-0000-4000-8000-000000000002",
        startsAt: "2026-10-10T23:30:00.000Z",
        paidOrders: 0,
      }),
    ]);
    expect(scheduleChangesWithSales(drafts)).toEqual([]);
    drafts[0].startsAt = "2026-10-10T20:00";
    drafts[1].startsAt = "2026-10-10T21:00";
    expect(scheduleChangesWithSales(drafts)).toEqual([{ draft: drafts[0], paidOrders: 2 }]);
  });
});
