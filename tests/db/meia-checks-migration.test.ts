import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..");
const FILE = "20261127180000_meia_checks.sql";
const raw = readFileSync(join(ROOT, "supabase", "migrations", FILE), "utf8");
const sql = raw.replace(/--.*$/gm, "").toLowerCase();

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

describe("migration da conferência de meia", () => {
  it("idempotente (pode rodar de novo)", () => {
    expect(sql).toContain("create table if not exists public.meia_checks");
    expect(sql).toContain("drop policy if exists meia_checks_staff_read");
    expect(sql).toContain("create or replace function public.record_meia_check(");
    expect(sql).toContain("create or replace function public.meia_check_summary(");
    expect(sql).not.toMatch(/create index (?!if not exists)/);
  });

  it("funções SECURITY DEFINER com search_path vazio e as checagens da portaria", () => {
    expect(sql.match(/security definer\s+set search_path = ''/g)?.length).toBe(2);
    expect(sql).toContain("public.session_is_verified()");
    expect(sql).toContain("public.actor_event_access(v_uid");
    expect(sql).toMatch(/where t\.id = p_ticket_id for update/);
    expect(sql).toContain("v_ticket.kind <> 'meia'");
    expect(sql).toContain("v_ticket.status <> 'check_in'");
  });

  it("recusado desfaz o check-in na mesma função", () => {
    expect(sql).toMatch(/if p_result = 'recusado' then\s+update public\.tickets t\s+set status = 'pago',\s+checked_in_at = null,\s+checked_in_by = null/);
  });

  it("permissões mínimas: só authenticated; nada para anon nem service_role", () => {
    expect(sql).toContain("revoke all on table public.meia_checks from public, anon, authenticated, service_role;");
    expect(sql).toContain("grant select on table public.meia_checks to authenticated;");
    expect(sql).toContain("grant execute on function public.record_meia_check(uuid, uuid, text) to authenticated;");
    expect(sql).toContain("grant execute on function public.meia_check_summary(uuid, uuid) to authenticated;");
    expect(sql).not.toMatch(/grant[^;]*to[^;]*\b(anon|service_role)\b/);
    expect(sql).not.toMatch(/grant (insert|update|delete)[^;]*meia_checks/);
    expect(sql).toContain("using (public.is_staff())");
  });

  it("não mexe na função de check-in", () => {
    expect(sql).not.toContain("check_in_ticket");
  });

  it("o código nunca usa o service_role para a conferência", () => {
    const offenders: string[] = [];
    for (const file of walk(join(ROOT, "src"))) {
      if (file.endsWith(join("types", "database.ts"))) continue;
      const src = readFileSync(file, "utf8");
      if (!/meia_checks|record_meia_check|meia_check_summary/.test(src)) continue;
      if (/createAdminClient|@\/lib\/supabase\/admin/.test(src)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});
