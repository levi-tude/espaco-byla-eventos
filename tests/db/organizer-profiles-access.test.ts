import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

const sqlOnly = (sql: string) => sql.replace(/--.*$/gm, "");

describe("organizer_profiles (LGPD)", () => {
  it("o service_role não lê organizer_profiles direto no código", () => {
    const offenders: string[] = [];
    for (const file of walk(join(ROOT, "src"))) {
      if (file.endsWith(join("types", "database.ts"))) continue;
      const src = readFileSync(file, "utf8");
      if (!src.includes('"organizer_profiles"')) continue;
      // Cada .from("organizer_profiles") tem de vir do cliente da sessão, nunca do admin.
      for (const m of src.matchAll(/\.from\("organizer_profiles"\)/g)) {
        const head = src.slice(0, m.index);
        const stmt = head.slice(Math.max(head.lastIndexOf(";"), head.lastIndexOf("{")) + 1);
        if (/\badmin\b|createAdminClient/.test(stmt)) offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("toda leitura de organizer_profiles no código lista colunas (sem select('*'))", () => {
    for (const file of walk(join(ROOT, "src"))) {
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(/\.from\("organizer_profiles"\)\s*\.select\(\s*(["'`])([^"'`]*)\1/g)) {
        expect(m[2].trim(), file).not.toBe("*");
        expect(m[2].trim(), file).not.toBe("");
      }
    }
  });

  it("a última migração tira o acesso direto do service_role", () => {
    const dir = join(ROOT, "supabase", "migrations");
    const files = readdirSync(dir).sort();
    const touching = files.filter((f) =>
      /\b(grant|revoke)\b[^;]*on (table )?public\.organizer_profiles[^;]*service_role/i.test(
        sqlOnly(readFileSync(join(dir, f), "utf8")),
      ),
    );
    const last = sqlOnly(readFileSync(join(dir, touching[touching.length - 1]), "utf8"));
    expect(last).toMatch(/revoke all on table public\.organizer_profiles from service_role;/);
    expect(last).not.toMatch(/grant[^;]*organizer_profiles[^;]*service_role/i);
  });
});
