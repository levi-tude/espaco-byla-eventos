# Contas de organizador — Fase 3 (dinheiro do organizador e repasses) — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O organizador vê, por evento, quanto vendeu, quanto já recebeu e quando recebe; a equipe Admin registra os repasses por PIX manual (imutáveis, com quem e quando), com a tarifa real do banco de pagamento descontada da parte do organizador, prazo de 5 dias úteis de Salvador, desconto/devolução depois de estornos tardios e troca de chave PIX protegida. Também fecha as pendências da fase 2 que precisam estar prontas antes de existir organizador real.

**Architecture:** Banco decide todo valor (centavos inteiros, funções `security definer` só para `service_role`, recebendo o ID de quem age), igual à taxa de serviço (`20261013100000_service_fee.sql`). Três migrations novas: (A) tarifa por pagamento + calendário de dias úteis; (B) repasses, saldos, descontos/devoluções e visão do organizador/equipe; (C) troca de chave PIX, cota de código de login separada para organizadores e aviso de estorno "uma vez só". O app captura a tarifa no banco de pagamento depois de confirmar o pagamento (sem nunca atrasar ou quebrar a confirmação) e o cron diário tenta de novo. Telas: aba "Financeiro" do evento do organizador, página "Repasses" da equipe, "Trocar chave PIX".

**Tech Stack:** Next.js 16.3 (App Router, Server Actions com `runAction`/`ActionError`), Supabase Postgres (RLS, `security definer`, `set search_path = ''`), API de Orders e de Payments do banco de pagamento, Resend, Vitest, `embedded-postgres` para a matriz local (`scripts/db-tests/`), Cloud Run + Cloud Scheduler (cron diário já existente).

**Fonte de verdade:** `docs/superpowers/specs/2026-10-13-contas-organizador-design.md` (decisões 1–23 fechadas; seções 5.7, 7.6–7.9, 8.4, 9, 10, 12.2, 12.3, 14, 16, 17, 18, 20). Fase 2: `docs/superpowers/plans/2026-10-14-contas-organizador-fase2.md` (no ar, desligada). Pendências herdadas: `.superpowers/sdd/final-review.md` e `progress.md`.

**Estado conferido em 2026-10-15 (somente leitura, MCP `user-supabase-eventos`, projeto Espaço Byla Eventos):** última migration aplicada em produção = `organizer_operations` (fase 2). Nada da fase 3 existe no banco.

---

## Global Constraints

- **Banco:** só o MCP `user-supabase-eventos` / projeto **Espaço Byla Eventos** (`rlzyjlrcasqbjztgbgit`). Antes de qualquer SQL: declarar MCP + projeto no chat e conferir a impressão digital (`events`, `tickets`, `orders`, `ticket_types`, `staff_profiles`; parar se aparecer `alunos`, `transacoes`, `fluxo_*`). Nunca `user-supabase` / `plugin-supabase-supabase`.
- **Só existe o banco de produção.** Toda migration nova: (1) teste estático (Vitest lendo o SQL), (2) matriz local em Postgres temporário (`node scripts/db-tests/organizer-finance.mjs`, env `BYLA_PG_TOOLS`), (3) ensaio em produção numa única chamada `execute_sql` que termina em `raise exception 'ENSAIO %'` (desfaz tudo) — o ensaio também só roda com "pode" do dono, (4) aplicar com `apply_migration` **somente com "pode" explícito do dono**.
- **Toda tabela nova:** `enable row level security`, `revoke all ... from public, anon, authenticated, service_role` e nenhuma política (acesso só por função), salvo indicação contrária. Lançamentos de dinheiro e históricos usam o gatilho já existente `public.reject_finance_record_change()` (bloqueia `update`, `delete` e `truncate`).
- **Toda função nova:** `security definer`, `set search_path = ''`, `revoke execute ... from public, anon, authenticated` e `grant execute ... to service_role`. Funções recebem o ator (`p_admin` / `p_actor`) e conferem o papel dentro delas: dinheiro → `public.assert_finance_admin(p_admin, p_write)` (TAXA_ADMIN / TAXA_DEV, reaproveitado); organizador → `public.actor_event_access(p_actor, p_event_id) = 'dono'` e conta ativa.
- **Dinheiro:** só centavos inteiros (`integer`/`bigint`), calculados no banco. O app só exibe e repassa o valor que a tela mostrou (`p_expected_amount_cents`); se o banco calcular outro, recusa com `ORG_MUDOU:<valor>` e a tela recarrega. Nunca aceitar valor de repasse digitado livre.
- **Concorrência:** todo registro de dinheiro de um organizador trava `pg_advisory_xact_lock(hashtextextended('organizer_payout:' || organizer_id::text, 0))`.
- **Só Admin que não é desenvolvedor grava** (repasse, ajuste, devolução recebida, tarifa manual, decisão de troca de PIX). Admin desenvolvedor vê tudo e não grava (TAXA_DEV). Secretaria não vê nada de dinheiro.
- **Toda Server Action** chama o guard dentro dela (`requireFinanceAdmin({ write })`, `requireOrganizer`, `requireEventAccess`) e valida UUID, datas, centavos e textos antes de chamar o banco; retorna `ActionResult` via `runAction`, com `ActionError` só para mensagens previstas. O inventário `tests/security/action-inventory.test.ts` já cobre `src/app/equipe/**` e `src/app/organizador/**` (inclusive `route.ts`).
- **Erros:** mensagem genérica para o usuário, detalhe só no log (sem e-mail, CPF/CNPJ, chave PIX, token). Em dúvida, negar (falhar fechado). Mensagens de banco começam com prefixo (`ORG_*`, `TAXA_*`, `TARIFA_*`) e são traduzidas em `src/lib/organizer/finance.ts`.
- **Dados pessoais:** chave PIX, titular e CPF/CNPJ completos só aparecem para Admin não desenvolvedor, só no diálogo de registrar repasse/decidir troca e carregados sob demanda (nunca no HTML da lista nem em CSV). Em todo o resto, mascarados. Zero PII no Git, em logs e em `audit_log.details`.
- **Texto para comprador** não cita fornecedores (banco de pagamento, banco de dados, hospedagem, e-mail). Telas da equipe podem dizer "banco de pagamento"; não usar o nome da marca em texto novo.
- **Mobile-first** em toda tela nova; mesmos componentes visuais do painel atual.
- **Sem dependência nova.** Antes de mexer em API do Next, ler o guia em `node_modules/next/dist/docs/`.
- **Cloud Run cobra por requisição:** nada de trabalho em segundo plano depois da resposta (não usar `after()` para a tarifa). A captura roda dentro da requisição, com tempo limite curto, e o cron diário completa o que faltou.
- **Commits:** depois de cada tarefa, `git add` com caminhos explícitos (vários arquivos aparecem modificados só por CRLF — nunca adicioná-los). Se um arquivo que a tarefa precisa editar já estiver nessa lista (ex.: `src/lib/email/organizer-notice-template.ts`, `src/lib/organizer/notify.ts`), conferir antes do `git add` que `git diff --stat` mostra só as linhas da tarefa; se aparecer o arquivo inteiro trocado, devolver os finais de linha ao formato do `HEAD` antes de adicionar. Se aparecer `.git/index.lock`, esperar alguns segundos e repetir. Sem push, deploy ou escrita no banco sem "pode".

---

## Decisões de desenho (detalhes que a spec deixou para o plano)

1. **Tarifa ainda em conferência não segura o repasse inteiro** (Termos do organizador já publicados: "o repasse pode ser feito com o valor conferido até ali e o restante acertado no próximo repasse"). Só entram na "Sua parte" os pedidos com tarifa conhecida; os demais aparecem como "Em conferência (N pedidos · R$ X)" e entram quando a tarifa chegar (automática ou lançada pelo Admin). Conta exibida: vendido − estornos − contestações − em conferência − tarifa = sua parte.
2. **Compensação sem PIX.** Se o saldo de um evento for todo consumido por desconto pendente de outro evento do mesmo organizador, o registro vira `kind = 'compensacao'` (valor 0, sem PIX), com as linhas +saldo e −desconto. Assim o evento sai de "Atrasado" sem inventar um PIX de R$ 0,00. Descontos são abatidos do saldo negativo mais antigo para o mais novo, inclusive parcialmente.
3. **Devolução recebida pode ser parcial.** O Admin digita o valor que chegou (até o total devido); abate do saldo negativo mais antigo para o mais novo.
4. **Ajuste manual** (`kind = 'ajuste'`) com motivo obrigatório, nas duas direções: "a favor do organizador" (aumenta o saldo; linha negativa) e "a favor do Espaço" (diminui o saldo; linha positiva). A tela mostra em palavras, nunca o sinal.
5. **"Devolução pendente"** é controlada por uma tabela pequena de marcações (`organizer_balance_flags`), atualizada no cron diário e na hora de cada repasse/devolução: abre quando o saldo do evento fica negativo, vira "devolução pendente" (prazo de 10 dias) depois de 30 dias e fecha quando o saldo volta a ≥ 0.
6. **Prazo** = 5º dia útil contado do dia seguinte à última sessão (`event_fee_due_date`). Se o calendário não cobrir algum ano necessário, a função devolve `null` e a tela mostra "Prazo a confirmar" (falha fechada). A partir de 1º/11 a equipe vê o aviso "Feriados de {ano+1} ainda não cadastrados" até alguém cadastrar.
7. **Tarifa:** `fee = bruto − líquido` informados pelo banco de pagamento para o lado do vendedor; o bruto precisa ser igual a `orders.total_cents` (senão `TARIFA_VALOR` e alerta). O detalhamento (`fee_details` do lado do vendedor) é guardado só como informação. A data de liberação do dinheiro (`money_release_date`) também é guardada e aparece ao Admin no diálogo de repasse ("dinheiro do cartão liberado até dd/mm"), para o risco 2 da spec.
8. **Depois de um estorno** a tarifa é consultada de novo e passa a ser a que o banco realmente reteve. Se o teste da Tarefa 1 mostrar que a consulta não diz se a tarifa foi devolvida, a tarifa original fica (regra "tarifa real" dos Termos) e o Admin corrige à mão pelo extrato.
9. **Troca de chave PIX:** código por e-mail no momento do pedido + aviso por e-mail ao organizador e à equipe + confirmação do Admin não desenvolvedor, liberada só depois de um **período de espera de 24 h** (decidido pelo dono em 2026-10-15, opção A). Repasse bloqueado (`ORG_PIX_PENDENTE`) enquanto houver troca pendente. O diálogo de repasse avisa "Chave alterada em dd/mm".
10. **Cotas de e-mail (Resend grátis: 100/dia no total):** códigos de login da equipe continuam com 40/dia; organizadores ganham cota própria de 20/dia (`login-code:org-day`); códigos de troca de PIX 10/dia no site e 3/dia por conta; avisos ao organizador seguem em `email-org:day` (10/dia); a equipe recebe **um** resumo diário de atrasos, não um e-mail por evento.
11. **Capas:** até 20 envios por organizador por dia e 150 por dia no site todo (além do limite por hora atual); limpeza diária de capas órfãs com mais de 24 h, no máximo 100 apagadas por execução, e nada é apagado se a leitura dos eventos falhar.

---

## File Structure

| Arquivo | O quê |
| --- | --- |
| `scripts/mp-fee-probe.mjs` (novo) | Teste da tarifa com credenciais de teste (Tarefa 1); não grava nada no nosso banco |
| `src/lib/finance/business-days.ts` (novo) | Páscoa, feriados de Salvador, dias úteis e SQL do calendário (funções puras) |
| `supabase/migrations/20261019100000_payment_fees_calendar.sql` (novo) | `order_payment_fees`, `business_holidays` + carga 2026–2030, funções de tarifa e prazo, ações novas do `audit_log` |
| `supabase/migrations/20261019110000_organizer_payouts.sql` (novo) | Repasses, itens, marcações de saldo negativo, saldo/visões, `submit_event_for_approval` com `ORG_DEVOLUCAO` |
| `supabase/migrations/20261019120000_organizer_pix_limits.sql` (novo) | Troca de chave PIX, códigos de ação, cota de login dos organizadores, aviso de estorno uma vez só |
| `scripts/db-tests/organizer-finance.mjs` (novo) | Matriz local das três migrations |
| `supabase/tests/organizer_finance_check.sql` (novo) | Ensaio em produção que desfaz tudo |
| `tests/db/organizer-finance-migrations.test.ts` (novo) | Teste estático das migrations (RLS, revokes, prefixos, carga de feriados) |
| `src/lib/payments/fee.ts` (novo) | Leitura pura da tarifa na resposta do banco de pagamento |
| `src/lib/payments/types.ts`, `provider.ts`, `mercadopago.ts` | Novo método `findPaymentFee` |
| `src/lib/payments/capture-fee.ts` (novo, server-only) | Captura com tempo limite e nova tentativa |
| `src/lib/payments/confirm-order.ts`, `refund.ts` | Chamam a captura sem lançar erro |
| `src/app/equipe/eventos/order-actions.ts`, `session-actions.ts` | Captura após aceitar/estornar; aviso de estorno central |
| `src/app/api/payments/webhook/route.ts` | Aviso de estorno e recaptura após estorno externo |
| `src/app/api/cron/keep-alive/route.ts` | Tarifas pendentes, marcações, avisos diários, limpeza de capas |
| `src/lib/alerts/team-alert.ts` | Novo tipo `tarifa_nao_encontrada` |
| `src/lib/organizer/finance.ts` (novo) | Tipos, leitura do JSON, situação do repasse, textos, mensagens de recusa |
| `src/lib/organizer/payout-csv.ts` (novo) | Planilha dos repasses (sem dados pessoais) |
| `src/lib/organizer/load-finance.ts` (novo, server-only) | Carrega visões do banco para as telas |
| `src/lib/organizer/refund-notice.ts` (novo, server-only) | Aviso ao organizador em todo caminho de estorno |
| `src/lib/organizer/daily.ts` (novo, server-only) | Tarefas diárias do dinheiro do organizador |
| `src/lib/email/organizer-notice-template.ts`, `login-code-template.ts` | Avisos novos e código de troca de PIX |
| `src/app/organizador/eventos/[id]/page.tsx` + `src/components/organizer/OrganizerFinancePanel.tsx` (novo) | Aba "Financeiro" |
| `src/app/organizador/conta/page.tsx`, `actions.ts` + `src/components/organizer/PixChangeDialog.tsx` (novo) | "Trocar chave PIX" |
| `src/app/equipe/repasses/page.tsx`, `actions.ts`, `planilha/route.ts` (novos) | Página "Repasses" da equipe |
| `src/components/equipe/OrganizerPayoutDialog.tsx`, `OrganizerAdjustmentButton.tsx`, `RefundReceivedButton.tsx`, `ManualFeeButton.tsx`, `PayoutSituationBadge.tsx` (novos) | Ações da página Repasses |
| `src/app/equipe/layout.tsx` (ou o menu atual) | Item "Repasses" só para Admin |
| `src/app/equipe/organizadores/actions.ts` + componente de contas | Decidir troca de chave PIX |
| `src/app/equipe/eventos/media-actions.ts`, `src/lib/security/rate-limit.ts` | Limite diário de capas |
| `src/lib/media/storage.ts`, `src/lib/media/orphans.ts` (novo) | Listar e limpar capas órfãs |

---

## Tarefa 1 — Teste da tarifa no banco de pagamento (porta de decisão)

**Por quê:** a spec marca como não confirmado se a tarifa de um pagamento criado pela API de Orders pode ser lida (seção 9, item 1). A documentação de migração da própria API diz que `fee_details` não tem equivalente direto em `/v1/orders`; a API de Payments (`GET /v1/payments/{id}`, `GET /v1/payments/search`) mostra `fee_details[]`, `transaction_details.net_received_amount`, `transaction_amount` e `money_release_date`. Falta provar a ligação com pagamentos feitos pelo nosso fluxo.

**Files:**
- Create: `scripts/mp-fee-probe.mjs`
- Modify: este plano (seção "Resultado do teste da tarifa", no fim)

**Interfaces:**
- Consumes: credenciais de **teste** do app "Checkout Transparente" (`APP_USR-` do vendedor de teste), fornecidas pelo dono num arquivo fora do repositório (ex.: `%USERPROFILE%\.byla-secrets\mp-test.env`, variáveis `MP_TEST_ACCESS_TOKEN`, `MP_TEST_PUBLIC_KEY`), lido com `node --env-file=<arquivo>`.
- Produces: decisão registrada: **Caminho A** (tarifa automática por pagamento) ou **Caminho B** (lançamento manual, Tarefa 5B).

- [ ] **Step 1: Escrever o script** (sem dependências; `fetch` do Node 22):
  1. Cria token de cartão de teste em `POST /v1/card_tokens?public_key=…` (cartão de teste aprovado da documentação, titular `APRO`).
  2. Cria `POST /v1/orders` igual ao `createPayment` atual (`processing_mode: "automatic"`, `external_reference` = UUID novo, `X-Idempotency-Key`, valor acima do mínimo de cartão, pagador `…@testuser.com`).
  3. Tenta, nesta ordem, e anota o que funcionou: (a) `GET /v1/payments/search?external_reference=<uuid>`; (b) `GET /v1/payments/{transactions.payments[0].reference_id}`; (c) `GET /v1/payments/{transactions.payments[0].id}`.
  4. Para o pagamento achado, imprime **só**: caminho usado, `status`, `transaction_amount`, `transaction_details.net_received_amount`, soma e tipos de `fee_details` com `fee_payer = collector`, `money_release_date`, e se `transaction_amount − net_received_amount` bate com a soma de `fee_details`.
  5. Estorna com `POST /v1/orders/{id}/refund` (igual ao `refundOrder`) e, após 10 s, repete o item 4 e imprime também `transaction_amount_refunded` e `refunds[]` (só valores).
  6. Também cria um PIX de teste e repete o item 4 com o pagamento pendente (só para saber se a consulta já acha o pagamento antes de pagar; PIX de teste não paga).
  - Nunca imprime token, chave, e-mail, ID de cartão ou resposta inteira. Sai com código ≠ 0 se faltar variável.
- [ ] **Step 2: Rodar** `node --env-file="$env:USERPROFILE\.byla-secrets\mp-test.env" scripts/mp-fee-probe.mjs` (o dono cria o arquivo; o agente não lê o arquivo).
- [ ] **Step 3: Registrar o resultado** na seção do fim deste plano: caminho que funcionou (a/b/c), campos presentes, regra depois do estorno (tarifa devolvida → 0? valor mostrado?).
  - Se (a), (b) ou (c) funcionou **e** bruto − líquido bate → **Caminho A**: seguir Tarefas 4 e 5; pular 5B.
  - Se nenhum funcionou ou os valores não batem → **Caminho B**: fazer a Tarefa 5B no lugar de 4 e 5 (a Tarefa 3 continua, porque a tarifa manual por pedido usa a mesma tabela).
- [ ] **Step 4: Commit**

```powershell
git add scripts/mp-fee-probe.mjs docs/superpowers/plans/2026-10-15-contas-organizador-fase3.md
git commit -m "chore: teste da tarifa no banco de pagamento (fase 3)"
```

---

## Tarefa 2 — Dias úteis e feriados de Salvador (funções puras)

**Files:**
- Create: `src/lib/finance/business-days.ts`
- Test: `tests/finance/business-days.test.ts`

**Interfaces:**
- Produces: `easterSunday(year): string`, `addDays(dayKey, n): string`, `salvadorHolidays(year): Holiday[]`, `isBusinessDay(dayKey, holidays: ReadonlySet<string>): boolean`, `nthBusinessDay(startKey, n, holidays): string`, `holidaySeedSql(fromYear, toYear): string`, tipos `Holiday`, `HolidayKind`. Datas sempre `YYYY-MM-DD` (sem fuso; aritmética com `Date.UTC`).

- [ ] **Step 1: Teste que falha**

```ts
import { describe, expect, it } from "vitest";
import {
  addDays, easterSunday, holidaySeedSql, nthBusinessDay, salvadorHolidays,
} from "@/lib/finance/business-days";

const daysOf = (from: number, to: number) =>
  new Set(Array.from({ length: to - from + 1 }, (_, i) => salvadorHolidays(from + i)).flat().map((h) => h.day));

describe("calendário de Salvador", () => {
  it.each([
    [2026, "2026-04-05"], [2027, "2027-03-28"], [2028, "2028-04-16"], [2029, "2029-04-01"], [2030, "2030-04-21"],
  ])("Páscoa de %i", (year, day) => expect(easterSunday(year)).toBe(day));

  it("datas móveis de 2026 e 2027 iguais às da spec", () => {
    const days = daysOf(2026, 2027);
    for (const day of ["2026-02-16", "2026-02-17", "2026-04-03", "2026-06-04", "2027-02-08", "2027-02-09", "2027-03-26", "2027-05-27"]) {
      expect(days.has(day), day).toBe(true);
    }
  });

  it("Cinzas, 24/12 e 31/12 contam como dia útil; 29/3 e 19/3 não são feriado", () => {
    const days = daysOf(2026, 2027);
    for (const day of ["2026-02-18", "2027-02-10", "2026-12-24", "2026-12-31", "2026-03-19", "2027-03-29"]) {
      expect(days.has(day), day).toBe(false);
    }
  });

  it.each([
    ["2026-10-24", "2026-10-30"],
    ["2026-11-15", "2026-11-23"],
    ["2026-06-21", "2026-06-29"],
    ["2027-02-07", "2027-02-16"],
  ])("prazo de 5 dias úteis a partir de %s", (start, due) => {
    expect(nthBusinessDay(start, 5, daysOf(2026, 2027))).toBe(due);
  });

  it("15 datas por ano, sem dia repetido de 2026 a 2030", () => {
    for (let year = 2026; year <= 2030; year++) {
      const list = salvadorHolidays(year);
      expect(list).toHaveLength(15);
      expect(new Set(list.map((h) => h.day)).size).toBe(15);
    }
  });

  it("addDays atravessa fevereiro de ano bissexto", () => {
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2028-02-29", 1)).toBe("2028-03-01");
  });

  it("SQL de carga ordenado, com aspas escapadas e sem linhas repetidas", () => {
    const sql = holidaySeedSql(2026, 2030);
    expect(sql.startsWith("insert into public.business_holidays (day, name, kind, source) values")).toBe(true);
    expect(sql.match(/\('20\d\d-/g)).toHaveLength(75);
    expect(sql).toContain("('2026-02-16', 'Segunda-feira de Carnaval', 'bancario'");
    expect(sql.trimEnd().endsWith(";")).toBe(true);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar** — `npx vitest run tests/finance/business-days.test.ts` → FAIL (módulo não existe).
- [ ] **Step 3: Implementar**

```ts
export type HolidayKind = "nacional" | "estadual" | "municipal" | "bancario";
export type Holiday = { day: string; name: string; kind: HolidayKind; source: string };

const FEDERAL = "Lei 662/1949 (redação da Lei 10.607/2002)";
const MUNICIPAL = "Lei Municipal 1.997/1967";

const FIXED: ReadonlyArray<{ md: string; name: string; kind: HolidayKind; source: string }> = [
  { md: "01-01", name: "Confraternização Universal", kind: "nacional", source: FEDERAL },
  { md: "04-21", name: "Tiradentes", kind: "nacional", source: FEDERAL },
  { md: "05-01", name: "Dia do Trabalho", kind: "nacional", source: FEDERAL },
  { md: "06-24", name: "São João", kind: "municipal", source: MUNICIPAL },
  { md: "07-02", name: "Independência da Bahia (Dois de Julho)", kind: "estadual", source: "Constituição do Estado da Bahia, art. 6º, § 3º" },
  { md: "09-07", name: "Independência do Brasil", kind: "nacional", source: FEDERAL },
  { md: "10-12", name: "Nossa Senhora Aparecida", kind: "nacional", source: "Lei 6.802/1980" },
  { md: "11-02", name: "Finados", kind: "nacional", source: FEDERAL },
  { md: "11-15", name: "Proclamação da República", kind: "nacional", source: FEDERAL },
  { md: "11-20", name: "Zumbi e Consciência Negra", kind: "nacional", source: "Lei 14.759/2023" },
  { md: "12-08", name: "Nossa Senhora da Conceição da Praia", kind: "municipal", source: MUNICIPAL },
  { md: "12-25", name: "Natal", kind: "nacional", source: FEDERAL },
];

const MOVABLE: ReadonlyArray<{ offset: number; name: string; kind: HolidayKind; source: string }> = [
  { offset: -48, name: "Segunda-feira de Carnaval", kind: "bancario", source: "Resolução CMN 4.880/2020, art. 6º, I" },
  { offset: -47, name: "Terça-feira de Carnaval", kind: "bancario", source: "Resolução CMN 4.880/2020, art. 6º, I" },
  { offset: -2, name: "Sexta-feira da Paixão", kind: "municipal", source: `${MUNICIPAL}; Lei 9.093/1995, art. 2º` },
  { offset: 60, name: "Corpus Christi", kind: "municipal", source: `${MUNICIPAL}; Resolução CMN 4.880/2020, art. 6º, II` },
];

function key(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(dayKey: string, days: number): string {
  const [y, m, d] = dayKey.split("-").map(Number);
  return key(new Date(Date.UTC(y, m - 1, d + days)));
}

/** Algoritmo anônimo gregoriano (Meeus/Jones/Butcher). */
export function easterSunday(year: number): string {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return key(new Date(Date.UTC(year, month - 1, day)));
}

export function salvadorHolidays(year: number): Holiday[] {
  const easter = easterSunday(year);
  return [
    ...FIXED.map((h) => ({ day: `${year}-${h.md}`, name: h.name, kind: h.kind, source: h.source })),
    ...MOVABLE.map((h) => ({ day: addDays(easter, h.offset), name: h.name, kind: h.kind, source: h.source })),
  ].sort((x, y) => x.day.localeCompare(y.day));
}

export function isBusinessDay(dayKey: string, holidays: ReadonlySet<string>): boolean {
  const weekday = new Date(`${dayKey}T00:00:00Z`).getUTCDay();
  return weekday >= 1 && weekday <= 5 && !holidays.has(dayKey);
}

/** O próprio dia inicial conta, se for útil. */
export function nthBusinessDay(startKey: string, n: number, holidays: ReadonlySet<string>): string {
  let day = startKey;
  let count = 0;
  for (let guard = 0; guard < 120; guard++) {
    if (isBusinessDay(day, holidays) && ++count === n) return day;
    day = addDays(day, 1);
  }
  throw new Error("Prazo fora do alcance do calendário.");
}

const sqlText = (value: string) => `'${value.replaceAll("'", "''")}'`;

export function holidaySeedSql(fromYear: number, toYear: number): string {
  const rows: string[] = [];
  for (let year = fromYear; year <= toYear; year++) {
    for (const h of salvadorHolidays(year)) {
      rows.push(`  ('${h.day}', ${sqlText(h.name)}, '${h.kind}', ${sqlText(h.source)})`);
    }
  }
  return `insert into public.business_holidays (day, name, kind, source) values\n${rows.join(",\n")};`;
}
```

- [ ] **Step 4: Rodar e passar** — `npx vitest run tests/finance/business-days.test.ts` → PASS.
- [ ] **Step 5: Commit**

```powershell
git add src/lib/finance/business-days.ts tests/finance/business-days.test.ts
git commit -m "feat(financeiro): dias úteis e feriados de Salvador"
```

---

## Tarefa 3 — Migration A: tarifa por pagamento e calendário

**Files:**
- Create: `supabase/migrations/20261019100000_payment_fees_calendar.sql`
- Create: `tests/db/organizer-finance-migrations.test.ts`
- Create: `scripts/db-tests/organizer-finance.mjs` (copiar a estrutura de `scripts/db-tests/organizer-accounts.mjs`: sobe Postgres temporário, aplica todas as migrations em ordem, roda casos, derruba)

**Interfaces:**
- Consumes: `orders` (`status`, `total_cents`, `payment_provider`, `provider_order_id`), `public.assert_finance_admin`, `public.event_fee_due_date`, `public.log_audit`, `public.staff_display_name`.
- Produces (todas só `service_role`):
  - `record_payment_fee(p_order_id uuid, p_gross_cents integer, p_fee_cents integer, p_breakdown jsonb, p_release_date date, p_after_refund boolean) returns text` → `'salvo'` | `'manual'` (já havia lançamento manual; nada muda) | `'ignorado'` (pedido não conta).
  - `record_payment_fee_failure(p_order_id uuid, p_code text) returns integer` (tentativas acumuladas).
  - `orders_missing_fee(p_limit integer) returns table (order_id uuid, created_at timestamptz, provider_order_id text, after_refund boolean, attempts integer)`.
  - `record_payment_fee_manual(p_admin uuid, p_order_id uuid, p_fee_cents integer, p_note text) returns jsonb` (`{event_id, fee_cents, previous_fee_cents}`).
  - `event_fee_pending_orders(p_admin uuid, p_event_id uuid) returns table (order_id uuid, created_at timestamptz, total_cents integer, status text, attempts integer, last_error text)`.
  - `nth_business_day(p_start date, p_n integer) returns date` (null se o calendário não cobrir), `event_payout_due_date(p_event_id uuid) returns date`, `business_calendar_last_year() returns integer`.

- [ ] **Step 1: Teste estático que falha** (`tests/db/organizer-finance-migrations.test.ts`), no estilo de `tests/db/organizer-migrations.test.ts`:
  - lê o SQL; para cada `create table public.X`: há `alter table public.X enable row level security` e `revoke all on table public.X from public, anon, authenticated, service_role`;
  - para cada `create function public.f(`: corpo com `security definer` e `set search_path = ''`, e há `revoke execute on function public.f(` com `from public, anon, authenticated` e `grant execute on function public.f(` `to service_role`;
  - `order_payment_fees` tem o gatilho `reject_finance_record_change` **só** para `delete`/`truncate` (a linha é atualizada pelas funções; ver SQL) e `business_holidays` tem os três;
  - a carga de feriados contém exatamente `holidaySeedSql(2026, 2030)` (importado de `src/lib/finance/business-days.ts`);
  - o check de `audit_log.action` inclui todas as ações novas da fase 3 (lista abaixo).
- [ ] **Step 2: Rodar e ver falhar** — `npx vitest run tests/db/organizer-finance-migrations.test.ts` → FAIL (arquivo não existe).
- [ ] **Step 3: Escrever a migration**

```sql
-- Fase 3 (A): tarifa real de cada pagamento e calendário de dias úteis.
-- Tudo só por função security definer; nenhuma tabela é lida direto pelo app.

-- 0) Ações novas do histórico (todas as da fase 3 de uma vez)
alter table public.audit_log drop constraint audit_log_action_check;
alter table public.audit_log add constraint audit_log_action_check check (action in (
  'convite_gerado', 'convite_revogado', 'convite_usado', 'link_senha_gerado', 'senha_redefinida_link',
  'conta_criada', 'conta_suspensa', 'conta_reativada', 'conta_encerrada', 'aparelhos_esquecidos',
  'evento_criado', 'evento_enviado', 'evento_envio_desfeito', 'evento_aprovado', 'evento_recusado',
  'evento_alterado_pos_aprovacao', 'evento_excluido', 'vendas_abertas', 'vendas_pausadas',
  'pedido_estorno_criado', 'pedido_exclusao_criado', 'pedido_mudanca_criado',
  'pedido_atendido', 'pedido_recusado', 'pedido_cancelado',
  'tarifa_lancada', 'repasse_registrado', 'repasse_compensado', 'repasse_ajuste',
  'devolucao_recebida', 'devolucao_pendente',
  'pix_troca_pedida', 'pix_troca_cancelada', 'pix_troca_confirmada', 'pix_troca_recusada'
));

-- 1) Tarifa por pagamento -------------------------------------------------------
-- Linha com fee_cents nulo = tentativas automáticas que ainda não acharam a tarifa.
create table public.order_payment_fees (
  order_id uuid primary key references public.orders (id),
  gross_cents integer check (gross_cents is null or gross_cents > 0),
  fee_cents integer check (fee_cents is null or fee_cents >= 0),
  net_cents integer,
  source text not null default 'api' check (source in ('api', 'manual')),
  fee_breakdown jsonb not null default '[]'::jsonb check (jsonb_typeof(fee_breakdown) = 'array'),
  money_release_date date,
  attempts integer not null default 0 check (attempts between 0 and 50),
  last_error text check (last_error is null or last_error ~ '^[a-z0-9_]{1,40}$'),
  refund_checked_at timestamptz,
  note text check (note is null or (char_length(note) between 1 and 140 and note !~ '[\r\n]')),
  set_by uuid,          -- sem FK: não travar exclusão de conta (pendência M-2 da fase 2)
  set_by_name text,
  fetched_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint order_payment_fees_known_check check (
    (fee_cents is null) = (gross_cents is null) and (fee_cents is null) = (net_cents is null)
  ),
  constraint order_payment_fees_sum_check check (fee_cents is null or gross_cents = fee_cents + net_cents),
  constraint order_payment_fees_manual_check check (
    source = 'api' or (fee_cents is not null and set_by is not null and set_by_name is not null)
  )
);
alter table public.order_payment_fees enable row level security;
revoke all on table public.order_payment_fees from public, anon, authenticated, service_role;
create trigger order_payment_fees_no_delete
  before delete on public.order_payment_fees
  for each row execute function public.reject_finance_record_change();
create trigger order_payment_fees_no_truncate
  before truncate on public.order_payment_fees
  for each statement execute function public.reject_finance_record_change();

-- Pedidos que pagam tarifa: chegaram a ser pagos, valor > 0, pelo banco de pagamento.
create function public.order_has_bank_fee(p_order_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.orders o
    where o.id = p_order_id
      and o.status in ('pago', 'estornado', 'aguardando_decisao')
      and o.total_cents > 0
      and o.payment_provider = 'mercadopago'
  );
$$;

create function public.record_payment_fee(
  p_order_id uuid, p_gross_cents integer, p_fee_cents integer,
  p_breakdown jsonb, p_release_date date, p_after_refund boolean
) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_total integer;
  v_current public.order_payment_fees%rowtype;
begin
  if not public.order_has_bank_fee(p_order_id) then
    return 'ignorado';
  end if;
  select o.total_cents into v_total from public.orders o where o.id = p_order_id for update;
  if p_gross_cents is distinct from v_total then
    raise exception 'TARIFA_VALOR: bruto diferente do total do pedido.';
  end if;
  if p_fee_cents is null or p_fee_cents < 0 or p_fee_cents > p_gross_cents then
    raise exception 'TARIFA_VALOR: tarifa fora do intervalo.';
  end if;
  if p_breakdown is null or jsonb_typeof(p_breakdown) <> 'array' or jsonb_array_length(p_breakdown) > 10 then
    raise exception 'TARIFA_VALOR: detalhamento inválido.';
  end if;
  select * into v_current from public.order_payment_fees f where f.order_id = p_order_id;
  if v_current.source = 'manual' then
    return 'manual';
  end if;
  insert into public.order_payment_fees as f (
    order_id, gross_cents, fee_cents, net_cents, source, fee_breakdown, money_release_date,
    attempts, last_error, refund_checked_at, fetched_at, updated_at
  ) values (
    p_order_id, p_gross_cents, p_fee_cents, p_gross_cents - p_fee_cents, 'api', p_breakdown, p_release_date,
    0, null, case when p_after_refund then now() end, now(), now()
  )
  on conflict (order_id) do update set
    gross_cents = excluded.gross_cents,
    fee_cents = excluded.fee_cents,
    net_cents = excluded.net_cents,
    fee_breakdown = excluded.fee_breakdown,
    money_release_date = coalesce(excluded.money_release_date, f.money_release_date),
    attempts = 0,
    last_error = null,
    refund_checked_at = coalesce(excluded.refund_checked_at, f.refund_checked_at),
    fetched_at = now(),
    updated_at = now();
  return 'salvo';
end;
$$;

create function public.record_payment_fee_failure(p_order_id uuid, p_code text)
returns integer
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_code text := case when p_code ~ '^[a-z0-9_]{1,40}$' then p_code else 'erro' end;
  v_attempts integer;
begin
  if not public.order_has_bank_fee(p_order_id) then
    return 0;
  end if;
  insert into public.order_payment_fees as f (order_id, attempts, last_error, updated_at)
  values (p_order_id, 1, v_code, now())
  on conflict (order_id) do update set
    attempts = least(f.attempts + 1, 50),
    last_error = v_code,
    updated_at = now()
  where f.source = 'api'
  returning f.attempts into v_attempts;
  return coalesce(v_attempts, 0);
end;
$$;

-- Fila do cron: sem tarifa (até 5 tentativas) ou estornado sem recaptura (até 5 tentativas).
create function public.orders_missing_fee(p_limit integer)
returns table (order_id uuid, created_at timestamptz, provider_order_id text, after_refund boolean, attempts integer)
language sql stable security definer set search_path = '' as $$
  select o.id, o.created_at, o.provider_order_id,
         (o.status = 'estornado'),
         coalesce(f.attempts, 0)
  from public.orders o
  left join public.order_payment_fees f on f.order_id = o.id
  where o.status in ('pago', 'estornado', 'aguardando_decisao')
    and o.total_cents > 0
    and o.payment_provider = 'mercadopago'
    and coalesce(f.source, 'api') = 'api'
    and coalesce(f.attempts, 0) < 5
    and (f.order_id is null or f.fee_cents is null
         or (o.status = 'estornado' and f.refund_checked_at is null))
  order by o.created_at
  limit greatest(1, least(coalesce(p_limit, 20), 50));
$$;

create function public.record_payment_fee_manual(
  p_admin uuid, p_order_id uuid, p_fee_cents integer, p_note text
) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_order public.orders%rowtype;
  v_previous integer;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  perform public.assert_finance_admin(p_admin, true);
  if not public.order_has_bank_fee(p_order_id) then
    raise exception 'TARIFA_PEDIDO: Pedido sem tarifa a lançar.';
  end if;
  select * into v_order from public.orders o where o.id = p_order_id for update;
  if p_fee_cents is null or p_fee_cents < 0 or p_fee_cents > v_order.total_cents then
    raise exception 'TARIFA_VALOR: Tarifa fora do intervalo.';
  end if;
  if v_note is null or char_length(v_note) > 140 or v_note ~ '[\r\n]' then
    raise exception 'TARIFA_NOTA: Informe de onde veio o valor (até 140 caracteres).';
  end if;
  select f.fee_cents into v_previous from public.order_payment_fees f where f.order_id = p_order_id;
  insert into public.order_payment_fees as f (
    order_id, gross_cents, fee_cents, net_cents, source, note, set_by, set_by_name,
    attempts, last_error, refund_checked_at, updated_at
  ) values (
    p_order_id, v_order.total_cents, p_fee_cents, v_order.total_cents - p_fee_cents, 'manual', v_note,
    p_admin, public.staff_display_name(p_admin), 0, null, now(), now()
  )
  on conflict (order_id) do update set
    gross_cents = excluded.gross_cents, fee_cents = excluded.fee_cents, net_cents = excluded.net_cents,
    source = 'manual', note = excluded.note, set_by = excluded.set_by, set_by_name = excluded.set_by_name,
    attempts = 0, last_error = null, refund_checked_at = now(), updated_at = now();
  perform public.log_audit(p_admin, 'tarifa_lancada', v_order.event_id, p_order_id,
    (select e.organizer_id from public.events e where e.id = v_order.event_id),
    jsonb_build_object('fee_cents', p_fee_cents, 'previous_fee_cents', v_previous));
  return jsonb_build_object('event_id', v_order.event_id, 'fee_cents', p_fee_cents, 'previous_fee_cents', v_previous);
end;
$$;

create function public.event_fee_pending_orders(p_admin uuid, p_event_id uuid)
returns table (order_id uuid, created_at timestamptz, total_cents integer, status text, attempts integer, last_error text)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  perform public.assert_finance_admin(p_admin, false);
  return query
  select o.id, o.created_at, o.total_cents, o.status::text, coalesce(f.attempts, 0), f.last_error
  from public.orders o
  left join public.order_payment_fees f on f.order_id = o.id
  where o.event_id = p_event_id
    and public.order_has_bank_fee(o.id)
    and (f.fee_cents is null)
  order by o.created_at;
end;
$$;

-- 2) Calendário -------------------------------------------------------------------
create table public.business_holidays (
  day date primary key,
  name text not null check (char_length(name) between 3 and 80),
  kind text not null check (kind in ('nacional', 'estadual', 'municipal', 'bancario', 'extra')),
  source text not null check (char_length(source) between 3 and 120)
);
alter table public.business_holidays enable row level security;
revoke all on table public.business_holidays from public, anon, authenticated, service_role;

-- <colar aqui a saída de holidaySeedSql(2026, 2030), gerada pelo Step 3b>

create trigger business_holidays_immutable
  before update or delete on public.business_holidays
  for each row execute function public.reject_finance_record_change();
create trigger business_holidays_no_truncate
  before truncate on public.business_holidays
  for each statement execute function public.reject_finance_record_change();

-- Um ano está cadastrado quando o 1º de janeiro dele está na tabela.
create function public.business_calendar_last_year()
returns integer language sql stable security definer set search_path = '' as $$
  select max(extract(year from h.day))::integer
  from public.business_holidays h
  where extract(month from h.day) = 1 and extract(day from h.day) = 1;
$$;

create function public.nth_business_day(p_start date, p_n integer)
returns date language plpgsql stable security definer set search_path = '' as $$
declare
  v_day date := p_start;
  v_count integer := 0;
  v_last_year integer := public.business_calendar_last_year();
begin
  if p_start is null or p_n is null or p_n < 1 or p_n > 30 or v_last_year is null then
    return null;
  end if;
  for i in 0..120 loop
    if extract(year from v_day)::integer > v_last_year
       or not exists (select 1 from public.business_holidays h
                      where h.day = make_date(extract(year from v_day)::integer, 1, 1)) then
      return null;
    end if;
    if extract(isodow from v_day) between 1 and 5
       and not exists (select 1 from public.business_holidays h where h.day = v_day) then
      v_count := v_count + 1;
      if v_count = p_n then
        return v_day;
      end if;
    end if;
    v_day := v_day + 1;
  end loop;
  return null;
end;
$$;

create function public.event_payout_due_date(p_event_id uuid)
returns date language sql stable security definer set search_path = '' as $$
  select public.nth_business_day(public.event_fee_due_date(p_event_id), 5);
$$;

-- 3) Permissões --------------------------------------------------------------------
revoke execute on function public.order_has_bank_fee(uuid) from public, anon, authenticated;
revoke execute on function public.record_payment_fee(uuid, integer, integer, jsonb, date, boolean) from public, anon, authenticated;
revoke execute on function public.record_payment_fee_failure(uuid, text) from public, anon, authenticated;
revoke execute on function public.orders_missing_fee(integer) from public, anon, authenticated;
revoke execute on function public.record_payment_fee_manual(uuid, uuid, integer, text) from public, anon, authenticated;
revoke execute on function public.event_fee_pending_orders(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.business_calendar_last_year() from public, anon, authenticated;
revoke execute on function public.nth_business_day(date, integer) from public, anon, authenticated;
revoke execute on function public.event_payout_due_date(uuid) from public, anon, authenticated;
grant execute on function public.order_has_bank_fee(uuid) to service_role;
grant execute on function public.record_payment_fee(uuid, integer, integer, jsonb, date, boolean) to service_role;
grant execute on function public.record_payment_fee_failure(uuid, text) to service_role;
grant execute on function public.orders_missing_fee(integer) to service_role;
grant execute on function public.record_payment_fee_manual(uuid, uuid, integer, text) to service_role;
grant execute on function public.event_fee_pending_orders(uuid, uuid) to service_role;
grant execute on function public.business_calendar_last_year() to service_role;
grant execute on function public.nth_business_day(date, integer) to service_role;
grant execute on function public.event_payout_due_date(uuid) to service_role;
```

  Observações para quem implementa: confirmar no SQL atual que o valor de `orders.payment_provider` para pagamentos reais é exatamente `'mercadopago'` (é o `name` do `MercadoPagoPaymentProvider`); se `orders.status` for enum, as comparações com texto funcionam como estão.
- [ ] **Step 3b: Gerar a carga de feriados** — adicionar ao teste um caso que, com `PRINT_HOLIDAY_SEED=1`, imprime `holidaySeedSql(2026, 2030)`; rodar `$env:PRINT_HOLIDAY_SEED=1; npx vitest run tests/finance/business-days.test.ts; Remove-Item Env:PRINT_HOLIDAY_SEED` e colar a saída no lugar do comentário da migration (75 linhas).
- [ ] **Step 4: Matriz local** — em `scripts/db-tests/organizer-finance.mjs`, casos (cada um com `assert` e mensagem em português):
  1. `nth_business_day` com os quatro exemplos da spec (30/10/2026, 23/11/2026, 29/06/2026, 16/02/2027) e com início em 2031 → `null`.
  2. `event_payout_due_date` de um evento com última sessão em 23/10/2026 → `2026-10-30`.
  3. `record_payment_fee` com bruto ≠ total → `TARIFA_VALOR`; com pedido `pendente` → `'ignorado'`; com pedido pago → `'salvo'` e `net = bruto − tarifa`; de novo depois de manual → `'manual'` sem mudar o valor.
  4. `record_payment_fee_failure` 5 vezes → pedido some de `orders_missing_fee`; pedido estornado com tarifa e sem `refund_checked_at` aparece com `after_refund = true`.
  5. `record_payment_fee_manual` por secretaria → `TAXA_ADMIN`; por Admin desenvolvedor → `TAXA_DEV`; sem nota → `TARIFA_NOTA`; por Admin → grava, `audit_log` com `tarifa_lancada` e sem PII em `details`.
  6. `delete`/`truncate` em `order_payment_fees` e `update` em `business_holidays` → erro do gatilho.
  7. Como `anon`/`authenticated`: `select` nas duas tabelas e `execute` nas funções → permissão negada.
- [ ] **Step 5: Rodar e passar** — `npx vitest run tests/db/organizer-finance-migrations.test.ts` e `node scripts/db-tests/organizer-finance.mjs` → tudo verde.
- [ ] **Step 6: Commit**

```powershell
git add supabase/migrations/20261019100000_payment_fees_calendar.sql tests/db/organizer-finance-migrations.test.ts scripts/db-tests/organizer-finance.mjs tests/finance/business-days.test.ts
git commit -m "feat(db): tarifa por pagamento e calendário de dias úteis"
```

---

## Tarefa 4 — Ler a tarifa no banco de pagamento (Caminho A)

**Files:**
- Create: `src/lib/payments/fee.ts`
- Modify: `src/lib/payments/types.ts`, `src/lib/payments/provider.ts`, `src/lib/payments/mercadopago.ts`
- Test: `tests/payments/fee-parse.test.ts`, `tests/payments/mercadopago-fee.test.ts`

**Interfaces:**
- Produces em `types.ts`:

```ts
export type PaymentFee = {
  grossCents: number;
  feeCents: number;
  breakdown: { type: string; cents: number }[];
  releaseDate: string | null;   // YYYY-MM-DD
  refunded: boolean;
};
export type PaymentFeeLookup =
  | { kind: "found"; fee: PaymentFee }
  | { kind: "not_found" }
  | { kind: "error"; code: "timeout" | "http" | "parse" | "ambiguous" };
```

- Produces em `PaymentProvider`: `findPaymentFee(order: OrderReference & { providerOrderId: string | null }, options: { signal: AbortSignal }): Promise<PaymentFeeLookup>`.
- Produces em `fee.ts`: `parsePaymentFee(payment: unknown): PaymentFee | null` e `pickPaymentForOrder(payments: unknown[], totalCents: number): unknown | "ambiguous" | null`.

- [ ] **Step 1: Testes que falham**
  - `fee-parse.test.ts`: pagamento aprovado `transaction_amount: 52.5`, `transaction_details.net_received_amount: 49.89`, `fee_details: [{ type: "mercadopago_fee", amount: 2.61, fee_payer: "collector" }]`, `money_release_date: "2026-11-20T10:00:00.000-04:00"` → `{ grossCents: 5250, feeCents: 261, breakdown: [{ type: "mercadopago_fee", cents: 261 }], releaseDate: "2026-11-20", refunded: false }`; arredondamento de `52.499999` → 5250; tarifa do pagador (`fee_payer: "payer"`) fica fora do detalhamento; líquido maior que bruto, valores negativos, `NaN`, texto → `null`; `status: "refunded"` → `refunded: true`; `pickPaymentForOrder` com dois aprovados de mesmo valor → `"ambiguous"`, com um aprovado + um rejeitado → o aprovado.
  - `mercadopago-fee.test.ts` (com `fetch` simulado, igual aos testes atuais do provedor): usa só o caminho escolhido na Tarefa 1; manda `Authorization` com o token do ambiente; `404`/lista vazia → `not_found`; `500` → `{ kind: "error", code: "http" }`; abort → `timeout`; nunca registra no console a resposta inteira.
- [ ] **Step 2: Rodar e ver falhar** — `npx vitest run tests/payments/fee-parse.test.ts tests/payments/mercadopago-fee.test.ts`.
- [ ] **Step 3: Implementar**
  - `parsePaymentFee`: `gross = Math.round(transaction_amount * 100)`, `net = Math.round(transaction_details.net_received_amount * 100)`, `fee = gross − net`; exige `0 ≤ fee ≤ gross` e números finitos; `breakdown` = `fee_details` com `fee_payer === "collector"` e `amount` finito ≥ 0 (no máximo 10 itens, `type` cortado em 40 caracteres e só `[a-z_]`); `releaseDate` = 10 primeiros caracteres de `money_release_date` se casar com `YYYY-MM-DD`; `refunded` = `status` em `refunded`/`charged_back` ou `transaction_amount_refunded ≥ transaction_amount`.
  - `MercadoPagoPaymentProvider.findPaymentFee`: chama a rota confirmada na Tarefa 1 com o `signal` recebido; na busca por `external_reference`, filtra por `external_reference === order.id` e usa `pickPaymentForOrder`; devolve `found` só com `parsePaymentFee` válido. Comportamento depois do estorno segue o registrado na Tarefa 1 (se a resposta não indicar a tarifa devolvida, devolve a tarifa original e a Tarefa 11 dá ao Admin a correção manual).
  - Qualquer outro provedor (testes) implementa `findPaymentFee` devolvendo `not_found`.
- [ ] **Step 4: Rodar e passar** — mesmos testes + `npx vitest run tests/payments` (nada quebrou).
- [ ] **Step 5: Commit**

```powershell
git add src/lib/payments/fee.ts src/lib/payments/types.ts src/lib/payments/provider.ts src/lib/payments/mercadopago.ts tests/payments/fee-parse.test.ts tests/payments/mercadopago-fee.test.ts
git commit -m "feat(pagamentos): leitura da tarifa de cada pagamento"
```

---

## Tarefa 5 — Captura automática, nova tentativa e alerta (Caminho A)

**Files:**
- Create: `src/lib/payments/capture-fee.ts` (`import "server-only"`)
- Modify: `src/lib/payments/confirm-order.ts`, `src/lib/payments/refund.ts`, `src/app/equipe/eventos/order-actions.ts` (`acceptPaidOrder`), `src/app/api/cron/keep-alive/route.ts`, `src/lib/alerts/team-alert.ts`
- Test: `tests/payments/capture-fee.test.ts`, ajustes em `tests/payments/confirm-order.test.ts`, `tests/api/keep-alive-route.test.ts`

**Interfaces:**
- Produces:

```ts
export type CaptureOutcome = "salvo" | "manual" | "ignorado" | "nao_encontrada" | "falhou";
export async function capturePaymentFee(
  admin: SupabaseClient, provider: PaymentProvider, orderId: string,
  options?: { afterRefund?: boolean; timeoutMs?: number },
): Promise<CaptureOutcome>;   // nunca lança
export async function captureMissingFees(
  admin: SupabaseClient, provider: PaymentProvider, options?: { limit?: number; budgetMs?: number },
): Promise<{ salvo: number; falhou: number; alertados: number }>;
```

- Produces em `team-alert.ts`: `TeamAlertKind` ganha `"tarifa_nao_encontrada"` com texto "Tarifa do pedido Nº {orderNumber} não encontrada; lance pelo extrato na página Repasses."

- [ ] **Step 1: Testes que falham** (`capture-fee.test.ts`, com cliente Supabase e provedor falsos):
  1. `found` → chama `record_payment_fee` com `p_gross_cents`, `p_fee_cents`, `p_breakdown` (array de `{type, cents}`), `p_release_date`, `p_after_refund`; devolve `"salvo"`.
  2. `not_found` / `error` → chama `record_payment_fee_failure` com `not_found` / `timeout` / `http`; devolve `"nao_encontrada"`/`"falhou"`.
  3. Banco responde `TARIFA_VALOR` → chama `alertTeam(admin, "valor_divergente", orderId, …)` e devolve `"falhou"`.
  4. Provedor demora mais que `timeoutMs` (padrão 5000) → aborta e devolve `"falhou"` sem lançar.
  5. Qualquer exceção (rede, banco) → devolve `"falhou"`, sem lançar e sem logar dados pessoais.
  6. `captureMissingFees`: pega até `limit` (padrão 20) de `orders_missing_fee`, para quando passar `budgetMs` (padrão 25 000); quando `record_payment_fee_failure` devolver 5, chama `alertTeam(admin, "tarifa_nao_encontrada", orderId, …)` (com dedupe já existente: 1 por pedido por 24 h).
  - `confirm-order.test.ts`: depois de marcar pago (`outcome !== "noop"`), `capturePaymentFee` é chamado **depois** do envio do e-mail do ingresso; se ele rejeitar, a confirmação continua devolvendo o mesmo resultado.
  - `keep-alive-route.test.ts`: a rota chama `captureMissingFees` e uma falha dele não derruba as outras etapas.
- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar**
  - `capturePaymentFee`: busca `orders` (`id, created_at, provider_order_id, total_cents, status`) pelo `admin`; `AbortController` com `timeoutMs`; chama `provider.findPaymentFee`; grava pelo RPC; mapeia erros conforme os testes; `console.error` só com código e `orderId`.
  - `confirmOrderPaid`: no fim do caminho que marcou pago, `await capturePaymentFee(admin, getPaymentProvider(), orderId).catch(() => "falhou")` (a função já não lança; o `catch` é cinto de segurança). Mantém a ordem: marcar pago → e-mail → tarifa.
  - `acceptPaidOrder` (aceitar "pago sem vaga"): mesma chamada depois do sucesso.
  - `refundPaidOrder` e `syncOrderRefunded` (resultado `completed`/`external`): `capturePaymentFee(..., { afterRefund: true })` depois de concluir.
  - Cron `keep-alive`: nova etapa `captureMissingFees` dentro de `try/catch` próprio, com orçamento de 25 s (a rota tem `maxDuration` 60).
- [ ] **Step 4: Rodar e passar** — `npx vitest run tests/payments tests/api`.
- [ ] **Step 5: Commit**

```powershell
git add src/lib/payments/capture-fee.ts src/lib/payments/confirm-order.ts src/lib/payments/refund.ts src/app/equipe/eventos/order-actions.ts src/app/api/cron/keep-alive/route.ts src/lib/alerts/team-alert.ts tests/payments/capture-fee.test.ts tests/payments/confirm-order.test.ts tests/api/keep-alive-route.test.ts
git commit -m "feat(pagamentos): captura da tarifa após pagamento e estorno"
```

## Tarefa 5B — Só se a Tarefa 1 falhar: tarifa lançada pelo Admin

Pular se a Tarefa 1 deu Caminho A.

- Nada de `findPaymentFee`/captura automática. `order_payment_fees` continua sendo a fonte, preenchida só por `record_payment_fee_manual` (Tarefa 3).
- Acrescentar à Migration A a função `record_event_fee_total(p_admin uuid, p_event_id uuid, p_total_fee_cents integer, p_note text) returns jsonb` (Admin não desenvolvedor): distribui o total digitado do extrato entre os pedidos do evento que ainda não têm tarifa, proporcional ao `total_cents` de cada um, com o resto dos centavos no pedido de maior valor (desempate pelo `id`), gravando cada linha como `source = 'manual'` com a mesma nota; recusa `TARIFA_VALOR` se o total for negativo ou maior que a soma dos pedidos pendentes.
- Matriz: total de R$ 13,56 em 10 pedidos de R$ 52,50 → 9 linhas de 135 e 1 de 141 (resto de 6 centavos no desempate pelo `id`), soma = 1356; rodar duas vezes → a segunda não acha pedido pendente (`TARIFA_NADA`).
- Tela: botão "Lançar tarifas do evento pelo extrato" no bloco do evento da página Repasses (Tarefa 11), com o texto "Some as tarifas deste evento no extrato do banco de pagamento e digite o total".
- Commit: `git add supabase/migrations/20261019100000_payment_fees_calendar.sql scripts/db-tests/organizer-finance.mjs` + arquivos da tela, mensagem `feat(financeiro): tarifa do evento lançada pelo extrato`.

---

## Tarefa 6 — Migration B: repasses, saldos e devoluções

**Files:**
- Create: `supabase/migrations/20261019110000_organizer_payouts.sql`
- Modify: `tests/db/organizer-finance-migrations.test.ts`, `scripts/db-tests/organizer-finance.mjs`

**Interfaces (todas só `service_role`):**
- `organizer_event_balance(p_event_id uuid)` → linha com `sold_cents, sold_orders, refunded_cents, refunded_orders, contested_cents, contested_orders, bank_fee_cents, pending_fee_orders, pending_cents, share_cents, paid_out_cents, balance_cents, decision_orders, service_fee_cents`.
- `organizer_pending_discounts(p_organizer_id uuid, p_except_event_id uuid)` → `(event_id, event_name, balance_cents)` com saldo < 0, do mais antigo ao mais novo.
- `record_organizer_payout(p_admin uuid, p_event_id uuid, p_expected_amount_cents integer, p_pix_date date, p_note text) returns jsonb` → `{payout_id, kind, amount_cents, discount_cents, organizer_id}`.
- `record_organizer_payout_adjustment(p_admin uuid, p_event_id uuid, p_amount_cents integer, p_reason text) returns uuid`.
- `record_organizer_refund_received(p_admin uuid, p_organizer_id uuid, p_amount_cents integer, p_pix_date date, p_note text) returns jsonb`.
- `refresh_organizer_balance_flags() returns table (flag_id uuid, organizer_id uuid, event_id uuid, event_name text, owed_cents bigint, return_due_date date)` (só as que precisam de e-mail) e `mark_balance_flag_notified(p_flag_id uuid) returns void`.
- `organizer_overdue_refunds(p_organizer_id uuid) returns integer`.
- `organizer_event_finance(p_actor uuid, p_event_id uuid) returns jsonb` (organizador dono ou Admin).
- `organizer_payouts_overview(p_admin uuid, p_from date, p_to date) returns jsonb`.
- `organizer_payout_details(p_admin uuid, p_event_id uuid) returns jsonb` (chave PIX completa; só Admin não desenvolvedor).
- `organizer_payouts_csv(p_admin uuid, p_from date, p_to date) returns table (...)`.
- `submit_event_for_approval(p_actor uuid, p_event_id uuid)` reescrita com `ORG_DEVOLUCAO`.

- [ ] **Step 1: Testes que falham** — estender o teste estático (tabelas novas com RLS/revoke; gatilhos `reject_finance_record_change` em `organizer_payouts` e `organizer_payout_items` para `update`/`delete`/`truncate`; todas as funções com revoke/grant; `submit_event_for_approval` contém `ORG_DEVOLUCAO`; `record_organizer_payout`, `record_organizer_payout_adjustment` e `record_organizer_refund_received` chamam `assert_finance_admin(p_admin, true)` e `pg_advisory_xact_lock`).
- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Escrever a migration** — núcleo do dinheiro abaixo; as três funções de leitura de tela seguem a especificação de JSON logo depois.

```sql
-- Fase 3 (B): repasses ao organizador, descontos e devoluções.

create table public.organizer_payouts (
  id uuid primary key default gen_random_uuid(),
  organizer_id uuid not null references public.organizer_profiles (user_id),
  kind text not null check (kind in ('repasse', 'compensacao', 'ajuste', 'devolucao')),
  amount_cents integer not null,
  pix_date date,
  pix_key_type text check (pix_key_type is null or pix_key_type in ('cpf', 'cnpj', 'email', 'telefone', 'aleatoria')),
  pix_key_snapshot text check (pix_key_snapshot is null or char_length(pix_key_snapshot) between 1 and 77),
  pix_holder_name_snapshot text check (pix_holder_name_snapshot is null or char_length(pix_holder_name_snapshot) between 2 and 120),
  pix_holder_document_snapshot text check (pix_holder_document_snapshot is null or pix_holder_document_snapshot ~ '^([0-9]{11}|[0-9]{14})$'),
  pix_key_changed_at_snapshot timestamptz,
  note text check (note is null or (char_length(note) between 1 and 140 and note !~ '[\r\n]')),
  reason text check (reason is null or char_length(btrim(reason)) between 5 and 500),
  created_by uuid not null,        -- sem FK (pendência M-2 da fase 2)
  created_by_name text not null,
  created_at timestamptz not null default now(),
  constraint organizer_payouts_shape_check check (
    (kind = 'repasse' and amount_cents > 0 and pix_date is not null and pix_key_type is not null
       and pix_key_snapshot is not null and pix_holder_name_snapshot is not null
       and pix_holder_document_snapshot is not null)
    or (kind = 'compensacao' and amount_cents = 0 and pix_date is null)
    or (kind = 'ajuste' and amount_cents <> 0 and reason is not null and pix_date is null)
    or (kind = 'devolucao' and amount_cents < 0 and pix_date is not null)
  )
);
create index organizer_payouts_organizer_idx on public.organizer_payouts (organizer_id, created_at desc);
create index organizer_payouts_pix_date_idx on public.organizer_payouts (pix_date) where pix_date is not null;

create table public.organizer_payout_items (
  payout_id uuid not null references public.organizer_payouts (id),
  event_id uuid not null references public.events (id),
  amount_cents integer not null check (amount_cents <> 0),
  primary key (payout_id, event_id)
);
create index organizer_payout_items_event_idx on public.organizer_payout_items (event_id);

create table public.organizer_balance_flags (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id),
  organizer_id uuid not null references public.organizer_profiles (user_id),
  negative_since date not null,
  return_due_date date,
  return_notified_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  check (return_due_date is null or return_due_date > negative_since)
);
create unique index organizer_balance_flags_open on public.organizer_balance_flags (event_id) where resolved_at is null;

alter table public.organizer_payouts enable row level security;
alter table public.organizer_payout_items enable row level security;
alter table public.organizer_balance_flags enable row level security;
revoke all on table public.organizer_payouts from public, anon, authenticated, service_role;
revoke all on table public.organizer_payout_items from public, anon, authenticated, service_role;
revoke all on table public.organizer_balance_flags from public, anon, authenticated, service_role;

create trigger organizer_payouts_immutable before update or delete on public.organizer_payouts
  for each row execute function public.reject_finance_record_change();
create trigger organizer_payouts_no_truncate before truncate on public.organizer_payouts
  for each statement execute function public.reject_finance_record_change();
create trigger organizer_payout_items_immutable before update or delete on public.organizer_payout_items
  for each row execute function public.reject_finance_record_change();
create trigger organizer_payout_items_no_truncate before truncate on public.organizer_payout_items
  for each statement execute function public.reject_finance_record_change();

-- Contas do evento (spec 10.2). Só pedidos com tarifa conhecida entram na parte do
-- organizador; os outros ficam "em conferência" até a tarifa chegar.
create function public.organizer_event_balance(p_event_id uuid)
returns table (
  sold_cents bigint, sold_orders integer, refunded_cents bigint, refunded_orders integer,
  contested_cents bigint, contested_orders integer, bank_fee_cents bigint,
  pending_fee_orders integer, pending_cents bigint, share_cents bigint,
  paid_out_cents bigint, balance_cents bigint, decision_orders integer, service_fee_cents bigint
)
language sql stable security definer set search_path = '' as $$
  with base as (
    select o.id, o.status::text as status, o.tickets_subtotal_cents::bigint as sub,
           o.service_fee_cents::bigint as svc, f.fee_cents::bigint as fee,
           (o.status = 'pago' and public.order_is_contested(o.id)) as contested
    from public.orders o
    left join public.order_payment_fees f on f.order_id = o.id
    where o.event_id = p_event_id and o.total_cents > 0
      and o.status in ('pago', 'estornado', 'aguardando_decisao')
  ),
  counted as (
    select b.*, (b.status = 'pago' and not b.contested) as keeps, b.fee is not null as known
    from base b where b.status in ('pago', 'estornado')
  ),
  totals as (
    select
      coalesce(sum(c.sub), 0)::bigint as sold,
      count(*)::integer as sold_orders,
      coalesce(sum(c.sub) filter (where c.status = 'estornado'), 0)::bigint as refunded,
      (count(*) filter (where c.status = 'estornado'))::integer as refunded_orders,
      coalesce(sum(c.sub) filter (where c.contested), 0)::bigint as contested,
      (count(*) filter (where c.contested))::integer as contested_orders,
      coalesce(sum(c.fee) filter (where c.known), 0)::bigint as fee,
      (count(*) filter (where not c.known))::integer as pending_orders,
      coalesce(sum(c.sub) filter (where not c.known and c.keeps), 0)::bigint as pending,
      coalesce(sum((case when c.keeps then c.sub else 0 end) - c.fee) filter (where c.known), 0)::bigint as share,
      coalesce(sum(c.svc) filter (where c.status = 'pago'), 0)::bigint as svc
    from counted c
  ),
  paid as (
    select coalesce(sum(i.amount_cents), 0)::bigint as v
    from public.organizer_payout_items i where i.event_id = p_event_id
  )
  select t.sold, t.sold_orders, t.refunded, t.refunded_orders, t.contested, t.contested_orders,
         t.fee, t.pending_orders, t.pending, t.share, p.v, t.share - p.v,
         (select count(*)::integer from base b where b.status = 'aguardando_decisao'), t.svc
  from totals t cross join paid p;
$$;

create function public.organizer_pending_discounts(p_organizer_id uuid, p_except_event_id uuid)
returns table (event_id uuid, event_name text, balance_cents bigint)
language sql stable security definer set search_path = '' as $$
  select e.id, e.name, b.balance_cents
  from public.events e
  cross join lateral public.organizer_event_balance(e.id) b
  where e.organizer_id = p_organizer_id
    and e.id is distinct from p_except_event_id
    and b.balance_cents < 0
  order by coalesce((select f.negative_since from public.organizer_balance_flags f
                     where f.event_id = e.id and f.resolved_at is null), public.event_fee_due_date(e.id)),
           e.id;
$$;

create function public.resolve_balance_flags(p_organizer_id uuid)
returns void language sql volatile security definer set search_path = '' as $$
  update public.organizer_balance_flags f set resolved_at = now()
  where f.organizer_id = p_organizer_id and f.resolved_at is null
    and (select b.balance_cents from public.organizer_event_balance(f.event_id) b) >= 0;
$$;

create function public.record_organizer_payout(
  p_admin uuid, p_event_id uuid, p_expected_amount_cents integer, p_pix_date date, p_note text
) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_today date := (now() at time zone 'America/Sao_Paulo')::date;
  v_event public.events%rowtype;
  v_profile public.organizer_profiles%rowtype;
  v_start date;
  v_balance bigint;
  v_pending integer;
  v_left bigint;
  v_take bigint;
  v_kind text;
  v_payout_id uuid;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_items jsonb;
  r record;
begin
  perform public.assert_finance_admin(p_admin, true);
  select * into v_event from public.events e where e.id = p_event_id;
  if v_event.id is null or v_event.organizer_id is null then
    raise exception 'ORG_ACESSO: Evento sem organizador.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('organizer_payout:' || v_event.organizer_id::text, 0));

  v_start := public.event_fee_due_date(p_event_id);
  if v_start is null or v_today < v_start then
    raise exception 'ORG_PRAZO: O repasse só pode ser registrado depois da última sessão.';
  end if;
  -- (a Migration C recria esta função com o bloco ORG_PIX_PENDENTE aqui)
  if v_note is not null and (char_length(v_note) > 140 or v_note ~ '[\r\n]') then
    raise exception 'ORG_NOTA: Nota inválida.';
  end if;

  select b.balance_cents, b.pending_fee_orders into v_balance, v_pending
  from public.organizer_event_balance(p_event_id) b;
  if v_balance <= 0 then
    if v_pending > 0 then
      raise exception 'ORG_TARIFA_PENDENTE:%', v_pending;
    end if;
    raise exception 'ORG_NADA: Nada a repassar neste evento.';
  end if;

  v_left := v_balance;
  v_items := jsonb_build_array(jsonb_build_object('event_id', p_event_id, 'amount_cents', v_balance));
  for r in select d.event_id, d.balance_cents from public.organizer_pending_discounts(v_event.organizer_id, p_event_id) d loop
    exit when v_left = 0;
    v_take := least(v_left, -r.balance_cents);
    v_items := v_items || jsonb_build_object('event_id', r.event_id, 'amount_cents', -v_take);
    v_left := v_left - v_take;
  end loop;

  if v_left <> p_expected_amount_cents then
    raise exception 'ORG_MUDOU:%', v_left;
  end if;
  v_kind := case when v_left > 0 then 'repasse' else 'compensacao' end;
  if v_kind = 'repasse' and (p_pix_date is null or p_pix_date > v_today or p_pix_date < v_start) then
    raise exception 'ORG_DATA: Data do PIX inválida.';
  end if;

  select * into v_profile from public.organizer_profiles op where op.user_id = v_event.organizer_id;
  insert into public.organizer_payouts (
    organizer_id, kind, amount_cents, pix_date, pix_key_type, pix_key_snapshot,
    pix_holder_name_snapshot, pix_holder_document_snapshot, pix_key_changed_at_snapshot,
    note, created_by, created_by_name
  ) values (
    v_event.organizer_id, v_kind, v_left::integer,
    case when v_kind = 'repasse' then p_pix_date end,
    case when v_kind = 'repasse' then v_profile.pix_key_type end,
    case when v_kind = 'repasse' then v_profile.pix_key end,
    case when v_kind = 'repasse' then v_profile.pix_holder_name end,
    case when v_kind = 'repasse' then v_profile.pix_holder_document end,
    case when v_kind = 'repasse' then v_profile.pix_key_changed_at end,
    v_note, p_admin, public.staff_display_name(p_admin)
  ) returning id into v_payout_id;

  insert into public.organizer_payout_items (payout_id, event_id, amount_cents)
  select v_payout_id, (i ->> 'event_id')::uuid, (i ->> 'amount_cents')::integer
  from jsonb_array_elements(v_items) i;

  perform public.resolve_balance_flags(v_event.organizer_id);
  perform public.log_audit(p_admin, case when v_kind = 'repasse' then 'repasse_registrado' else 'repasse_compensado' end,
    p_event_id, null, v_event.organizer_id,
    jsonb_build_object('amount_cents', v_left, 'discount_cents', v_balance - v_left));
  return jsonb_build_object('payout_id', v_payout_id, 'kind', v_kind, 'amount_cents', v_left,
    'discount_cents', v_balance - v_left, 'organizer_id', v_event.organizer_id);
end;
$$;

create function public.record_organizer_payout_adjustment(
  p_admin uuid, p_event_id uuid, p_amount_cents integer, p_reason text
) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_organizer uuid;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_id uuid;
begin
  perform public.assert_finance_admin(p_admin, true);
  select e.organizer_id into v_organizer from public.events e where e.id = p_event_id;
  if v_organizer is null then
    raise exception 'ORG_ACESSO: Evento sem organizador.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('organizer_payout:' || v_organizer::text, 0));
  if p_amount_cents is null or p_amount_cents = 0 or abs(p_amount_cents) > 10000000 then
    raise exception 'ORG_VALOR: Valor inválido.';
  end if;
  if char_length(v_reason) not between 5 and 500 then
    raise exception 'ORG_MOTIVO: Informe o motivo (5 a 500 caracteres).';
  end if;
  insert into public.organizer_payouts (organizer_id, kind, amount_cents, reason, created_by, created_by_name)
  values (v_organizer, 'ajuste', p_amount_cents, v_reason, p_admin, public.staff_display_name(p_admin))
  returning id into v_id;
  insert into public.organizer_payout_items (payout_id, event_id, amount_cents) values (v_id, p_event_id, p_amount_cents);
  perform public.resolve_balance_flags(v_organizer);
  perform public.log_audit(p_admin, 'repasse_ajuste', p_event_id, null, v_organizer,
    jsonb_build_object('amount_cents', p_amount_cents));
  return v_id;
end;
$$;

create function public.record_organizer_refund_received(
  p_admin uuid, p_organizer_id uuid, p_amount_cents integer, p_pix_date date, p_note text
) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_today date := (now() at time zone 'America/Sao_Paulo')::date;
  v_owed bigint;
  v_left bigint := p_amount_cents;
  v_take bigint;
  v_id uuid;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  r record;
begin
  perform public.assert_finance_admin(p_admin, true);
  perform pg_advisory_xact_lock(hashtextextended('organizer_payout:' || p_organizer_id::text, 0));
  if p_pix_date is null or p_pix_date > v_today or p_pix_date < v_today - 90 then
    raise exception 'ORG_DATA: Data do PIX inválida.';
  end if;
  if v_note is not null and (char_length(v_note) > 140 or v_note ~ '[\r\n]') then
    raise exception 'ORG_NOTA: Nota inválida.';
  end if;
  select coalesce(-sum(d.balance_cents), 0) into v_owed from public.organizer_pending_discounts(p_organizer_id, null) d;
  if v_owed <= 0 then
    raise exception 'ORG_NADA: Nada a receber deste organizador.';
  end if;
  if p_amount_cents is null or p_amount_cents < 1 or p_amount_cents > v_owed then
    raise exception 'ORG_VALOR:%', v_owed;
  end if;
  insert into public.organizer_payouts (organizer_id, kind, amount_cents, pix_date, note, created_by, created_by_name)
  values (p_organizer_id, 'devolucao', -p_amount_cents, p_pix_date, v_note, p_admin, public.staff_display_name(p_admin))
  returning id into v_id;
  for r in select d.event_id, d.balance_cents from public.organizer_pending_discounts(p_organizer_id, null) d loop
    exit when v_left = 0;
    v_take := least(v_left, -r.balance_cents);
    insert into public.organizer_payout_items (payout_id, event_id, amount_cents) values (v_id, r.event_id, -v_take);
    v_left := v_left - v_take;
  end loop;
  perform public.resolve_balance_flags(p_organizer_id);
  perform public.log_audit(p_admin, 'devolucao_recebida', null, null, p_organizer_id,
    jsonb_build_object('amount_cents', p_amount_cents, 'owed_cents', v_owed));
  return jsonb_build_object('payout_id', v_id, 'amount_cents', p_amount_cents, 'remaining_cents', v_owed - p_amount_cents);
end;
$$;

-- Cron diário: abre/fecha marcações e devolve as que precisam de e-mail.
create function public.refresh_organizer_balance_flags()
returns table (flag_id uuid, organizer_id uuid, event_id uuid, event_name text, owed_cents bigint, return_due_date date)
language plpgsql volatile security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_today date := (now() at time zone 'America/Sao_Paulo')::date;
  r record;
begin
  update public.organizer_balance_flags f set resolved_at = now()
  where f.resolved_at is null
    and (select b.balance_cents from public.organizer_event_balance(f.event_id) b) >= 0;

  insert into public.organizer_balance_flags (event_id, organizer_id, negative_since)
  select e.id, e.organizer_id, v_today
  from public.events e
  cross join lateral public.organizer_event_balance(e.id) b
  where e.organizer_id is not null and b.balance_cents < 0
    and not exists (select 1 from public.organizer_balance_flags f where f.event_id = e.id and f.resolved_at is null);

  for r in
    update public.organizer_balance_flags f set return_due_date = v_today + 10
    where f.resolved_at is null and f.return_due_date is null and f.negative_since + 30 <= v_today
    returning f.event_id, f.organizer_id
  loop
    perform public.log_audit(null, 'devolucao_pendente', r.event_id, null, r.organizer_id, '{}'::jsonb);
  end loop;

  return query
  select f.id, f.organizer_id, f.event_id, e.name, -b.balance_cents, f.return_due_date
  from public.organizer_balance_flags f
  join public.events e on e.id = f.event_id
  cross join lateral public.organizer_event_balance(f.event_id) b
  where f.resolved_at is null and f.return_due_date is not null and f.return_notified_at is null
  order by f.organizer_id, f.return_due_date;
end;
$$;

create function public.mark_balance_flag_notified(p_flag_id uuid)
returns void language sql volatile security definer set search_path = '' as $$
  update public.organizer_balance_flags f set return_notified_at = now()
  where f.id = p_flag_id and f.return_notified_at is null;
$$;

create function public.organizer_overdue_refunds(p_organizer_id uuid)
returns integer language sql stable security definer set search_path = '' as $$
  select count(*)::integer from public.organizer_balance_flags f
  where f.organizer_id = p_organizer_id and f.resolved_at is null
    and f.return_due_date < (now() at time zone 'America/Sao_Paulo')::date;
$$;
```

  `log_audit` com ator nulo grava `actor_kind = 'sistema'` (já é assim na fase 2). A tabela `organizer_pix_change_requests` só nasce na Migration C; por isso a C recria `record_organizer_payout` (`create or replace`, mesma assinatura) inserindo, no lugar do comentário marcado, o bloco:

```sql
  if exists (select 1 from public.organizer_pix_change_requests q
             where q.organizer_id = v_event.organizer_id and q.status = 'pendente') then
    raise exception 'ORG_PIX_PENDENTE: Há troca de chave PIX aguardando decisão.';
  end if;
```

  O teste estático confere que a última definição da função (na C) contém `ORG_PIX_PENDENTE`.

  **`submit_event_for_approval`:** `drop function` + `create function` com o corpo atual (migration `20261018100000`, a partir da linha 1862) e, logo depois da checagem `ORG_DONO`:

```sql
  if public.organizer_overdue_refunds(p_actor) > 0 then
    raise exception 'ORG_DEVOLUCAO: Há devolução ao Espaço Byla em atraso.';
  end if;
```

  Repetir os `revoke`/`grant` dela iguais aos atuais.

  **`organizer_event_finance(p_actor, p_event_id)`** — `plpgsql stable`. Quem pode: `actor_event_access(p_actor, p_event_id) = 'dono'` (com `organizer_is_active`) → `viewer = 'dono'`; senão `staff_finance_role(p_actor) in ('admin','admin_dev')` e o evento tem organizador → `viewer` = esse papel; senão `ORG_ACESSO`. Devolve:

```json
{
  "viewer": "dono",
  "event_id": "uuid", "event_name": "texto",
  "organizer_public_name": "texto",
  "today": "2026-10-30", "start_date": "2026-10-24", "due_date": "2026-10-30", "calendar_until": 2030,
  "sold_cents": 50000, "sold_orders": 10, "refunded_cents": 5000, "refunded_orders": 1,
  "contested_cents": 0, "contested_orders": 0, "bank_fee_cents": 1095,
  "pending_fee_orders": 0, "pending_cents": 0, "share_cents": 43905,
  "paid_out_cents": 0, "balance_cents": 43905, "decision_orders": 0, "service_fee_cents": 2250,
  "flag": null,
  "history": [{ "kind": "repasse", "item_cents": 43905, "payout_cents": 43905, "pix_date": "2026-10-29", "created_at": "…", "note": null }],
  "late_changes": [{ "order_id": "uuid", "kind": "estorno", "cents": 5000, "at": "…" }],
  "pix": { "type": "email", "masked": "•••@exemplo.com", "holder_name": "texto", "changed_at": null, "change_pending": false },
  "team": null
}
```

  - `flag`: `{ "negative_since", "return_due_date" }` da marcação aberta, ou `null`.
  - `late_changes`: pedidos estornados (data = maior `order_refunds.completed_at`) ou pagos contestados (data = `order_chargebacks.created_at` mais recente de `kind = 'contestacao'`) cuja data é posterior ao primeiro repasse do evento; até 20, mais recentes primeiro.
  - `pix.masked` e documento: mesmas expressões de máscara de `list_organizers` (migration `20261018100000`, linhas 853–869), extraídas para duas funções novas `public.mask_pix_key(p_type text, p_key text)` e `public.mask_tax_document(p_doc text)` (imutáveis, `security definer`, só `service_role`).
  - `team`: `null` para o organizador; para Admin, `{ "organizer_id", "release_until", "pix_changed_recently" }`, onde `release_until` = maior `order_payment_fees.money_release_date` do evento e `pix_changed_recently` = `pix_key_changed_at` nos últimos 30 dias. Só para Admin, cada item de `history` também leva `created_by_name`.

  **`organizer_payouts_overview(p_admin, p_from, p_to)`** — `assert_finance_admin(p_admin, false)`; período válido (até 400 dias, `p_from <= p_to`) senão `ORG_PERIODO`. Devolve `{ "today", "calendar_until", "events": [...], "organizers_owing": [...], "payouts": [...] }`:
  - `events`: todo evento com `organizer_id` não nulo e (`published_at` não nulo ou com pedido contado), com `event_id, event_name, organizer_id, organizer_public_name, organizer_status, start_date, due_date`, todos os números de `organizer_event_balance`, `last_payout_at` (maior `pix_date`/`created_at` de item positivo), `flag` e `pix_change_pending`. Ordenado: atrasados, a pagar (por prazo), em andamento, resto.
  - `organizers_owing`: por organizador com saldo negativo total: `organizer_id, public_name, owed_cents, return_due_date` (menor prazo aberto).
  - `payouts`: lançamentos com `created_at` (ou `pix_date`) no período: `payout_id, kind, amount_cents, pix_date, created_at, created_by_name, note, reason, organizer_public_name, items: [{event_id, event_name, amount_cents}]`. Sem chave PIX nem documento.

  **`organizer_payout_details(p_admin, p_event_id)`** — `assert_finance_admin(p_admin, true)`; devolve só `{ pix_key_type, pix_key, pix_holder_name, pix_holder_document, pix_key_changed_at, expected_amount_cents, discounts: [{event_name, cents}], release_until }` calculando `expected_amount_cents` com a mesma regra de `record_organizer_payout` (extrair o laço de descontos para `public.organizer_payout_preview(p_event_id) returns jsonb`, usado pelas duas).

  **`organizer_payouts_csv(p_admin, p_from, p_to)`** — `assert_finance_admin(p_admin, false)`; uma linha por item: `data_pix, registrado_em, tipo, organizador, evento, valor_cents, registrado_por, nota_ou_motivo`. Sem chave, titular ou documento.

  Permissões: `revoke execute ... from public, anon, authenticated` + `grant execute ... to service_role` para todas as funções novas.
- [ ] **Step 4: Matriz local** (mesmo `scripts/db-tests/organizer-finance.mjs`):
  1. **Exemplo da spec (R$ 439,05):** evento de organizador com 10 pedidos pagos de 1 Inteira (subtotal 5000, total 5250, taxa de serviço ligada); tarifas: 6 × 52 e 4 × 261; estornar um pedido de cartão e gravar a tarifa dele como 0 → `share_cents = 43905`, `bank_fee_cents = 1095`, `refunded_cents = 5000`, `service_fee_cents = 2250`.
  2. **Em conferência:** mesmo evento com 2 pedidos sem tarifa → `pending_fee_orders = 2`, `pending_cents = 10000`, `share` só dos outros; depois de gravar as tarifas, `share` sobe.
  3. **Prazo:** repasse antes do dia seguinte à última sessão → `ORG_PRAZO`; data do PIX no futuro → `ORG_DATA`.
  4. **Valor que mudou:** `p_expected_amount_cents` diferente → `ORG_MUDOU:43905`.
  5. **Papéis:** secretaria → `TAXA_ADMIN`; Admin desenvolvedor → `TAXA_DEV`.
  6. **Desconto no próximo repasse:** E1 com repasse de 43905; depois, estorno tardio de um pedido PIX de E1 (subtotal 5000, tarifa 52 mantida pelo banco) → saldo de E1 = −5000; E2 do mesmo organizador com saldo 20000 → `p_expected_amount_cents = 15000`, itens E2 +20000 e E1 −5000, E1 volta a 0 e a marcação fecha.
  7. **Compensação:** E1 com −5000 e E2 com 3000 → `kind = 'compensacao'`, valor 0, itens E2 +3000 e E1 −3000; E1 fica com −2000.
  8. **Devolução:** marcação com `negative_since` = hoje − 30 → `refresh_organizer_balance_flags()` devolve a linha com `return_due_date = hoje + 10`; `mark_balance_flag_notified` → some da lista; prazo vencido → `organizer_overdue_refunds = 1` e `submit_event_for_approval` → `ORG_DEVOLUCAO`; `record_organizer_refund_received` parcial e depois total → marcação resolvida; valor maior que o devido → `ORG_VALOR:<devido>`.
  9. **Imutável:** `update`/`delete`/`truncate` em `organizer_payouts` e itens → erro.
  10. **Visões:** `organizer_event_finance` para o dono → sem `created_by_name` e sem `team`; para organizador de outro evento → `ORG_ACESSO`; `organizer_payout_details` por Admin desenvolvedor → `TAXA_DEV`; CSV sem colunas de PIX/documento.
  11. **Pedido pago sem vaga** (`aguardando_decisao`) não entra em vendido nem na parte; aparece em `decision_orders`.
  12. **Calendário fora do cadastro:** evento em 2031 → `due_date = null`.
- [ ] **Step 5: Rodar e passar** — teste estático + matriz.
- [ ] **Step 6: Commit**

```powershell
git add supabase/migrations/20261019110000_organizer_payouts.sql tests/db/organizer-finance-migrations.test.ts scripts/db-tests/organizer-finance.mjs
git commit -m "feat(db): repasses ao organizador, descontos e devoluções"
```

---

## Tarefa 7 — Migration C: troca de chave PIX, cota de login dos organizadores e aviso de estorno

**Files:**
- Create: `supabase/migrations/20261019120000_organizer_pix_limits.sql`
- Modify: `tests/db/organizer-finance-migrations.test.ts`, `scripts/db-tests/organizer-finance.mjs`

**Interfaces (só `service_role`):**
- Tabelas: `organizer_pix_change_requests` (spec 7.2, com os campos abaixo) e `organizer_action_codes`.
- `issue_organizer_action_code(p_actor uuid, p_purpose text, p_code text) returns text` → `'ok'` | `'aguarde'` (menos de 60 s do último) | `'limite'`.
- `request_pix_change(p_actor uuid, p_code text, p_pix_key_type text, p_pix_key text, p_holder_name text, p_holder_document text) returns jsonb` → `{request_id, confirm_after}`.
- `cancel_pix_change(p_actor uuid, p_request_id uuid) returns void`.
- `decide_pix_change(p_admin uuid, p_request_id uuid, p_approve boolean, p_note text) returns jsonb` → `{organizer_id, status}`.
- `list_pix_change_requests(p_admin uuid) returns table (...)` (mascarado) e `pix_change_details(p_admin uuid, p_request_id uuid) returns jsonb` (completo; só Admin não desenvolvedor).
- `organizer_pix_change_state(p_actor uuid) returns jsonb` (para a tela do organizador: pendente? quando libera? chave nova mascarada).
- `issue_login_code(...)` recriada com cota separada para organizadores.
- `organizer_ops_requests.organizer_notified_at` + `claim_refund_request_notice(p_order_id uuid) returns table (request_id uuid, requested_by uuid, event_id uuid, event_name text)`.
- `record_organizer_payout` recriada com o bloco `ORG_PIX_PENDENTE` (ver Tarefa 6).

- [ ] **Step 1: Testes que falham** (estático): tabelas com RLS/revoke; `code_hash`/`code_salt` de `organizer_action_codes` nunca são devolvidos por função (nenhum `returns` com `code_hash`); `issue_login_code` contém `'login-code:org-day'` e `'login-code:all-day'`; `decide_pix_change` chama `assert_finance_admin(p_admin, true)`; `record_organizer_payout` final contém `ORG_PIX_PENDENTE`.
- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Escrever a migration**

```sql
-- Fase 3 (C): troca de chave PIX protegida, cota de códigos dos organizadores e
-- aviso de estorno ao organizador uma vez só.

create table public.organizer_action_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  purpose text not null check (purpose in ('pix_change')),
  code_salt text not null,
  code_hash text not null,
  attempts integer not null default 0 check (attempts between 0 and 5),
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index organizer_action_codes_user_idx on public.organizer_action_codes (user_id, purpose, created_at desc);
alter table public.organizer_action_codes enable row level security;
revoke all on table public.organizer_action_codes from public, anon, authenticated, service_role;

create table public.organizer_pix_change_requests (
  id uuid primary key default gen_random_uuid(),
  organizer_id uuid not null references public.organizer_profiles (user_id),
  pix_key_type text not null check (pix_key_type in ('cpf', 'cnpj', 'email', 'telefone', 'aleatoria')),
  pix_key text not null check (char_length(pix_key) between 1 and 77),
  pix_holder_name text not null check (char_length(btrim(pix_holder_name)) between 2 and 120),
  pix_holder_document text not null check (pix_holder_document ~ '^([0-9]{11}|[0-9]{14})$'),
  status text not null default 'pendente' check (status in ('pendente', 'confirmada', 'recusada', 'cancelada')),
  confirm_after timestamptz not null,
  decided_by uuid,
  decided_by_name text,
  decision_note text check (decision_note is null or char_length(btrim(decision_note)) between 5 and 500),
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index organizer_pix_change_one_pending
  on public.organizer_pix_change_requests (organizer_id) where status = 'pendente';
alter table public.organizer_pix_change_requests enable row level security;
revoke all on table public.organizer_pix_change_requests from public, anon, authenticated, service_role;
```

  Corpo das funções (mesmo estilo das funções do convite em `20261018100000`):
  - **`issue_organizer_action_code`**: só organizador ativo (`organizer_is_active(p_actor)`) senão `ORG_ACESSO`; trava `pg_advisory_xact_lock(hashtextextended('org-action-code:' || p_actor::text, 0))`; último código há menos de 60 s → `'aguarde'`; cotas `consume_rate_limit('pix-code:user-day', <hash do id>, 3, 86400)` e `consume_rate_limit('pix-code:all-day', 'site', 10, 86400)` → `'limite'`; invalida códigos abertos do mesmo propósito (`used_at = now()`); grava com o mesmo esquema do `issue_login_code` (`20261017100000`, linhas 215–220): `code_salt` = dois `gen_random_uuid()` sem hífens e `code_hash = encode(sha256(convert_to(code_salt || ':' || p_code, 'UTF8')), 'hex')`; a chave das cotas por conta é o mesmo `encode(sha256(convert_to('byla-rate-limit:' || p_actor::text, 'UTF8')), 'hex')`; validade 10 min.
  - **`request_pix_change`**: organizador ativo; código válido (não usado, não vencido, `attempts < 5`; erro incrementa `attempts` e devolve `ORG_CODIGO`; 5 erros → código cancelado); marca `used_at`; valida tipo/chave/titular/documento com **as mesmas regras de `accept_organizer_invite`** (chave CPF/CNPJ igual ao documento; `valid_tax_document`; e-mail/telefone/aleatória nos mesmos formatos) — extrair essas checagens para `public.pix_details_problem(p_type, p_key, p_holder, p_doc) returns text` e usar nas duas; chave igual à atual → `ORG_PIX_IGUAL`; já existe pendente → `ORG_PIX_PENDENTE`; insere com `confirm_after = now() + interval '24 hours'`; `log_audit(p_actor, 'pix_troca_pedida', null, null, p_actor, '{}')`.
  - **`cancel_pix_change`**: só o próprio organizador e só `pendente` → `cancelada`; audit `pix_troca_cancelada`.
  - **`decide_pix_change`**: `assert_finance_admin(p_admin, true)`; trava o organizador (`organizer_payout:`); pedido `pendente` senão `ORG_ESTADO`; aprovar antes de `confirm_after` → `ORG_ESPERA:<confirm_after em ISO>`; recusar exige nota; aprovar copia os quatro campos para `organizer_profiles` e `pix_key_changed_at = now()` (se houver gatilho de guarda em `organizer_profiles`, usar o mesmo `set_config('byla.organizer_flow', 'on', true)` que a fase 2 usa); audit `pix_troca_confirmada`/`pix_troca_recusada` sem a chave.
  - **`list_pix_change_requests`**: `assert_finance_admin(p_admin, false)`; pendentes e últimas 20 decididas, com chave atual e nova **mascaradas** (`mask_pix_key`, `mask_tax_document`), `confirm_after`, nome público.
  - **`pix_change_details`**: `assert_finance_admin(p_admin, true)`; chave e documento completos de atual e nova, só para o diálogo de decisão.
  - **`organizer_pix_change_state`**: organizador ativo; `{ pending: bool, request_id, new_masked, confirm_after, last_decision: { status, note, decided_at } | null }`.
  - **`issue_login_code`**: `create or replace` com o corpo atual de `20261017100000` (linha 164 em diante), trocando só as linhas 207–209 (cota geral):

```sql
  if exists (select 1 from public.staff_profiles sp where sp.user_id = p_user_id) then
    if not public.consume_rate_limit('login-code:all-day', 'site', 40, 86400) then
      return 'limite';
    end if;
  elsif not public.consume_rate_limit('login-code:org-day', 'site', 20, 86400) then
    return 'limite';
  end if;
```

    Antes de copiar, conferir se a fase 2 já recriou `issue_login_code` (procurar `function public.issue_login_code` em todas as migrations) e partir da versão mais nova.

  - **Aviso de estorno uma vez só:**

```sql
alter table public.organizer_ops_requests add column organizer_notified_at timestamptz;

create function public.claim_refund_request_notice(p_order_id uuid)
returns table (request_id uuid, requested_by uuid, event_id uuid, event_name text)
language sql volatile security definer set search_path = '' as $$
  update public.organizer_ops_requests r set organizer_notified_at = now()
  from public.events e
  where r.order_id = p_order_id and r.kind = 'estorno' and r.status = 'atendido'
    and r.organizer_notified_at is null and e.id = r.event_id
  returning r.id, r.requested_by, r.event_id, e.name;
$$;
```

  Também avisar o organizador quando o estorno **não** veio de pedido dele (estorno pela equipe ou em lote num evento de organizador): `claim_event_refund_notice(p_order_id uuid) returns table (organizer_id uuid, event_id uuid, event_name text)` grava numa tabela `organizer_refund_notices (order_id uuid primary key, notified_at timestamptz not null default now())` (RLS + revoke) com `insert … on conflict do nothing returning`, só para eventos com `organizer_id`; pedidos já avisados pela função anterior também entram nela, para nunca avisar duas vezes.

  Permissões: revoke/grant de todas; `organizer_ops_requests` continua sem acesso direto.
- [ ] **Step 4: Matriz local:**
  1. Código: 2º pedido em menos de 60 s → `'aguarde'`; 4º no dia → `'limite'`; código errado 5 vezes → cancelado; código certo depois de vencido → `ORG_CODIGO`.
  2. Troca: chave CPF diferente do documento → mesmo erro do cadastro; igual à atual → `ORG_PIX_IGUAL`; segunda pendente → `ORG_PIX_PENDENTE`.
  3. Repasse com troca pendente → `ORG_PIX_PENDENTE`.
  4. Decisão antes de 24 h → `ORG_ESPERA:…`; com `confirm_after` forçado para o passado → aprova, perfil atualizado, `pix_key_changed_at` preenchido; repasse seguinte grava o snapshot novo e o antigo continua igual no repasse anterior.
  5. Admin desenvolvedor decidindo → `TAXA_DEV`; organizador cancelando pedido de outro → `ORG_ACESSO`.
  6. Cota de login: 40 códigos de equipe esgotam só a equipe; organizador ainda recebe até 20.
  7. `claim_refund_request_notice` duas vezes → só a primeira devolve linha; `claim_event_refund_notice` idem.
- [ ] **Step 5: Rodar e passar.**
- [ ] **Step 6: Commit**

```powershell
git add supabase/migrations/20261019120000_organizer_pix_limits.sql tests/db/organizer-finance-migrations.test.ts scripts/db-tests/organizer-finance.mjs
git commit -m "feat(db): troca de chave PIX, cota de códigos e aviso de estorno"
```

---

## Tarefa 8 — Ensaio em produção (arquivo)

**Files:**
- Create: `supabase/tests/organizer_finance_check.sql`

- [ ] **Step 1:** Montar um único bloco `do $$ … $$` (como `supabase/tests/organizer_accounts_check.sql`) que: aplica o conteúdo das três migrations **dentro da transação**, cria dados falsos mínimos (organizador, evento com sessão passada, pedidos pagos com `order_payment_fees`), roda os casos 1, 3, 6 e 8 da Tarefa 6 e 2–4 da Tarefa 7, confere que os eventos reais não mudaram de prazo nem de saldo além do esperado (todos sem organizador → fora das visões), e termina com `raise exception 'ENSAIO OK %', <resumo>` para desfazer tudo.
- [ ] **Step 2:** Rodar só a matriz local de novo (o ensaio em produção é feito na seção Publicação, com "pode").
- [ ] **Step 3: Commit**

```powershell
git add supabase/tests/organizer_finance_check.sql
git commit -m "test(db): ensaio da fase 3 com rollback"
```

---

## Tarefa 9 — Regras de dinheiro no app (funções puras)

**Files:**
- Create: `src/lib/organizer/finance.ts`, `src/lib/organizer/payout-csv.ts`
- Test: `tests/organizer/finance.test.ts`, `tests/organizer/payout-csv.test.ts`

**Interfaces:**
- Produces em `finance.ts`:

```ts
export type PayoutSituation =
  | { kind: "andamento"; dueDate: string | null }
  | { kind: "a_pagar"; dueDate: string | null; balanceCents: number }
  | { kind: "conferindo"; pendingOrders: number; dueDate: string | null }
  | { kind: "atrasado"; dueDate: string; balanceCents: number }
  | { kind: "pago"; paidAt: string; paidCents: number }
  | { kind: "sem_valor" }
  | { kind: "desconto"; owedCents: number }
  | { kind: "devolucao"; owedCents: number; returnDueDate: string; overdue: boolean };
export type OrganizerEventFinance = { /* espelho do JSON da Tarefa 6, em camelCase */ };
export function parseOrganizerEventFinance(raw: unknown): OrganizerEventFinance | null;
export function parsePayoutsOverview(raw: unknown): PayoutsOverview | null;
export function payoutSituation(f: Pick<OrganizerEventFinance, "today" | "startDate" | "dueDate" | "balanceCents" | "pendingFeeOrders" | "paidOutCents" | "history" | "flag">): PayoutSituation;
export function situationLabel(s: PayoutSituation, audience: "organizador" | "equipe"): string;
export function financeRefusalMessage(message: string | undefined): string;
```

- Produces em `payout-csv.ts`: `buildPayoutsCsv(rows: PayoutCsvRow[]): string` (reaproveita `csvMoney`/`csvText` de `src/lib/finance/fee-csv.ts`: `;`, vírgula decimal, BOM, CRLF, escape de fórmula).

- [ ] **Step 1: Testes que falham** — tabela de casos da spec 10.4:
  - hoje < `startDate` → `andamento` ("Repasse previsto até 30/10" / "Prazo a confirmar" se `dueDate` nulo);
  - saldo > 0, dentro do prazo, sem pendentes → `a_pagar` (organizador: "Em conferência — previsto até 30/10"; equipe: "A pagar até 30/10");
  - pendentes > 0 e saldo ≤ 0 → `conferindo` ("Conferindo a tarifa do banco de 2 pedidos"); pendentes > 0 e saldo > 0 → `a_pagar` com aviso extra "2 pedidos ainda em conferência";
  - passou do prazo com saldo > 0 → `atrasado` (organizador: "Previsto até 30/10 — o Espaço foi avisado"; equipe: "Atrasado desde 30/10");
  - saldo 0 com repasse → `pago` ("Pago em 29/10 · R$ 439,05"); saldo 0 sem nada → `sem_valor`;
  - saldo < 0 sem marcação vencida → `desconto` ("−R$ 50,00 será descontado do próximo repasse");
  - marcação com `returnDueDate` → `devolucao` ("Devolva R$ 47,39 por PIX ao Espaço Byla até 09/12"), `overdue` quando hoje > prazo ("Devolução atrasada" para a equipe);
  - `financeRefusalMessage`: `ORG_MUDOU:43905` → "O valor mudou para R$ 439,05. Confira e tente de novo."; `ORG_TARIFA_PENDENTE:2` → "Ainda faltam as tarifas de 2 pedidos. Lance pelo extrato ou aguarde."; `ORG_PIX_PENDENTE`, `ORG_PRAZO`, `ORG_DATA`, `ORG_NADA`, `ORG_VALOR:4739` ("O valor máximo é R$ 47,39."), `ORG_ESPERA:<iso>` ("A troca só pode ser confirmada a partir de dd/mm às hh:mm."), `ORG_CODIGO`, `ORG_PIX_IGUAL`, `ORG_DEVOLUCAO`, `TARIFA_NOTA`, `TARIFA_VALOR`, `TAXA_ADMIN`, `TAXA_DEV`; desconhecido → mensagem genérica.
  - `parseOrganizerEventFinance`: rejeita centavos não inteiros, datas fora de `YYYY-MM-DD`, `viewer` desconhecido.
  - CSV: cabeçalho fixo, R$ com vírgula, nome começando com `=` escapado, nenhuma coluna de PIX/CPF.
- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar** (datas via `formatDayKey` de `src/lib/finance/situation.ts`; dinheiro via `formatMoney`).
- [ ] **Step 4: Rodar e passar.**
- [ ] **Step 5: Commit**

```powershell
git add src/lib/organizer/finance.ts src/lib/organizer/payout-csv.ts tests/organizer/finance.test.ts tests/organizer/payout-csv.test.ts
git commit -m "feat(organizador): regras de exibição do repasse"
```

---

## Tarefa 10 — Aba "Financeiro" do organizador

**Files:**
- Create: `src/lib/organizer/load-finance.ts` (`server-only`), `src/components/organizer/OrganizerFinancePanel.tsx`
- Modify: `src/app/organizador/eventos/[id]/page.tsx` (`TABS` ganha `financeiro`)
- Test: `tests/organizer/finance-panel.test.tsx` (render com dados falsos), ajuste no teste da página do evento se existir

**Interfaces:**
- Produces: `loadOrganizerEventFinance(actorId, eventId): Promise<OrganizerEventFinance | null>` (RPC `organizer_event_finance`, `null` em erro, log sem PII); `OrganizerFinancePanel({ finance, refundPixKey }: { finance: OrganizerEventFinance; refundPixKey: string | null })`.

- [ ] **Step 1: Teste que falha:** com o exemplo da spec, o painel mostra (spec 12.2): "Vendido R$ 500,00 (10 pedidos)", "Estornos −R$ 50,00 (1)", "Tarifa do banco de pagamento −R$ 10,95", "Sua parte R$ 439,05", "Já repassado R$ 0,00", "A receber R$ 439,05", situação e prazo; a frase "A taxa de serviço paga pelos compradores (R$ 22,50) não entra na sua parte."; com pendentes, a linha "Em conferência (2 pedidos) −R$ 100,00"; histórico com data do PIX e valor; nada de nome de quem registrou; chave PIX só mascarada com o texto "Repasse para: e-mail •••@exemplo.com"; com devolução pendente mostra a chave do Espaço (`refundPixKey`) ou, se ausente, "Fale com o Espaço Byla para receber a chave PIX"; lista `late_changes` como "Estorno do pedido Nº 1234 em 05/11 (−R$ 50,00)".
- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar:** a página só carrega o financeiro quando `aba=financeiro` (evita consulta à toa); `requireEventAccess(eventId)` já protege a página — a aba só existe para `access === 'dono'`; `refundPixKey = process.env.ORGANIZER_REFUND_PIX_KEY?.trim() || null` lido no servidor só quando a situação é `devolucao`; se faltar, `alertTeamSetup` (já existente, com dedupe). Layout mobile-first: cartões empilhados, números alinhados à direita, mesma tipografia do painel "Financeiro" da equipe (`EventFinancePanel`).
- [ ] **Step 4: Rodar e passar** + `npx vitest run tests/organizer`.
- [ ] **Step 5: Commit**

```powershell
git add src/lib/organizer/load-finance.ts src/components/organizer/OrganizerFinancePanel.tsx "src/app/organizador/eventos/[id]/page.tsx" tests/organizer/finance-panel.test.tsx
git commit -m "feat(organizador): aba Financeiro do evento"
```

---

## Tarefa 11 — Página "Repasses" da equipe

**Files:**
- Create: `src/app/equipe/repasses/page.tsx`, `src/app/equipe/repasses/actions.ts`, `src/app/equipe/repasses/planilha/route.ts`
- Create: `src/components/equipe/OrganizerPayoutDialog.tsx`, `OrganizerAdjustmentButton.tsx`, `RefundReceivedButton.tsx`, `ManualFeeButton.tsx`, `PayoutSituationBadge.tsx`
- Modify: menu da equipe (mesmo arquivo onde está "Taxa de serviço"), página do evento da equipe (bloco "Organizador" no painel Financeiro, só Admin), `src/lib/email/organizer-notice-template.ts` (`org_repasse_registrado`), `src/lib/organizer/notify.ts`
- Test: `tests/equipe/repasses-actions.test.ts`, `tests/equipe/repasses-page.test.tsx`, `tests/email/organizer-notice-template.test.ts` (estender)

**Interfaces:**
- Server Actions (todas `runAction` + `requireFinanceAdmin({ write: true })`, menos a de leitura):
  - `loadPayoutDetails(eventId: string)` → `ActionResult<PayoutDetails>` (chave completa; `write: true` porque só quem pode registrar vê).
  - `markOrganizerPaid(input: { eventId: string; expectedAmountCents: number; pixDate: string; note?: string })`.
  - `addOrganizerAdjustment(input: { eventId: string; direction: "organizador" | "espaco"; amountCents: number; reason: string })` → `p_amount_cents` = `direction === "organizador" ? -amount : amount`.
  - `markRefundReceived(input: { organizerId: string; amountCents: number; pixDate: string; note?: string })`.
  - `setManualFee(input: { orderId: string; feeCents: number; note: string })`.
  - `loadPendingFees(eventId: string)` (`write: false`).
- Route `GET /equipe/repasses/planilha?de=&ate=` → `requireFinanceAdmin({ write: false })`, `parseFeePeriod` reaproveitado, CSV de `organizer_payouts_csv`, `Cache-Control: no-store`, nome `repasses-AAAA-MM-DD-a-AAAA-MM-DD.csv`.

- [ ] **Step 1: Testes que falham:**
  - ações: UUID inválido, centavos não inteiros/negativos, data fora de `YYYY-MM-DD` ou no futuro, nota com quebra de linha → erro antes do banco; Admin desenvolvedor → `FINANCE_DEVELOPER_MESSAGE`; secretaria → `FINANCE_ADMIN_MESSAGE`; `ORG_MUDOU` vira a mensagem da Tarefa 9; sucesso chama `revalidatePath("/equipe/repasses")` e o aviso `org_repasse_registrado` ao organizador (só quando `kind === "repasse"`); falha do e-mail não desfaz nem muda a resposta.
  - página: Admin desenvolvedor vê tudo sem botões de gravar; secretaria é redirecionada como na página "Taxa de serviço"; totais no topo ("A pagar", "Atrasados", "Pago no período", "A receber"); aviso "Feriados de 2031 ainda não cadastrados" quando hoje ≥ 1º/11 e `calendar_until` < ano seguinte; rodapé "Calendário cadastrado até 31/12/2030"; HTML da lista **não** contém chave PIX completa nem documento (procurar pelos valores falsos no HTML renderizado).
  - e-mail `org_repasse_registrado`: "Repasse de R$ 439,05 do evento {nome} registrado em 29/10" + link para a aba Financeiro; sem chave PIX no corpo.
- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar** (espelhar `src/app/equipe/taxa-servico/*` e os componentes `MarkFeePaidButton`, `FeeAdjustmentButton`, `FinanceDialog`):
  - Lista de eventos agrupada por situação, cada cartão com organizador (nome público), prazo, "Sua parte", "Já repassado", "Saldo", selo de situação, "N pedidos com tarifa em conferência" (abre a lista de `loadPendingFees` com o botão "Lançar tarifa pelo extrato" por pedido → `ManualFeeButton`).
  - **Diálogo "Registrar repasse"** (`OrganizerPayoutDialog`): ao abrir chama `loadPayoutDetails`; mostra valor a enviar, descontos abatidos (evento e valor), chave PIX completa com botão copiar, titular e CPF/CNPJ completos, aviso em destaque "Chave alterada em dd/mm — confira com o organizador antes de enviar" se `pix_key_changed_at` < 30 dias, aviso "Dinheiro do cartão liberado até dd/mm" quando `release_until` > hoje; campos data do PIX (padrão hoje) e nota opcional ("código da transação"); confirmação digitando o valor (mesmo padrão de "Estornar todos"). Para `compensacao`, o diálogo diz "Nada a enviar: o saldo cobre o desconto pendente" e o botão vira "Registrar compensação".
  - "Organizadores que devem": cartão por organizador com valor, prazo e botão "Devolução recebida" (`RefundReceivedButton`).
  - Ajuste: botão discreto "Lançamento manual" (direção em palavras + motivo).
  - Página do evento da equipe: se `events.organizer_id` e Admin → bloco curto com situação, saldo e link "Abrir em Repasses".
  - Menu: "Repasses" abaixo de "Taxa de serviço", só para Admin (mesma condição).
- [ ] **Step 4: Rodar e passar** + `npx vitest run tests/security/action-inventory.test.ts`.
- [ ] **Step 5: Commit**

```powershell
git add src/app/equipe/repasses src/components/equipe/OrganizerPayoutDialog.tsx src/components/equipe/OrganizerAdjustmentButton.tsx src/components/equipe/RefundReceivedButton.tsx src/components/equipe/ManualFeeButton.tsx src/components/equipe/PayoutSituationBadge.tsx src/lib/email/organizer-notice-template.ts src/lib/organizer/notify.ts tests/equipe/repasses-actions.test.ts tests/equipe/repasses-page.test.tsx tests/email/organizer-notice-template.test.ts
```

  Acrescentar ao `git add` os arquivos exatos do menu e da página do evento da equipe que foram alterados (conferir com `git status --short` e listar um por um; nunca `git add .`).

```powershell
git commit -m "feat(equipe): página Repasses e registro de repasse ao organizador"
```

---

## Tarefa 12 — Trocar chave PIX (organizador e equipe)

**Files:**
- Create: `src/components/organizer/PixChangeDialog.tsx`, `src/components/equipe/PixChangeDecision.tsx`
- Modify: `src/app/organizador/conta/page.tsx` (troca o texto "Para trocar a chave PIX, fale com o Espaço Byla." pelo botão), `src/app/organizador/conta/actions.ts`, `src/app/equipe/organizadores/actions.ts` e a tela de contas, `src/lib/email/login-code-template.ts` (propósito `troca_pix`), `src/lib/email/organizer-notice-template.ts` (`org_pix_troca_pedida`, `org_pix_troca_confirmada`, `org_pix_troca_recusada`, `equipe_pix_troca_pedida`), `src/lib/organizer/notify.ts`
- Test: `tests/organizer/pix-change-actions.test.ts`, `tests/equipe/pix-change-actions.test.ts`, `tests/email/login-code-template.test.ts` (estender)

**Interfaces:**
- Organizador (`requireOrganizer` em todas): `sendPixChangeCode()` → `ActionResult<{ email: string /* mascarado */ }>`; `submitPixChange(input: { code; pixKeyType; pixKey; pixHolderName; pixHolderDocument })` → `ActionResult<{ confirmAfter: string }>`; `cancelPixChange(requestId)`.
- Equipe (`requireFinanceAdmin`): `loadPixChangeDetails(requestId)` (`write: true`), `decidePixChange(input: { requestId; approve: boolean; note?: string })` (`write: true`).

- [ ] **Step 1: Testes que falham:** código gerado com `generateLoginCode`, enviado com `sendLoginCodeEmail(..., purpose "troca_pix")`; resposta `'aguarde'`/`'limite'` vira "Aguarde 1 minuto para pedir outro código." / "Limite de códigos de hoje atingido. Tente amanhã."; quando o e-mail falha (`quota`/`failed`) a ação responde erro genérico; dados validados com `parseOrganizerProfile` (reaproveitar só os campos PIX — extrair `parsePixDetails` de `src/lib/organizer/validation.ts`, sem mudar o comportamento atual); sucesso dispara `org_pix_troca_pedida` (para o organizador: "Recebemos um pedido para trocar a chave PIX dos seus repasses. Se não foi você, cancele na sua conta e avise o Espaço Byla.") e `equipe_pix_troca_pedida` ("Troca de chave PIX pedida por {nome público}; pode ser confirmada a partir de dd/mm hh:mm"); decisão dispara confirmada/recusada; e-mails **sem** a chave nova ou antiga (só tipo); Admin desenvolvedor não decide.
- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar:** diálogo em dois passos (1. "Enviar código para o meu e-mail"; 2. código + nova chave + titular + CPF/CNPJ, com as mesmas máscaras e dicas do cadastro); depois de enviar, a página mostra "Troca pedida em dd/mm. O Espaço confirma a partir de dd/mm hh:mm. Até lá, os repasses ficam na chave atual." e o botão "Cancelar troca"; na equipe, a lista de contas mostra o selo "Troca de PIX pedida" e o botão "Ver e decidir" (abre `loadPixChangeDetails`, mostra antes/depois completos, botão "Confirmar" desativado até `confirm_after`, "Recusar" com motivo).
- [ ] **Step 4: Rodar e passar** + inventário de ações.
- [ ] **Step 5: Commit** (listar os arquivos exatos alterados, como na Tarefa 11):

```powershell
git add src/components/organizer/PixChangeDialog.tsx src/components/equipe/PixChangeDecision.tsx src/app/organizador/conta/page.tsx src/app/organizador/conta/actions.ts src/app/equipe/organizadores/actions.ts src/lib/email/login-code-template.ts src/lib/email/organizer-notice-template.ts src/lib/organizer/notify.ts src/lib/organizer/validation.ts tests/organizer/pix-change-actions.test.ts tests/equipe/pix-change-actions.test.ts tests/email/login-code-template.test.ts
git commit -m "feat(organizador): troca de chave PIX com código e confirmação do Admin"
```

---

## Tarefa 13 — Avisos diários do dinheiro (cron)

**Files:**
- Create: `src/lib/organizer/daily.ts` (`server-only`)
- Modify: `src/app/api/cron/keep-alive/route.ts`, `src/lib/email/organizer-notice-template.ts` (`org_devolucao_pendente`, `equipe_repasses_resumo`), `src/lib/organizer/notify.ts`
- Test: `tests/organizer/daily.test.ts`, `tests/api/keep-alive-route.test.ts`

**Interfaces:**
- Produces: `runOrganizerFinanceDaily(admin: SupabaseClient): Promise<{ devolucoes: number; resumo: boolean }>` (nunca lança).

- [ ] **Step 1: Testes que falham:**
  - chama `refresh_organizer_balance_flags`; para cada linha envia `org_devolucao_pendente` ("Devolva R$ 47,39 por PIX ao Espaço Byla até 09/12" + chave do Espaço do ambiente; sem a chave no ambiente, envia sem ela com "o Espaço vai te mandar a chave" e alerta a equipe) e só então `mark_balance_flag_notified`; se o envio falhar, não marca (tenta amanhã);
  - um **único** e-mail de resumo à equipe por dia (dedupe `consume_rate_limit('org-finance-summary:day', 'site', 1, 86400)`) só quando há repasse atrasado, devolução atrasada, tarifa sem conferir há mais de 2 dias ou calendário do ano seguinte faltando a partir de 1º/11: "3 repasses atrasados (R$ 1.234,56), 1 devolução atrasada, 2 tarifas a conferir" + link para `/equipe/repasses`;
  - o cron não tem usuário, então os números vêm de uma função própria `organizer_finance_daily_summary() returns jsonb` (acrescentada à Migration B, só `service_role`, sem ator), que devolve só contagens e somas (`late_payouts`, `late_payouts_cents`, `late_refunds`, `fees_pending_2d`, `calendar_until`), sem nomes nem dados pessoais.
  - falha em qualquer etapa não derruba a rota.
- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar** e acrescentar `organizer_finance_daily_summary()` à Migration B (teste estático e matriz: contagens batem com os casos 3, 7 e 8 da Tarefa 6). Ordem no cron: tarifas pendentes (Tarefa 5) → marcações/devoluções → resumo.
- [ ] **Step 4: Rodar e passar.**
- [ ] **Step 5: Commit**

```powershell
git add src/lib/organizer/daily.ts src/app/api/cron/keep-alive/route.ts src/lib/email/organizer-notice-template.ts src/lib/organizer/notify.ts supabase/migrations/20261019110000_organizer_payouts.sql tests/organizer/daily.test.ts tests/api/keep-alive-route.test.ts tests/db/organizer-finance-migrations.test.ts scripts/db-tests/organizer-finance.mjs
git commit -m "feat(organizador): avisos diários de devolução e resumo de repasses"
```

---

## Tarefa 14 — Organizador avisado em todo estorno (pendência da fase 2)

**Files:**
- Create: `src/lib/organizer/refund-notice.ts` (`server-only`)
- Modify: `src/app/equipe/eventos/order-actions.ts` (troca `notifyRefundRequester` pelo helper), `src/app/equipe/eventos/session-actions.ts` (`refundNextInBatch`), `src/lib/payments/refund.ts` (`syncOrderRefunded`, resultados `completed`/`external`), `src/lib/email/organizer-notice-template.ts` (`org_pedido_estornado`)
- Test: `tests/organizer/refund-notice.test.ts`, ajustes nos testes das ações de pedido/sessão

**Interfaces:**
- Produces: `notifyOrganizerOrderRefunded(admin: SupabaseClient, orderId: string): Promise<void>` (nunca lança): 1) `claim_refund_request_notice(orderId)` → para cada linha, `org_pedido_respondido` (pedido do organizador atendido, como hoje); 2) `claim_event_refund_notice(orderId)` → se devolveu linha e o evento tem organizador, `org_pedido_estornado` ("O pedido Nº 1234 do evento {nome} foi estornado. Se o repasse já foi feito, o valor será descontado do próximo." + link para a aba Financeiro).

- [ ] **Step 1: Testes que falham:** os três caminhos (estorno da equipe, lote "Estornar todos", estorno avisado pelo banco de pagamento) chamam o helper uma vez; chamar duas vezes envia uma vez (o banco devolve vazio na segunda); evento sem organizador não envia nada; falha de e-mail não muda a resposta da ação.
- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar e passar** — `npx vitest run tests/organizer tests/equipe tests/payments`.
- [ ] **Step 5: Commit**

```powershell
git add src/lib/organizer/refund-notice.ts src/app/equipe/eventos/order-actions.ts src/app/equipe/eventos/session-actions.ts src/lib/payments/refund.ts src/lib/email/organizer-notice-template.ts tests/organizer/refund-notice.test.ts
git commit -m "feat(organizador): aviso em todo estorno de evento de organizador"
```

  Acrescentar ao `git add` os testes de ações que foram ajustados (nomes exatos do `git status --short`).

---

## Tarefa 15 — Capas: limite diário e limpeza de órfãs (pendência da fase 2)

**Files:**
- Create: `src/lib/media/orphans.ts` (`server-only`)
- Modify: `src/lib/security/rate-limit.ts` (`organizerUploadPerUserDay: { bucket: "org-upload:user-day", limit: 20, windowSeconds: 86_400 }`, `organizerUploadSiteDay: { bucket: "org-upload:all-day", limit: 150, windowSeconds: 86_400 }`), `src/app/equipe/eventos/media-actions.ts` (`requestImageUpload` consome os dois para organizador, depois do limite por hora), `src/lib/media/storage.ts` (`listMediaObjects(prefix, { limit, offset })`), `src/app/api/cron/keep-alive/route.ts`
- Test: `tests/media/orphans.test.ts`, `tests/equipe/media-actions.test.ts` (estender)

**Interfaces:**
- Produces: `sweepOrphanCovers(admin: SupabaseClient, options?: { maxDeletes?: number; minAgeHours?: number }): Promise<{ checked: number; deleted: number }>` (nunca lança).

- [ ] **Step 1: Testes que falham:**
  - upload de capa por organizador além de 20 no dia → "Limite de envios de hoje atingido. Tente amanhã."; equipe não é afetada;
  - limpeza: lista `covers/`; mantém arquivos referenciados por qualquer `events.cover_image_url` (inclusive eventos apagados de forma suave) e os com menos de 24 h; apaga no máximo 100; se a leitura dos eventos falhar ou vier vazia de forma suspeita (erro), **não apaga nada**; nomes fora do padrão `covers/<uuid>.(webp|jpg|png)` são ignorados.
- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar** (`coverPathFromUrl` de `src/lib/media/paths.ts` para montar o conjunto de referências; `removeMediaObjects` para apagar). No cron, por último e com `try/catch` próprio.
- [ ] **Step 4: Rodar e passar.**
- [ ] **Step 5: Commit**

```powershell
git add src/lib/media/orphans.ts src/lib/media/storage.ts src/lib/security/rate-limit.ts src/app/equipe/eventos/media-actions.ts src/app/api/cron/keep-alive/route.ts tests/media/orphans.test.ts tests/equipe/media-actions.test.ts
git commit -m "feat(midia): limite diário de capas e limpeza de órfãs"
```

---

## Tarefa 16 — Textos legais e verificação final

**Files:**
- Read (mudar só se divergir): `src/components/legal/OrganizerTermsText.tsx`, página de privacidade

- [ ] **Step 1: Conferir os Termos do organizador** contra o que foi feito: tarifa real por pagamento (inclusive sobre a taxa de serviço), repasse parcial com tarifa em conferência (linha "o repasse pode ser feito com o valor conferido…"), 5 dias úteis de Salvador, desconto no próximo repasse, 30 dias + 10 dias para devolver, troca de chave PIX com confirmação do Espaço. Se o período de espera de 24 h for adotado, acrescentar uma frase: "A troca da chave PIX pode levar até 1 dia útil para ser confirmada." **Mudança de texto legal só com "pode" do dono** (e versão nova dos Termos do organizador, se ela existir como constante).
- [ ] **Step 2: Privacidade:** a tarifa não é dado pessoal; os dados de troca de PIX são os mesmos já descritos para organizadores. Nada a mudar, salvo se a conferência mostrar o contrário.
- [ ] **Step 3: Verificação completa** — `npm run lint`, `npx tsc --noEmit`, `npx vitest run`, `node scripts/db-tests/organizer-finance.mjs` e as matrizes da fase 2 (`node scripts/db-tests/organizer-accounts.mjs`, `node scripts/db-tests/service-fee.mjs`), `npm run build`, `npm audit --omit=dev`.
- [ ] **Step 4: Revisão** — rodar a revisão de código (superpowers:requesting-code-review) e a revisão de segurança sobre o diff da fase 3; corrigir o que for crítico/alto antes de publicar.
- [ ] **Step 5: Teste de tela local** com dados falsos (não há banco de testes): aba Financeiro no celular (largura 375 px) e página Repasses, nos temas claro e escuro.
- [ ] **Step 6: Commit** só se algo mudou nesta tarefa (caminhos explícitos).

---

## Publicação (cada passo só com "pode" do dono)

1. **Ensaio em produção:** declarar MCP `user-supabase-eventos` + projeto Espaço Byla Eventos, conferir a impressão digital, rodar `supabase/tests/organizer_finance_check.sql` numa única chamada `execute_sql` → precisa terminar em `ENSAIO OK`.
2. **Aplicar as migrations** na ordem `20261019100000`, `20261019110000`, `20261019120000` com `apply_migration`; depois conferir `list_migrations`, `get_advisors` (segurança) e que nenhuma tabela nova aparece para `anon`/`authenticated`.
3. **Push** de `main` (avanço rápido).
4. **Deploy** no Cloud Run (`gcloud builds submit --config=infra/cloudrun/cloudbuild.yaml`, com as substituições `NEXT_PUBLIC_*` de sempre).
5. **Ambiente:** o dono coloca `ORGANIZER_REFUND_PIX_KEY` (chave PIX do Espaço para devoluções) no Cloud Run; o agente não vê o valor.
6. **Conferência pós-deploy** (só leitura): próxima venda real do Espaço → `order_payment_fees` ganha a linha com a tarifa (Caminho A); cron das 21h10 roda sem erro nos logs; página Repasses abre para o Admin do Espaço; área do organizador continua desligada.
7. **Antes do primeiro organizador real** (decisão já tomada): revisão rápida de advogado/contador e um evento-piloto pequeno, com o repasse registrado pelo Admin do Espaço.

---

## Riscos

- **Tarifa pela API não confirmada** (spec 20): coberto pela Tarefa 1 e pelo Caminho B; mesmo no Caminho A, o Admin pode lançar à mão qualquer pedido.
- **Dinheiro do cartão ainda não liberado** quando vence o prazo de 5 dias úteis: o diálogo mostra a data de liberação; a decisão de pagar antes continua do Espaço (os Termos garantem o prazo ao organizador).
- **Estorno de pedido "pago sem vaga" já aceito**: entra nas contas como qualquer pedido pago (tarifa real inclusive). Se o dono quiser tirar a tarifa desses pedidos da parte do organizador, é mudança de regra (fora deste plano).
- **Calendário só até 2030:** aviso à equipe a partir de 1º/11 do último ano; sem cadastro, o prazo vira "Prazo a confirmar" e nada quebra.
- **Cotas de e-mail:** com organizadores reais, 100/dia pode ficar apertado em dia de venda forte; os códigos de login têm prioridade sobre avisos (cotas separadas).
- **Cron diário único:** marcação de saldo negativo e devolução andam com até 1 dia de atraso; aceitável para prazos de 30 e 10 dias.

---

## Self-review (cobertura da spec)

| Spec | Onde |
| --- | --- |
| 5.7 / 10.1 Espaço recebe tudo, sem comissão, taxa só do desenvolvedor | Tarefa 6 (`organizer_event_balance` ignora a taxa de serviço; só mostra) |
| 7.6 / 9 Tarifa real por pagamento, teste, captura, nova tentativa, estorno, manual, Plano B | Tarefas 1, 3, 4, 5, 5B, 11 |
| 7.7 Repasses imutáveis com quem/quando e foto da chave PIX | Tarefa 6 |
| 7.2 / 12.2 Troca de chave PIX com proteção | Tarefas 7 e 12 |
| 7.9 / 10.3 Calendário de Salvador 2026–2030, 5 dias úteis, "Prazo a confirmar", aviso de cadastro | Tarefas 2, 3, 11, 13 |
| 8.4 Funções e erros `ORG_*` | Tarefas 3, 6, 7, 9 |
| 10.2 Contas (exemplo R$ 439,05) | Tarefa 6, matriz caso 1; Tarefa 10 |
| 10.4 Situações | Tarefa 9 |
| 10.5 Desconto, 30 + 10 dias, devolução recebida, `ORG_DEVOLUCAO` | Tarefas 6, 13 |
| 12.2 Aba Financeiro do organizador | Tarefa 10 |
| 12.3 Página Repasses, CSV, dados completos só no diálogo | Tarefa 11 |
| 14 E-mails | Tarefas 5, 11, 12, 13, 14 |
| Pendências da fase 2 (aviso em todo estorno, cota de login separada, capas) | Tarefas 7, 14, 15 |

---

## Execução

- Recomendado: superpowers:subagent-driven-development, uma tarefa por subagente, com revisão entre tarefas. Ordem obrigatória: 1 → 2 → 3 → (4 e 5, ou 5B) → 6 → 7 → 8 → 9 → (10, 11 e 12 podem andar em paralelo) → 13 → 14 → 15 → 16. As Tarefas 14 e 15 só dependem da 7 e podem ser adiantadas.
- Esforço estimado: 4 a 5 dias de trabalho do agente, mais o tempo do dono para o teste da Tarefa 1 (credenciais de teste) e para os "pode" da publicação.
- A área do organizador continua desligada durante toda a fase; a captura da tarifa passa a valer para todas as vendas logo depois do deploy.

---

## Resultado do teste da tarifa (preencher na Tarefa 1)

- Data do teste:
- Caminho que achou o pagamento (a / b / c / nenhum):
- `transaction_amount − net_received_amount` bate com `fee_details` (collector)? 
- `money_release_date` presente?
- Depois do estorno total: tarifa devolvida? Como aparece na resposta?
- Decisão: Caminho A / Caminho B
