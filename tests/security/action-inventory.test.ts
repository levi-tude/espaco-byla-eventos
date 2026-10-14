import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../../src/app");
const AREAS = ["equipe", "organizador", "convite", "quero-fazer-meu-evento", "redefinir-senha"];
const AUTH_GUARDS = [
  "requireOrganizer", "requireEventAccess", "requireTeamAdmin", "requireActor",
  "requireStaffUser", "assertStaff", "requireFinanceAdmin", "getFinanceAccess",
  // login com código: agem só sobre a própria sessão, conferida pelo banco
  "startLoginVerification", "resendLoginCode", "submitLoginCode", "endLoginVerification",
];
const PUBLIC_GUARDS = ["isBotRequest", "consumeRateLimit", "tryConsumeRateLimit"];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

function actionFiles(): string[] {
  return AREAS.flatMap((area) => {
    const dir = path.join(ROOT, area);
    try {
      return walk(dir).filter((file) => /(actions\.ts|-actions\.ts|route\.ts)$/.test(file));
    } catch {
      return [];
    }
  }).concat(path.join(ROOT, "api", "check-in", "route.ts"));
}

/** Corpo de cada função do arquivo (exportada ou não), pelo nome. */
function functionBodies(source: string): Map<string, string> {
  const map = new Map<string, string>();
  const starts = [...source.matchAll(/(?:export )?async function (\w+)\(/g)];
  starts.forEach((match, index) => {
    const end = index + 1 < starts.length ? starts[index + 1].index : source.length;
    map.set(match[1], source.slice(match.index, end));
  });
  return map;
}

function reachesGuard(name: string, bodies: Map<string, string>, guards: string[], seen = new Set<string>()): boolean {
  if (seen.has(name)) return false;
  seen.add(name);
  const body = bodies.get(name) ?? "";
  if (guards.some((guard) => new RegExp(`\\b${guard}\\(`).test(body))) return true;
  return [...body.matchAll(/\b(\w+)\(/g)].some(([, called]) => called !== name && bodies.has(called) && reachesGuard(called, bodies, guards, seen));
}

describe("inventário: toda ação e rota confere acesso dentro dela", () => {
  const files = actionFiles();

  it("encontrou os arquivos de ação", () => {
    expect(files.length).toBeGreaterThanOrEqual(8);
  });

  it.each(files.map((file) => [path.relative(ROOT, file), file]))("%s", (_label, file) => {
    const source = readFileSync(file, "utf8");
    const bodies = functionBodies(source);
    const exported = [...source.matchAll(/export async function (\w+)\(/g)].map((m) => m[1]);
    const isPublic = /[\\/](convite|quero-fazer-meu-evento|redefinir-senha)[\\/]/.test(file);
    const guards = isPublic ? PUBLIC_GUARDS : AUTH_GUARDS.concat(file.includes("check-in") ? ["readLoginState"] : []);
    for (const name of exported) {
      expect(reachesGuard(name, bodies, guards), `${name} não chama ${guards.join(" / ")}`).toBe(true);
    }
  });

  it("área do organizador não tem ação de cortesia", () => {
    for (const file of files.filter((f) => f.includes(`${path.sep}organizador${path.sep}`))) {
      const source = readFileSync(file, "utf8");
      expect(source).not.toMatch(/issue_courtesy_ticket|cancel_courtesy_ticket|issueCourtesy|cancelTicket/);
    }
  });
});
