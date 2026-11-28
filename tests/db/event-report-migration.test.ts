import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const FILE = "20261128160000_event_report.sql";
const raw = readFileSync(join(__dirname, "..", "..", "supabase", "migrations", FILE), "utf8");
const sql = raw.replace(/--.*$/gm, "").toLowerCase();

function section(name: string): string {
  const start = raw.indexOf(`-- @@${name}`);
  const end = raw.indexOf(`-- @@end ${name}`);
  return raw.slice(start, end).replace(/--.*$/gm, "").toLowerCase();
}

describe("migration do relatório do evento", () => {
  it("cria as três funções e o registro da exportação, sem mexer no check-in", () => {
    expect(sql).toContain("create or replace function public.event_report(");
    expect(sql).toContain("create or replace function public.event_report_finance(");
    expect(sql).toContain("create or replace function public.event_report_organizer(");
    expect(sql).toContain("create or replace function public.log_event_report_export(");
    expect(sql).not.toContain("check_in_ticket");
    expect(sql).not.toContain("record_meia_check");
    expect(sql).not.toMatch(/create index (?!if not exists)/);
  });

  it("é security definer, confere a sessão e não devolve dado pessoal", () => {
    expect(sql.match(/security definer/g)?.length).toBe(4);
    expect(sql.match(/set search_path = ''/g)?.length).toBe(4);
    expect(sql).toContain("auth.uid()");
    expect(sql).toContain("public.session_is_verified()");
    expect(sql).toContain("public.actor_event_access(");
    expect(sql).not.toMatch(/buyer_name|buyer_email|buyer_phone|public_token/);
  });

  it("lotação tira a capacitação e a casadinha conta pessoas", () => {
    expect(sql).toContain("tt.unlock_code_hash is not null");
    expect(sql).toContain("count(*) filter (where not v.outside)");
    expect(sql).toContain("ceil(x.people::numeric / greatest(x.people_per_unit, 1))");
  });

  it("o dinheiro completo reusa os saldos e a tarifa sai da taxa", () => {
    expect(sql).toContain("public.organizer_event_balance(p_event_id)");
    expect(sql).toContain("public.event_fee_balance(p_event_id)");
    expect(sql).toContain("public.assert_finance_admin(p_actor, false)");
    expect(sql).toContain("'provider_fee_cents'");
    expect(sql).toContain("'net_fee_cents'");
    expect(sql).toContain("coalesce(v_fee_due, 0) - coalesce(v_fee_balance, 0) - coalesce(v_fee_paid, 0)");
  });

  it("a função do organizador não lê tarifa nem devolve taxa líquida", () => {
    const organizer = section("event_report_organizer");
    expect(organizer).toContain("v_access is distinct from 'dono'");
    expect(organizer).toContain("'you_receive_cents'");
    expect(organizer).toContain("'service_fee_cents'");
    expect(organizer).not.toContain("order_payment_fees");
    expect(organizer).not.toContain("provider_fee");
    expect(organizer).not.toContain("net_fee");
    expect(organizer).not.toContain("bank_fee");
    expect(organizer).not.toContain("assert_finance_admin");
  });

  it("só authenticated executa", () => {
    expect(sql).toContain("grant execute on function public.event_report(uuid, uuid) to authenticated;");
    expect(sql).toContain("grant execute on function public.event_report_finance(uuid, uuid) to authenticated;");
    expect(sql).toContain("grant execute on function public.event_report_organizer(uuid, uuid) to authenticated;");
    expect(sql).toContain("grant execute on function public.log_event_report_export(uuid, uuid, text) to authenticated;");
    expect(sql).not.toMatch(/grant[^;]*to[^;]*\b(anon|service_role)\b/);
    expect(sql).toContain("'relatorio_exportado'");
  });
});
