import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { holidaySeedSql } from "@/lib/finance/business-days";

function migration(name: string) {
  return readFileSync(path.resolve(__dirname, "../../supabase/migrations", name), "utf8")
    .replaceAll("\r\n", "\n")
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
}

function functionBodies(sql: string) {
  return [...sql.matchAll(/create (?:or replace )?function public\.(\w+)\(([\s\S]*?)\$\$;/g)].map(
    (match) => ({ name: match[1], text: match[0] }),
  );
}

function actionList(sql: string, opening: RegExp) {
  const start = sql.search(opening);
  expect(start, "lista de ações não encontrada").toBeGreaterThanOrEqual(0);
  const list = sql.slice(start, sql.indexOf("))", start));
  return [...list.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
}

const fees = migration("20261019100000_payment_fees_calendar.sql");
const accounts = migration("20261018100000_organizer_accounts.sql");

const PHASE3_ACTIONS = [
  "tarifa_lancada", "repasse_registrado", "repasse_compensado", "repasse_ajuste",
  "devolucao_recebida", "devolucao_pendente",
  "pix_troca_pedida", "pix_troca_cancelada", "pix_troca_confirmada", "pix_troca_recusada",
];

describe("migration payment_fees_calendar", () => {
  it("cria só as tabelas order_payment_fees e business_holidays", () => {
    const tables = [...fees.matchAll(/create table public\.(\w+)/g)].map((m) => m[1]);
    expect(tables).toEqual(["order_payment_fees", "business_holidays"]);
  });

  it.each(["order_payment_fees", "business_holidays"])("%s tem RLS ligada e nenhum acesso direto", (table) => {
    expect(fees).toContain(`alter table public.${table} enable row level security;`);
    expect(fees).toContain(`revoke all on table public.${table} from public, anon, authenticated, service_role;`);
    expect(fees).not.toMatch(new RegExp(`create policy \\w+ on public\\.${table}`));
    expect(fees).not.toMatch(new RegExp(`grant [^;]* on table public\\.${table}`));
  });

  it("toda função é security definer, search_path vazio e só service_role executa", () => {
    const fns = functionBodies(fees);
    expect(fns.map((fn) => fn.name).sort()).toEqual([
      "business_calendar_last_year", "event_fee_pending_orders", "event_payout_due_date", "nth_business_day",
      "order_has_bank_fee", "orders_missing_fee", "record_event_fee_total", "record_payment_fee",
      "record_payment_fee_failure", "record_payment_fee_manual",
    ]);
    for (const fn of fns) {
      expect(fn.text, fn.name).toContain("security definer");
      expect(fn.text, fn.name).toContain("set search_path = ''");
      expect(fees, fn.name).toMatch(
        new RegExp(`revoke execute on function public\\.${fn.name}\\([^)]*\\) from public, anon, authenticated;`),
      );
      expect(fees, fn.name).toMatch(new RegExp(`grant execute on function public\\.${fn.name}\\([^)]*\\) to service_role;`));
      expect(fees, fn.name).not.toMatch(
        new RegExp(`grant execute on function public\\.${fn.name}\\([^)]*\\) to [^;]*(anon|authenticated)`),
      );
    }
  });

  it("tarifa: gatilho bloqueia só apagar e truncate (as funções atualizam a linha)", () => {
    expect(fees).toMatch(
      /create trigger \w+\s+before delete on public\.order_payment_fees\s+for each row execute function public\.reject_finance_record_change\(\);/,
    );
    expect(fees).toMatch(
      /create trigger \w+\s+before truncate on public\.order_payment_fees\s+for each statement execute function public\.reject_finance_record_change\(\);/,
    );
    expect(fees).not.toMatch(/before (?:insert or )?update[^;]* on public\.order_payment_fees/);
  });

  it("feriados: gatilho bloqueia alterar, apagar e truncate", () => {
    expect(fees).toMatch(
      /create trigger \w+\s+before update or delete on public\.business_holidays\s+for each row execute function public\.reject_finance_record_change\(\);/,
    );
    expect(fees).toMatch(
      /create trigger \w+\s+before truncate on public\.business_holidays\s+for each statement execute function public\.reject_finance_record_change\(\);/,
    );
  });

  it("carga de feriados é exatamente holidaySeedSql(2026, 2030), antes dos gatilhos", () => {
    const seed = holidaySeedSql(2026, 2030);
    expect(fees).toContain(seed);
    expect(fees.split("insert into public.business_holidays").length - 1).toBe(1);
    expect(fees.indexOf(seed)).toBeLessThan(fees.search(/create trigger \w+\s+before update or delete on public\.business_holidays/));
  });

  it("histórico aceita todas as ações atuais e as novas da fase 3", () => {
    expect(fees).toContain("alter table public.audit_log drop constraint audit_log_action_check;");
    const current = actionList(accounts, /action text not null check \(action in \(/);
    const next = actionList(fees, /add constraint audit_log_action_check check \(action in \(/);
    expect(current.length).toBeGreaterThan(20);
    expect(next.sort()).toEqual([...new Set([...current, ...PHASE3_ACTIONS])].sort());
  });

  it("tarifa só para pedido pago pelo banco de pagamento", () => {
    const has = functionBodies(fees).find((fn) => fn.name === "order_has_bank_fee");
    expect(has?.text).toContain("o.status in ('pago', 'estornado', 'aguardando_decisao')");
    expect(has?.text).toContain("o.payment_provider = 'mercadopago'");
    expect(has?.text).toContain("o.total_cents > 0");
  });

  it("lançamento manual exige Admin que grava e registra no histórico", () => {
    const manual = functionBodies(fees).find((fn) => fn.name === "record_payment_fee_manual");
    expect(manual?.text).toContain("public.assert_finance_admin(p_admin, true)");
    expect(manual?.text).toContain("'tarifa_lancada'");
    const pending = functionBodies(fees).find((fn) => fn.name === "event_fee_pending_orders");
    expect(pending?.text).toContain("public.assert_finance_admin(p_admin, false)");
  });

  it("tarifa automática: 'manual' antes das checagens de valor, tarifa menor que o bruto e detalhamento limitado", () => {
    const auto = functionBodies(fees).find((fn) => fn.name === "record_payment_fee")?.text ?? "";
    const manualCheck = auto.indexOf("v_current.source = 'manual'");
    expect(manualCheck).toBeGreaterThan(0);
    expect(manualCheck).toBeLessThan(auto.indexOf("TARIFA_VALOR"));
    expect(auto).toContain("p_fee_cents >= p_gross_cents");
    expect(auto).toContain("octet_length(p_breakdown::text) > 2000");
    expect(auto).toMatch(/for update/);
  });

  it.each(["record_payment_fee", "record_payment_fee_manual", "record_event_fee_total"])(
    "%s só marca a reconferência de estorno em pedido já estornado",
    (name) => {
      const fn = functionBodies(fees).find((f) => f.name === name)?.text ?? "";
      expect(fn).toMatch(/case when [^;]*= 'estornado'[^;]* then now\(\) end/);
      expect(fn).not.toMatch(/refund_checked_at = now\(\)/);
    },
  );

  it("tarifa do evento pelo extrato: Admin que grava, trava o organizador e histórico só com valores", () => {
    const total = functionBodies(fees).find((fn) => fn.name === "record_event_fee_total")?.text ?? "";
    expect(total).toContain("public.assert_finance_admin(p_admin, true)");
    expect(total).toContain("pg_advisory_xact_lock(hashtextextended('organizer_payout:' || v_organizer::text, 0))");
    expect(total).toContain("public.order_has_bank_fee(o.id)");
    expect(total).toContain("for update");
    for (const code of ["TARIFA_VALOR", "TARIFA_NOTA", "TARIFA_NADA"]) expect(total).toContain(code);
    expect(total).toContain("'tarifa_lancada'");
    expect(total).toContain("jsonb_build_object('total_fee_cents', p_total_fee_cents, 'orders', v_count)");
    expect(total).toContain("source = 'manual'");
    expect(total).toMatch(/do update set[\s\S]*?where f\.fee_cents is null;/);
  });

  it("tarifa do evento confere a lista que a tela mostrou (TARIFA_NADA antes de TARIFA_MUDOU)", () => {
    const total = functionBodies(fees).find((fn) => fn.name === "record_event_fee_total")?.text ?? "";
    expect(total).toContain(
      "p_admin uuid, p_event_id uuid, p_expected_orders integer, p_expected_pending_cents bigint, p_total_fee_cents integer, p_note text",
    );
    expect(total).toContain("v_count is distinct from p_expected_orders or v_sum is distinct from p_expected_pending_cents");
    expect(total).toContain("raise exception 'TARIFA_MUDOU:%', v_count;");
    expect(total.indexOf("TARIFA_NADA")).toBeLessThan(total.indexOf("TARIFA_MUDOU"));
    expect(total.indexOf("TARIFA_MUDOU")).toBeLessThan(total.indexOf("O total passa do valor"));
    expect(fees).toContain(
      "revoke execute on function public.record_event_fee_total(uuid, uuid, integer, bigint, integer, text) from public, anon, authenticated;",
    );
    expect(fees).toContain(
      "grant execute on function public.record_event_fee_total(uuid, uuid, integer, bigint, integer, text) to service_role;",
    );
  });

  it("lançamento manual trava o dinheiro do organizador antes de travar o pedido", () => {
    const manual = functionBodies(fees).find((fn) => fn.name === "record_payment_fee_manual")?.text ?? "";
    const lock = manual.indexOf("pg_advisory_xact_lock(hashtextextended('organizer_payout:' || v_organizer::text, 0))");
    expect(lock).toBeGreaterThan(0);
    expect(lock).toBeLessThan(manual.indexOf("for update"));
  });

  it("valores em centavos inteiros (sem numeric/float)", () => {
    expect(fees).not.toMatch(/\b(numeric|real|double precision|float\d?|money)\b/);
  });
});
