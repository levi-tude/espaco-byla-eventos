import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Regressão: no servidor, um valor (const, array, função) exportado de arquivo
 * "use client" vira referência de cliente. Ex.: ORGANIZER_EVENT_TABS.some quebrou
 * /organizador/eventos/[id]. Código de servidor só pode importar componentes de lá.
 */
const SRC = path.resolve(__dirname, "../../src");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

const isClient = (source: string) =>
  /^(\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*["']use client["']/.test(source);

const files = walk(SRC);
const sources = new Map(files.map((file) => [file, readFileSync(file, "utf8")]));
const clientFiles = new Set(files.filter((file) => isClient(sources.get(file)!)));

function resolveImport(spec: string, from: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = path.join(SRC, spec.slice(2));
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(from), spec);
  else return null;
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx")]) {
    if (clientFiles.has(candidate)) return candidate;
  }
  return null;
}

const looksLikeComponent = (name: string) => /^[A-Z][A-Za-z0-9]*$/.test(name) && /[a-z]/.test(name);

describe("código de servidor x arquivos 'use client'", () => {
  it("não importa valores que não sejam componentes de arquivos de cliente", () => {
    const bad: string[] = [];
    for (const file of files) {
      if (clientFiles.has(file)) continue;
      const source = sources.get(file)!;
      for (const match of source.matchAll(/import\s+(type\s+)?\{([^}]*)\}\s+from\s+["']([^"']+)["']/g)) {
        if (match[1] || !resolveImport(match[3], file)) continue;
        for (const raw of match[2].split(",")) {
          const name = raw.trim();
          if (!name || name.startsWith("type ")) continue;
          const imported = name.split(/\s+as\s+/)[0].trim();
          if (!looksLikeComponent(imported)) bad.push(`${path.relative(SRC, file)}: ${imported}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });
});
