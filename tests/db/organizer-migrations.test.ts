import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

function migration(name: string) {
  return readFileSync(path.resolve(__dirname, "../../supabase/migrations", name), "utf8")
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
}

const accounts = migration("20261018100000_organizer_accounts.sql");
const NEW_TABLES = [
  "organizer_settings",
  "organizer_profiles",
  "organizer_signup_requests",
  "organizer_invites",
  "organizer_ops_requests",
  "audit_log",
];

function functionBodies(sql: string) {
  return [...sql.matchAll(/create (?:or replace )?function public\.(\w+)\(([\s\S]*?)\$\$;/g)].map(
    (match) => ({ name: match[1], text: match[0] }),
  );
}

describe("migration organizer_accounts", () => {
  it.each(NEW_TABLES)("%s tem RLS ligada e nenhum acesso direto por padrão", (table) => {
    expect(accounts).toContain(`alter table public.${table} enable row level security;`);
    expect(accounts).toMatch(
      new RegExp(`revoke all on table public\\.${table} from public, anon, authenticated, service_role;`),
    );
  });

  it("só organizer_profiles tem política, e só de leitura do próprio com sessão verificada", () => {
    const policies = [...accounts.matchAll(/create policy (\w+) on public\.(\w+)/g)].map((m) => m[2]);
    expect(policies).toEqual(["organizer_profiles"]);
    expect(accounts).toMatch(
      /create policy organizer_profiles_self_read on public\.organizer_profiles\s+for select to authenticated\s+using \(user_id = \(select auth\.uid\(\)\) and public\.is_organizer\(\)\);/,
    );
  });

  it("toda função fixa search_path vazio e tem revoke de public/anon/authenticated", () => {
    for (const fn of functionBodies(accounts)) {
      expect(fn.text, fn.name).toContain("set search_path = ''");
      expect(accounts, fn.name).toMatch(
        new RegExp(`revoke all on function public\\.${fn.name}\\([^)]*\\) from public, anon, authenticated`),
      );
    }
  });

  it("is_organizer e owns_event exigem sessão verificada", () => {
    const isOrganizer = functionBodies(accounts).find((fn) => fn.name === "is_organizer");
    expect(isOrganizer?.text).toContain("public.session_is_verified()");
    const owns = functionBodies(accounts).find((fn) => fn.name === "owns_event");
    expect(owns?.text).toContain("public.is_organizer()");
  });

  it("convite e código do e-mail guardam só hashes", () => {
    expect(accounts).toMatch(/token_hash text not null unique check \(token_hash ~ '\^\[0-9a-f\]\{64\}\$'\)/);
    expect(accounts).toMatch(/email_code_hash text/);
    expect(accounts).not.toMatch(/\btoken text\b/);
    expect(accounts).not.toMatch(/\bemail_code text\b/);
  });

  it("gatilho protege dono, aprovação e venda de evento de organizador", () => {
    expect(accounts).toMatch(/create trigger events_guard_organizer\s+before insert or update on public\.events/);
    expect(accounts).toContain("byla.organizer_flow");
  });

  it("funções sensíveis só para service_role", () => {
    for (const name of [
      "accept_organizer_invite",
      "create_organizer_invite",
      "decide_event_approval",
      "actor_event_access",
      "start_invite_email_code",
    ]) {
      expect(accounts).toMatch(new RegExp(`grant execute on function public\\.${name}\\([^)]*\\) to service_role;`));
      expect(accounts).not.toMatch(new RegExp(`grant execute on function public\\.${name}\\([^)]*\\) to [^;]*(anon|authenticated)`));
    }
  });

  it("histórico é imutável", () => {
    expect(accounts).toMatch(/create trigger audit_log_immutable\s+before update or delete on public\.audit_log/);
    expect(accounts).toMatch(/create trigger audit_log_no_truncate\s+before truncate on public\.audit_log/);
  });
});
