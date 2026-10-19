import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

function migration(name: string) {
  return readFileSync(path.resolve(__dirname, "../../supabase/migrations", name), "utf8").replaceAll(
    "\r\n",
    "\n",
  );
}

const sql = migration("20261019203707_payment_method_fees.sql");

describe("migration payment_method_fees", () => {
  it("adiciona colunas e flag desligada, sem alterar rate_bps vigente", () => {
    expect(sql).toContain("card_rate_bps integer not null default 1000");
    expect(sql).toContain("pix_rate_bps integer not null default 556");
    expect(sql).toContain("per_method_enabled boolean not null default false");
    expect(sql).not.toMatch(/update\s+public\.service_fee_settings\s+set\s+rate_bps/i);
    expect(sql).not.toMatch(/per_method_enabled\s*=\s*true/i);
  });

  it("expõe service_fee_policy e set_order_payment_method só para service_role", () => {
    expect(sql).toContain("drop function if exists public.service_fee_policy();");
    expect(sql).toContain("create or replace function public.service_fee_policy()");
    expect(sql).toContain("create or replace function public.set_order_payment_method(");
    expect(sql).toMatch(
      /revoke all on function public\.set_order_payment_method\(uuid, text\) from public, anon, authenticated/,
    );
    expect(sql).toMatch(
      /grant execute on function public\.set_order_payment_method\(uuid, text\) to service_role/,
    );
  });

  it("reprecificação só via GUC app.allow_fee_reprice", () => {
    expect(sql).toContain("app.allow_fee_reprice");
    expect(sql).toContain("TAXA_IMUTAVEL");
  });

  it("inclui reaceite dos Termos do organizador", () => {
    expect(sql).toContain("accept_organizer_terms");
  });
});
