import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

function migration(name: string) {
  return readFileSync(path.resolve(__dirname, "../../supabase/migrations", name), "utf8")
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
}

const setup = migration("20261017100000_staff_email_code.sql");
const enforce = migration("20261017110000_staff_email_code_enforce.sql");
const TABLES = ["login_email_codes", "verified_sessions", "trusted_devices"];

function functionBodies(sql: string) {
  return [...sql.matchAll(/create (?:or replace )?function public\.(\w+)\(([\s\S]*?)\$\$;/g)].map(
    (match) => ({ name: match[1], text: match[0] }),
  );
}

describe("migration staff_email_code (tabelas e funções)", () => {
  it.each(TABLES)("%s tem RLS ligada, sem acesso direto e sem políticas", (table) => {
    expect(setup).toContain(`alter table public.${table} enable row level security;`);
    expect(setup).toMatch(
      new RegExp(`revoke all on table public\\.${table} from public, anon, authenticated, service_role;`),
    );
  });

  it("não cria nenhuma política", () => {
    expect(setup).not.toMatch(/create policy/i);
    expect(enforce).not.toMatch(/create policy/i);
  });

  it("guarda só hashes: nenhuma coluna de código ou token em claro", () => {
    expect(setup).toMatch(/code_hash text not null/);
    expect(setup).toMatch(/token_hash text not null unique/);
    expect(setup).not.toMatch(/\bcode text\b/);
    expect(setup).not.toMatch(/\btoken text\b/);
  });

  it("toda função fixa search_path vazio", () => {
    const fns = functionBodies(setup + enforce);
    expect(fns.length).toBeGreaterThanOrEqual(9);
    for (const fn of fns) expect(fn.text, fn.name).toMatch(/set search_path = ''/);
  });

  it("emitir código e limpar só com service_role", () => {
    for (const signature of ["issue_login_code(uuid, uuid, text)", "purge_login_verification()"]) {
      const escaped = signature.replace(/[()]/g, "\\$&");
      expect(setup).toMatch(
        new RegExp(`revoke all on function public\\.${escaped} from public, anon, authenticated;`),
      );
      expect(setup).toMatch(new RegExp(`grant execute on function public\\.${escaped} to service_role;`));
      expect(setup).not.toMatch(new RegExp(`grant execute on function public\\.${escaped} to [^;]*authenticated`));
    }
  });

  it("funções da sessão do usuário só para authenticated (nunca anon)", () => {
    for (const signature of [
      "login_session_state()",
      "verify_login_code(text, text, text)",
      "verify_session_with_device(text)",
      "end_login_verification()",
    ]) {
      const escaped = signature.replace(/[()]/g, "\\$&");
      expect(setup).toMatch(
        new RegExp(`revoke all on function public\\.${escaped} from public, anon, authenticated;`),
      );
      expect(setup).toMatch(new RegExp(`grant execute on function public\\.${escaped} to authenticated;`));
    }
    expect(setup).not.toMatch(/to anon/);
  });

  it("código: 10 minutos, 5 tentativas, espera de 60 s e limites por conta e geral", () => {
    expect(setup).toContain("interval '10 minutes'");
    expect(setup).toMatch(/attempts smallint not null default 0 check \(attempts between 0 and 5\)/);
    expect(setup).toContain("interval '60 seconds'");
    expect(setup).toMatch(/'login-code:user-hour', v_key, 5, 3600/);
    expect(setup).toMatch(/'login-code:user-day', v_key, 10, 86400/);
    expect(setup).toMatch(/'login-code:all-day', [^,]+, 40, 86400/);
  });

  it("aparelho lembrado vale 30 dias; sessão sem lembrar vale 12 horas", () => {
    expect(setup).toContain("interval '30 days'");
    expect(setup).toContain("interval '12 hours'");
  });

  it("a sessão precisa existir em auth.sessions para contar como verificada", () => {
    const fn = functionBodies(setup).find((f) => f.name === "session_is_verified");
    expect(fn?.text).toMatch(/join auth\.sessions s on s\.id = v\.session_id and s\.user_id = v\.user_id/);
    expect(fn?.text).toMatch(/v\.expires_at > now\(\)/);
  });

  it("não mexe em is_staff/is_admin (isso fica para a migration enforce)", () => {
    expect(setup).not.toMatch(/function public\.is_staff\(/);
    expect(setup).not.toMatch(/function public\.is_admin\(/);
  });
});

describe("migration staff_email_code_enforce", () => {
  it("is_staff e is_admin passam a exigir sessão verificada", () => {
    const fns = functionBodies(enforce);
    const isStaff = fns.find((f) => f.name === "is_staff");
    const isAdmin = fns.find((f) => f.name === "is_admin");
    expect(isStaff?.text).toMatch(/public\.session_is_verified\(\)/);
    expect(isAdmin?.text).toMatch(/public\.session_is_verified\(\)/);
    expect(isAdmin?.text).toMatch(/sp\.role = 'admin'/);
  });

  it("mantém assinatura e permissões (create or replace, sem drop)", () => {
    expect(enforce).not.toMatch(/drop function/i);
    expect(enforce).toMatch(/create or replace function public\.is_staff\(\)/);
    expect(enforce).toMatch(/create or replace function public\.is_admin\(\)/);
  });
});
