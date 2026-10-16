import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(process.cwd(), "supabase/migrations/20261020100000_revoke_excess_table_grants.sql"),
  "utf8",
);
const statements = sql
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n")
  .toLowerCase();

describe("migration revoke_excess_table_grants", () => {
  it("nunca devolve TRUNCATE, TRIGGER ou REFERENCES a anon/authenticated", () => {
    for (const forbidden of ["truncate", "trigger", "references"]) {
      expect(statements).not.toMatch(new RegExp(`grant[^;]*\\b${forbidden}\\b`));
    }
  });

  it("anon só lê eventos e tipos, e não toca staff_profiles", () => {
    expect(statements).toContain("grant select on table public.events to anon;");
    expect(statements).toContain("grant select on table public.ticket_types to anon;");
    expect(statements).not.toMatch(/grant[^;]*public\.staff_profiles to[^;]*anon/);
  });

  it("a equipe mantém só o necessário e staff_profiles fica somente leitura", () => {
    expect(statements).toContain(
      "grant select, insert, update, delete on table public.events to authenticated;",
    );
    expect(statements).toContain(
      "grant select, insert, update, delete on table public.ticket_types to authenticated;",
    );
    expect(statements).toContain("grant select on table public.staff_profiles to authenticated;");
  });

  it("avisa que só se aplica com o pode do dono", () => {
    expect(sql).toMatch(/NÃO aplicar sem o "pode"/);
  });
});
