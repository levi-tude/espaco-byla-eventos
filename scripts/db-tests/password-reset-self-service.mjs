// Testa a migration 20261022120000_password_reset_self_service.sql num Postgres
// temporário: aplica todas as migrations, roda o ensaio e confere que termina com
// ENSAIO e só "ok". Não usa banco real.
//
// Uso: BYLA_PG_TOOLS=<pasta com embedded-postgres e pg> node scripts/db-tests/password-reset-self-service.mjs

import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const TOOLS = process.env.BYLA_PG_TOOLS;
if (!TOOLS) {
  console.error("Defina BYLA_PG_TOOLS (pasta com embedded-postgres e pg).");
  process.exit(2);
}
const toolsRequire = createRequire(join(TOOLS, "package.json"));
const load = async (name) => (await import(pathToFileURL(toolsRequire.resolve(name)).href)).default;
const EmbeddedPostgres = await load("embedded-postgres");
const pg = await load("pg");

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const MIGRATIONS = process.env.BYLA_MIGRATIONS_DIR ?? join(ROOT, "supabase", "migrations");
const ENSAIO = join(ROOT, "supabase", "tests", "password_reset_self_service_check.sql");
const THIS_MIGRATION = "20261022120000_password_reset_self_service.sql";
const PORT = 54921;
const DATA_DIR = join(TOOLS, "data-password-reset");
const PASSWORD = randomUUID();

rmSync(DATA_DIR, { recursive: true, force: true });
const server = new EmbeddedPostgres({
  databaseDir: DATA_DIR,
  user: "postgres",
  password: PASSWORD,
  port: PORT,
  persistent: false,
  initdbFlags: ["--encoding=UTF8", "--locale=C", "--lc-messages=C"],
  onLog: (m) => process.env.PGLOG && console.log("[pg]", String(m).trim()),
  onError: (m) => console.log("[pg-err]", String(m).trim()),
});
await server.initialise();
await server.start();
await server.createDatabase("byla");

let failed = false;
try {
  const db = new pg.Client({
    host: "localhost",
    port: PORT,
    user: "postgres",
    password: PASSWORD,
    database: "byla",
  });
  db.on("error", () => {});
  await db.connect();

  await db.query(`
    create role anon nologin noinherit;
    create role authenticated nologin noinherit;
    create role service_role nologin noinherit bypassrls;
    create schema auth;
    create table auth.users (
      id uuid primary key,
      email text,
      aud text,
      role text,
      email_confirmed_at timestamptz,
      banned_until timestamptz,
      deleted_at timestamptz,
      created_at timestamptz,
      updated_at timestamptz
    );
    create table auth.sessions (
      id uuid primary key,
      user_id uuid references auth.users (id) on delete cascade,
      created_at timestamptz,
      updated_at timestamptz
    );
    create function auth.jwt() returns jsonb language sql stable as
      $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
    create function auth.uid() returns uuid language sql stable as
      $$ select (auth.jwt() ->> 'sub')::uuid $$;
    grant usage on schema auth to anon, authenticated, service_role;
    create schema storage;
    create table storage.buckets (
      id text primary key, name text, public boolean,
      file_size_limit bigint, allowed_mime_types text[]
    );
    create schema extensions;
    create schema vault;
    create table vault.secrets (name text primary key, secret text not null);
    create view vault.decrypted_secrets as select name, secret as decrypted_secret from vault.secrets;
    grant usage on schema public to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
    alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  `);

  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
  if (!files.includes(THIS_MIGRATION)) {
    console.log("FAIL - migration ausente");
    process.exit(1);
  }
  for (const file of files) {
    await db.query(readFileSync(join(MIGRATIONS, file), "utf8"));
    console.log(`ok   - aplicou ${file}`);
  }

  try {
    await db.query(readFileSync(ENSAIO, "utf8"));
    console.log("FAIL - ensaio não levantou ENSAIO");
    failed = true;
  } catch (error) {
    const msg = String(error.message ?? error);
    const match = /ENSAIO (.+)$/s.exec(msg);
    if (!match) {
      console.log("FAIL - erro inesperado:", msg.slice(0, 400));
      failed = true;
    } else {
      const body = match[1].trim();
      console.log("ensaio:", body);
      const parts = body.split(/\s+/).filter(Boolean);
      for (const part of parts) {
        if (part.endsWith("=ok")) console.log(`ok   - ${part}`);
        else {
          console.log(`FAIL - ${part}`);
          failed = true;
        }
      }
      if (parts.length === 0) failed = true;
    }
  }

  await db.end();
} finally {
  await server.stop();
  rmSync(DATA_DIR, { recursive: true, force: true });
}

process.exit(failed ? 1 : 0);
