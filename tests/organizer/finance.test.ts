import { describe, expect, it } from "vitest";

import {
  financeRefusalMessage,
  parseOrganizerEventFinance,
  parsePayoutsOverview,
  payoutSituation,
  situationLabel,
  type FinanceHistoryItem,
  type PayoutSituation,
} from "@/lib/organizer/finance";

const plain = (text: string) => text.replace(/\u00a0/g, " ");
const org = (s: PayoutSituation) => plain(situationLabel(s, "organizador"));
const team = (s: PayoutSituation) => plain(situationLabel(s, "equipe"));

const base = {
  today: "2026-10-26",
  startDate: "2026-10-24",
  dueDate: "2026-10-30",
  balanceCents: 0,
  pendingFeeOrders: 0,
  paidOutCents: 0,
  history: [] as FinanceHistoryItem[],
  flag: null,
};

const payout = (o: Partial<FinanceHistoryItem> = {}): FinanceHistoryItem => ({
  payoutId: "p1",
  kind: "repasse",
  itemCents: 43905,
  payoutCents: 43905,
  pixDate: "2026-10-29",
  createdAt: "2026-10-29T15:00:00Z",
  note: null,
  reason: null,
  createdByName: null,
  ...o,
});

describe("payoutSituation + situationLabel", () => {
  it("antes do dia seguinte à última sessão: em andamento", () => {
    const s = payoutSituation({ ...base, today: "2026-10-20", balanceCents: 5000 });
    expect(s).toEqual({ kind: "andamento", dueDate: "2026-10-30" });
    expect(org(s)).toBe("Repasse previsto até 30/10");
    expect(team(s)).toBe("Em andamento · prazo 30/10");
    expect(org(payoutSituation({ ...base, today: "2026-10-20", dueDate: null }))).toBe("Prazo a confirmar");
    expect(payoutSituation({ ...base, startDate: null }).kind).toBe("andamento");
  });

  it("saldo positivo dentro do prazo: a pagar", () => {
    const s = payoutSituation({ ...base, balanceCents: 43905 });
    expect(s.kind).toBe("a_pagar");
    expect(org(s)).toBe("Em conferência — previsto até 30/10");
    expect(team(s)).toBe("A pagar até 30/10");
    expect(org(payoutSituation({ ...base, balanceCents: 43905, dueDate: null }))).toBe("Prazo a confirmar");
  });

  it("tarifa ainda desconhecida não muda a situação nem segura saldo negativo", () => {
    const paying = payoutSituation({ ...base, balanceCents: 43905, pendingFeeOrders: 2 });
    expect(paying.kind).toBe("a_pagar");
    expect(team(paying)).toBe("A pagar até 30/10");
    expect(org(paying)).toBe("Em conferência — previsto até 30/10");
    expect(payoutSituation({ ...base, pendingFeeOrders: 2 }).kind).toBe("sem_valor");
    expect(payoutSituation({ ...base, pendingFeeOrders: 1, balanceCents: -100 }).kind).toBe("desconto");
  });

  it("passou do prazo com saldo: atrasado", () => {
    const s = payoutSituation({ ...base, today: "2026-10-31", balanceCents: 43905 });
    expect(s.kind).toBe("atrasado");
    expect(org(s)).toBe("Previsto até 30/10 — o Espaço foi avisado");
    expect(team(s)).toBe("Atrasado desde 30/10");
  });

  it("saldo zero com repasse: pago; sem nada: sem valor", () => {
    const s = payoutSituation({ ...base, paidOutCents: 43905, history: [payout()] });
    expect(s).toEqual({ kind: "pago", paidAt: "2026-10-29", paidCents: 43905 });
    expect(org(s)).toBe("Pago em 29/10 · R$ 439,05");
    expect(payoutSituation(base)).toEqual({ kind: "sem_valor" });
    expect(org({ kind: "sem_valor" })).toBe("Sem valor a repassar");
    expect(payoutSituation({ ...base, history: [payout({ kind: "ajuste", itemCents: -100 })] }).kind).toBe("sem_valor");
  });

  it("saldo negativo sem prazo de devolução: desconto", () => {
    const s = payoutSituation({ ...base, balanceCents: -5000, flag: { negativeSince: "2026-10-26", returnDueDate: null } });
    expect(s).toEqual({ kind: "desconto", owedCents: 5000 });
    expect(org(s)).toBe("−R$ 50,00 será descontado do próximo repasse");
    expect(team(s)).toBe("Desconto de R$ 50,00 no próximo repasse");
  });

  it("marcação com prazo: devolução (atrasada depois do prazo)", () => {
    const flag = { negativeSince: "2026-10-30", returnDueDate: "2026-12-09" };
    const s = payoutSituation({ ...base, today: "2026-12-01", balanceCents: -4739, flag });
    expect(s).toEqual({ kind: "devolucao", owedCents: 4739, returnDueDate: "2026-12-09", overdue: false });
    expect(org(s)).toBe("Devolva R$ 47,39 por PIX à ACDH Eventos até 09/12");
    const late = payoutSituation({ ...base, today: "2026-12-10", balanceCents: -4739, flag });
    expect(late.kind === "devolucao" && late.overdue).toBe(true);
    expect(team(late)).toBe("Devolução atrasada · R$ 47,39");
  });
});

describe("financeRefusalMessage", () => {
  it.each([
    ["ORG_MUDOU:43905", "O valor mudou para R$ 439,05. Confira e tente de novo."],
    ["ORG_TARIFA_PENDENTE:2", "Ainda faltam as tarifas de 2 pedidos. Lance pelo extrato ou aguarde."],
    ["ORG_VALOR:4739", "O valor máximo é R$ 47,39."],
    ["ORG_ESPERA:2026-10-16T18:30:00Z", "A troca só pode ser confirmada a partir de 16/10 às 15:30."],
    ["ORG_PIX_PENDENTE: Troca de chave PIX aguardando decisão.", "Existe uma troca de chave PIX aguardando decisão."],
    ["ORG_PRAZO: O repasse só pode ser registrado depois da última sessão.", "O repasse só pode ser registrado depois da última sessão."],
    ["ORG_DATA: Data do PIX inválida.", "Confira a data do PIX: não pode ser no futuro nem antes do fim do evento."],
    ["ORG_NADA: Nada a repassar neste evento.", "Não há valor a repassar neste evento."],
    ["ORG_CODIGO", "Código inválido ou vencido. Peça um novo código."],
    ["ORG_PIX_IGUAL: A chave informada é a atual.", "Essa já é a chave PIX cadastrada."],
    ["ORG_DEVOLUCAO: x", "Há uma devolução atrasada à ACDH Eventos. Faça a devolução antes de enviar novos eventos."],
    ["TARIFA_NOTA: x", "Informe de onde veio o valor (até 140 caracteres)."],
    ["TARIFA_VALOR: x", "O valor da tarifa não confere. Confira o extrato."],
    ["TARIFA_MUDOU:3", "A lista de pedidos sem tarifa mudou. Confira e tente de novo."],
    ["TAXA_ADMIN: x", "Só o Admin pode fazer isso."],
    ["TAXA_DEV: x", "A conta de desenvolvedor só consulta; quem registra é o Admin do Espaço."],
  ])("%s", (message, expected) => {
    expect(plain(financeRefusalMessage(message))).toBe(expected);
  });

  it("desconhecido, vazio ou sem número vira mensagem genérica", () => {
    const generic = "Não foi possível concluir. Tente de novo.";
    expect(financeRefusalMessage(undefined)).toBe(generic);
    expect(financeRefusalMessage("duplicate key value violates unique constraint")).toBe(generic);
    expect(financeRefusalMessage("ORG_MUDOU")).toBe(generic);
    expect(financeRefusalMessage("ORG_ESPERA:amanhã")).toBe(generic);
    expect(financeRefusalMessage("ORG_VALOR: Valor inválido.")).toBe("Valor inválido.");
  });
});

const rawFinance = () => ({
  viewer: "dono",
  event_id: "e1",
  event_name: "Show",
  organizer_public_name: "Produtora",
  today: "2026-10-26",
  start_date: "2026-10-24",
  due_date: "2026-10-30",
  calendar_until: 2030,
  sold_cents: 50000, sold_orders: 10, refunded_cents: 5000, refunded_orders: 1,
  contested_cents: 0, contested_orders: 0, bank_fee_cents: 1095, pending_fee_orders: 0,
  pending_cents: 0, share_cents: 43905, paid_out_cents: 0, balance_cents: 43905,
  decision_orders: 0, service_fee_cents: 2250,
  flag: null,
  history: [{ payout_id: "p", kind: "repasse", item_cents: 100, payout_cents: 100, pix_date: "2026-10-29",
    created_at: "2026-10-29T15:00:00Z", note: null, reason: null }],
  late_changes: [],
  pix: { type: "cpf", masked: "•••.982.247-••", holder_name: "Titular", document_masked: "•••.982.247-••",
    changed_at: null, change_pending: false },
  team: null,
});

describe("parseOrganizerEventFinance", () => {
  it("lê o JSON da Tarefa 6 em camelCase", () => {
    const f = parseOrganizerEventFinance(rawFinance());
    expect(f?.shareCents).toBe(43905);
    expect(f?.history[0].createdByName).toBeNull();
    expect(f?.team).toBeNull();
  });

  it("recusa centavos não inteiros, datas fora do formato e quem vê desconhecido", () => {
    expect(parseOrganizerEventFinance({ ...rawFinance(), share_cents: 439.05 })).toBeNull();
    expect(parseOrganizerEventFinance({ ...rawFinance(), share_cents: "43905" })).toBeNull();
    expect(parseOrganizerEventFinance({ ...rawFinance(), due_date: "30/10/2026" })).toBeNull();
    expect(parseOrganizerEventFinance({ ...rawFinance(), viewer: "secretaria" })).toBeNull();
    expect(parseOrganizerEventFinance(null)).toBeNull();
  });
});

describe("parsePayoutsOverview", () => {
  it("lê eventos, devedores e lançamentos; recusa status desconhecido", () => {
    const f = rawFinance();
    const numbers = Object.fromEntries(Object.entries(f).filter(([key]) => key.endsWith("_cents") || key.endsWith("_orders")));
    const event = { ...numbers, event_id: f.event_id, event_name: f.event_name, organizer_public_name: f.organizer_public_name,
      start_date: f.start_date, due_date: f.due_date, flag: null, organizer_id: "o1", organizer_status: "ativo",
      status: "a_pagar", last_payout_at: null, pix_change_pending: true };
    const raw = { today: "2026-10-26", calendar_until: 2030, events: [event],
      organizers_owing: [{ organizer_id: "o1", public_name: "Produtora", owed_cents: 4739, return_due_date: null }],
      payouts: [] };
    const o = parsePayoutsOverview(raw);
    expect(o?.events[0].pixChangePending).toBe(true);
    expect(o?.organizersOwing[0].owedCents).toBe(4739);
    expect(parsePayoutsOverview({ ...raw, events: [{ ...event, status: "pago" }] })).toBeNull();
  });
});
