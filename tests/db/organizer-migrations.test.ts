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

  it("nome e local comparados e gravados sem espaços nas pontas (dono)", () => {
    const fns = functionBodies(accounts);
    const violations = fns.find((fn) => fn.name === "organizer_change_violations");
    expect(violations?.text).toContain("btrim(coalesce(p_name, '')) is distinct from btrim(coalesce(v_event.name, ''))");
    expect(violations?.text).toContain("btrim(coalesce(p_venue, '')) is distinct from btrim(coalesce(v_event.venue, ''))");
    const create = fns.find((fn) => fn.name === "create_organizer_event");
    expect(create?.text).toMatch(/p_slug, btrim\(p_name\), btrim\(p_venue\)/);
    const save = fns.find((fn) => fn.name === "save_event_with_sessions");
    expect(save?.text).toContain("name = case when v_access = 'dono' then btrim(p_name) else p_name end");
    expect(save?.text).toContain("venue = case when v_access = 'dono' then btrim(p_venue) else p_venue end");
  });

  it("endereço repetido do evento vira ORG_DADOS:slug", () => {
    const create = functionBodies(accounts).find((fn) => fn.name === "create_organizer_event");
    expect(create?.text).toMatch(/exception when unique_violation then\s+raise exception 'ORG_DADOS:slug';/);
  });

  it("aprovar reconfere os critérios do envio", () => {
    const fns = functionBodies(accounts);
    for (const name of ["submit_event_for_approval", "decide_event_approval"]) {
      expect(fns.find((fn) => fn.name === name)?.text, name).toContain(
        "public.organizer_submission_problem(p_event_id)",
      );
    }
    const problem = fns.find((fn) => fn.name === "organizer_submission_problem");
    for (const code of ["ORG_ESTADO:capa", "ORG_ESTADO:sem_sessao_futura", "ORG_LOTACAO:", "ORG_ESTADO:sem_preco"]) {
      expect(problem?.text).toContain(code);
    }
    expect(accounts).not.toMatch(/grant execute on function public\.organizer_submission_problem/);
  });

  it("esquecer aparelho derruba as outras sessões verificadas e mantém a atual", () => {
    const forget = functionBodies(accounts).find((fn) => fn.name === "forget_my_device");
    expect(forget?.text).toMatch(
      /delete from public\.verified_sessions v\s+where v\.user_id = \(select auth\.uid\(\)\)\s+and v\.session_id is distinct from public\.current_session_id\(\);/,
    );
  });

  it("lista de organizadores: chave PIX CPF/CNPJ mostra só os dígitos que a máscara do documento já mostra", () => {
    const list = (functionBodies(accounts).find((fn) => fn.name === "list_organizers")?.text ?? "").replace(/\s+/g, " ");
    expect(list).toContain(
      "when op.pix_key_type = 'cpf' then '•••.' || substr(op.pix_key, 4, 3) || '.' || substr(op.pix_key, 7, 3) || '-••'",
    );
    expect(list).toContain(
      "when op.pix_key_type = 'cnpj' then '••.•••.' || substr(op.pix_key, 6, 3) || '/' || substr(op.pix_key, 9, 4) || '-••'",
    );
    expect(list).toContain(
      "'•••.' || substr(op.pix_holder_document, 4, 3) || '.' || substr(op.pix_holder_document, 7, 3) || '-••'",
    );
    expect(list).toContain("when op.pix_key_type = 'email' then '•••@' || split_part(op.pix_key, '@', 2)");
    expect(list.indexOf("when op.pix_key_type = 'cnpj'")).toBeLessThan(list.indexOf("else '•••• ' || right(op.pix_key, 4)"));
  });

  it("histórico é imutável", () => {
    expect(accounts).toMatch(/create trigger audit_log_immutable\s+before update or delete on public\.audit_log/);
    expect(accounts).toMatch(/create trigger audit_log_no_truncate\s+before truncate on public\.audit_log/);
  });
});

const operations = migration("20261018110000_organizer_operations.sql");

describe("migration organizer_operations", () => {
  it("não cria tabela nem política nova", () => {
    expect(operations).not.toMatch(/create table/i);
    expect(operations).not.toMatch(/create policy/i);
  });

  it("toda função fixa search_path vazio e só service_role executa", () => {
    for (const fn of functionBodies(operations)) {
      expect(fn.text, fn.name).toContain("set search_path = ''");
      expect(operations, fn.name).not.toMatch(
        new RegExp(`grant execute on function public\\.${fn.name}\\([^)]*\\) to [^;]*(anon|authenticated)`),
      );
    }
  });

  it("toda função (das duas migrations) tem revoke de public/anon/authenticated", () => {
    const all = functionBodies(operations);
    expect(all.length).toBeGreaterThan(10);
    for (const fn of all) {
      expect(operations, fn.name).toMatch(
        new RegExp(`revoke all on function public\\.${fn.name}\\([^)]*\\) from public, anon, authenticated`),
      );
    }
    for (const fn of functionBodies(accounts)) {
      expect(accounts, fn.name).toMatch(
        new RegExp(`revoke all on function public\\.${fn.name}\\([^)]*\\) from public, anon, authenticated`),
      );
    }
  });

  it("portaria usa actor_event_access e remove a assinatura antiga", () => {
    expect(operations).toMatch(/drop function if exists public\.check_in_ticket\(uuid, text, uuid\);/);
    const checkIn = functionBodies(operations).find((fn) => fn.name === "check_in_ticket");
    expect(checkIn?.text).toContain("public.actor_event_access(p_staff_user_id, p_event_id)");
  });

  it("lista de compradores nunca devolve telefone, link do pedido, código do ingresso ou IDs do pagamento", () => {
    const list = functionBodies(operations).find((fn) => fn.name === "organizer_event_orders");
    for (const column of ["buyer_phone", "public_token", "provider_order_id", "provider_payment_id", "payment_external_id", ".code"]) {
      expect(list?.text, column).not.toContain(column);
    }
  });

  it("pedido de estorno lê o evento do próprio pedido", () => {
    const fn = functionBodies(operations).find((f) => f.name === "request_order_refund");
    expect(fn?.text).toMatch(/select \* into v_order from public\.orders o where o\.id = p_order_id/);
  });

  it("gatilho fecha o pedido de estorno quando o pedido vira estornado", () => {
    expect(operations).toMatch(/create trigger orders_close_refund_request\s+after update of status on public\.orders/);
  });
});
