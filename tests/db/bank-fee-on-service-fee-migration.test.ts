import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

function migration(name: string) {
  return readFileSync(path.resolve(__dirname, "../../supabase/migrations", name), "utf8")
    .replaceAll("\r\n", "\n");
}

const sql = migration("20261021110000_bank_fee_on_service_fee.sql");

function body(name: string) {
  const match = sql.match(new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?\\$\\$;`));
  return match?.[0] ?? "";
}

describe("migration bank_fee_on_service_fee", () => {
  it("não cria tabela e só recria as funções de saldo e de repasse", () => {
    expect(sql).not.toMatch(/create table/i);
    expect([...sql.matchAll(/create or replace function public\.(\w+)/g)].map((m) => m[1])).toEqual([
      "organizer_event_balance",
      "event_fee_balance",
      "record_organizer_payout",
      "refresh_organizer_balance_flags",
      "organizer_overdue_refunds",
    ]);
  });

  it("parte do organizador soma os ingressos válidos, com ou sem tarifa", () => {
    const fn = body("organizer_event_balance");
    expect(fn).toContain("security definer");
    expect(fn).toContain("set search_path = ''");
    const shareLine = fn.split("\n").find((line) => line.includes("as share"));
    expect(shareLine).toContain("coalesce(sum(c.sub) filter (where c.keeps), 0)::bigint as share");
    expect(shareLine).not.toContain("c.known");
    expect(fn).toContain("coalesce(sum(c.fee) filter (where c.known), 0)::bigint as fee");
    expect(fn).toContain("0::bigint, t.share, p.v, t.share - p.v");
  });

  it("saldo da taxa desconta a tarifa conhecida e mantém fee_due bruto", () => {
    const fn = body("event_fee_balance");
    expect(fn).toContain("s.fee_due, p.v");
    expect(fn).toContain("s.fee_due - s.bank_fee - p.v");
    expect(fn).toContain("o.status in ('pago', 'estornado')");
  });

  it("repasse e dívida do organizador não esperam a tarifa", () => {
    expect(body("record_organizer_payout")).not.toContain("ORG_TARIFA_PENDENTE");
    expect(body("record_organizer_payout")).toContain("ORG_NADA");
    expect(body("record_organizer_payout")).toContain("ORG_PIX_PENDENTE");
    expect(body("refresh_organizer_balance_flags")).not.toContain("pending_fee_orders");
    expect(body("organizer_overdue_refunds")).not.toContain("pending_fee_orders");
  });
});
