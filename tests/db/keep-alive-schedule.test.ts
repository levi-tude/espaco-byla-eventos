import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const sql = readFileSync(
  path.resolve(__dirname, "../../supabase/migrations/20261015100000_keep_alive_schedule.sql"),
  "utf8",
);
const code = sql
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n");

describe("migration do agendamento do keep-alive (pg_cron)", () => {
  it("agenda 1x/dia às 00:00 UTC chamando a função", () => {
    expect(code).toMatch(
      /cron\.schedule\(\s*'keep-alive-diario',\s*'0 0 \* \* \*',\s*\$\$select public\.invoke_keep_alive\(\)\$\$\s*\)/,
    );
  });

  it("lê segredo e endereço só do Vault, sem endereço fixo no código", () => {
    expect(code).toContain("'keep_alive_cron_secret'");
    expect(code).toContain("'keep_alive_cron_url'");
    expect(code).not.toMatch(/https:\/\/[a-z0-9-]+\.(vercel\.app|netlify\.app|run\.app)/i);
  });

  it("fica inerte sem segredo forte ou com endereço fora do padrão", () => {
    expect(code).toMatch(/v_secret is null or char_length\(v_secret\) < 32/);
    expect(code).toContain("'^https://[A-Za-z0-9.-]+/api/cron/keep-alive$'");
    expect(code.match(/return null;/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("chama a rota com GET e Bearer, como o agendador da Vercel", () => {
    expect(code).toMatch(/net\.http_get\(/);
    expect(code).toMatch(/'Authorization', 'Bearer ' \|\| v_secret/);
  });

  it("ninguém além do dono do banco executa a função", () => {
    expect(code).toMatch(
      /revoke all on function public\.invoke_keep_alive\(\) from public, anon, authenticated, service_role;/,
    );
    expect(code).toMatch(/set search_path = ''/);
    expect(code).not.toMatch(/security definer/i);
  });

  it("é aditiva: não apaga nem altera tabelas", () => {
    expect(code).not.toMatch(/\b(drop|truncate|delete|alter table|update)\b/i);
  });
});
