import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { PIX_PHONE_DB_PATTERN } from "@/lib/organizer/pix-key";

const file = path.resolve(__dirname, "../../supabase/migrations/20261021100000_pix_key_formats.sql");
const raw = readFileSync(file, "utf8");
const sql = raw
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n");

describe("migration pix_key_formats", () => {
  it("substitui a validação do documento e da chave, com o mesmo telefone do aplicativo", () => {
    expect(sql).toContain("create or replace function public.valid_tax_document(p_doc text)");
    expect(sql).toContain("create or replace function public.pix_details_problem(");
    expect(sql).toContain("security definer");
    expect(sql).toContain(`p_key !~ '${PIX_PHONE_DB_PATTERN}'`);
    expect(sql).toContain("p_key !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'");
    expect(sql).not.toContain("[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}");
    expect(sql).toContain("char_length(p_key) > 77");
    expect(sql).toContain("p_key !~ '^[0-9A-Z]{12}[0-9]{2}$'");
  });

  it("afrouxa o documento e só exige o formato novo da chave sem varrer o que já existe", () => {
    expect(sql).toContain(
      "check (pix_holder_document ~ '^([0-9]{11}|[0-9A-Z]{12}[0-9]{2})$')",
    );
    expect(sql.match(/not valid/g)).toHaveLength(2);
    expect(sql).toContain("organizer_profiles_pix_details_check");
    expect(sql).toContain("organizer_pix_change_requests_pix_details_check");
    expect(sql).not.toContain("organizer_payouts_pix_details");
    expect(sql).toContain("pix_holder_document_snapshot is null");
  });

  it("deixa comentada a consulta das linhas que a regra nova recusaria, sem imprimir a chave", () => {
    expect(raw).toContain("select 'perfil' as origem, user_id::text as id, pix_key_type");
    expect(raw).toContain("select 'troca', id::text, pix_key_type");
    expect(raw).toContain("pix_details_problem(pix_key_type, pix_key, pix_holder_name, pix_holder_document) is not null");
    expect(raw).not.toMatch(/select 'perfil'[\s\S]*?\bpix_key\b[\s\S]*?from public\.organizer_profiles/);
  });
});
