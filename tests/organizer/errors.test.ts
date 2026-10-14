import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { organizerErrorMessage } from "@/lib/organizer/errors";

const MIGRATIONS = [
  "supabase/migrations/20261018100000_organizer_accounts.sql",
  "supabase/migrations/20261018110000_organizer_operations.sql",
];

/** Todos os códigos ORG_* que as migrations do organizador levantam ou devolvem. */
function migrationOrgCodes(): string[] {
  const codes = new Set<string>();
  for (const file of MIGRATIONS) {
    const sql = readFileSync(path.resolve(__dirname, "../..", file), "utf8");
    for (const match of sql.matchAll(/'(ORG_[A-Z]+(?::[a-z_]+)?)/g)) codes.add(match[1]);
  }
  return [...codes].sort();
}

/** Mensagens com texto livre depois do prefixo (ex.: 'ORG_ESTADO: Evento ...'), vindas dos gatilhos. */
function migrationTextMessages(prefix: string): string[] {
  const messages = new Set<string>();
  for (const file of MIGRATIONS) {
    const sql = readFileSync(path.resolve(__dirname, "../..", file), "utf8");
    for (const match of sql.matchAll(new RegExp(`'(${prefix}: [^']+)'`, "g"))) messages.add(match[1]);
  }
  return [...messages].sort();
}

const STATE_TRIGGER_MESSAGES: Record<string, string> = {
  "ORG_ESTADO: Evento de organizador só abre vendas depois de aprovado.":
    "As vendas abrem depois que o Espaço Byla aprovar o evento.",
  "ORG_ESTADO: Evento de organizador só pelo fluxo próprio.":
    "Esta ação não está disponível agora. Recarregue a página.",
  "ORG_ESTADO: Aprovação e exclusão só pelo fluxo próprio.":
    "Esta ação não está disponível agora. Recarregue a página.",
};

const OWNER_MESSAGES: Record<string, string> = {
  "ORG_DONO: Evento não encontrado.": "Evento não encontrado.",
  "ORG_DONO: Evento de outro organizador.": "Evento não encontrado.",
  "ORG_DONO: O dono do evento não muda.": "Evento não encontrado.",
  "ORG_DONO: Pedido não encontrado.": "Pedido não encontrado.",
};

describe("mensagens dos erros do banco", () => {
  it("traduz cada prefixo", () => {
    expect(organizerErrorMessage("ORG_LOTACAO:100")).toBe("Cada sessão pode ter no máximo 100 lugares.");
    expect(organizerErrorMessage("ORG_ESTADO:mudanca:nome,horario")).toBe(
      "Depois da aprovação, mudar nome do evento e horário precisa ser pedido ao Espaço Byla (botão “Pedir mudança”).",
    );
    expect(organizerErrorMessage("ORG_ESTADO:capa")).toBe("Adicione uma capa antes de enviar para aprovação.");
    expect(organizerErrorMessage("ORG_CONVITE: x")).toBe("Este convite não vale mais. Peça um novo ao Espaço Byla.");
    expect(organizerErrorMessage("ORG_DONO: x")).toBe("Evento não encontrado.");
    expect(organizerErrorMessage("outra coisa")).toBeNull();
  });

  it("mudança: lista na ordem da tela, sem repetir, como o banco manda (ordem alfabética)", () => {
    expect(organizerErrorMessage("ORG_ESTADO:mudanca:horario,local,lotacao,nome,preco")).toBe(
      "Depois da aprovação, mudar nome do evento, local, horário, preço e lugares precisa ser pedido ao Espaço Byla (botão “Pedir mudança”).",
    );
    expect(organizerErrorMessage("ORG_ESTADO:mudanca:preco")).toBe(
      "Depois da aprovação, mudar preço precisa ser pedido ao Espaço Byla (botão “Pedir mudança”).",
    );
  });

  it("acha o código mesmo dentro da mensagem completa do Postgres", () => {
    expect(organizerErrorMessage("P0001: ORG_ESTADO:sem_preco")).toBe(
      "Cada sessão precisa de pelo menos um tipo de ingresso à venda.",
    );
  });

  it("estados específicos do banco", () => {
    expect(organizerErrorMessage("ORG_ESTADO:sem_sessao_futura")).toBe("Cadastre pelo menos uma sessão com data futura.");
    expect(organizerErrorMessage("ORG_ESTADO:ja_pedido")).toBe("Já existe um pedido igual em análise.");
    expect(organizerErrorMessage("ORG_ESTADO:com_vendas")).toBe("Este evento já teve vendas. Use “Pedir exclusão”.");
    expect(organizerErrorMessage("ORG_ESTADO:desconhecido")).toBe("Esta ação não está disponível agora. Recarregue a página.");
  });

  it("dados: endereço repetido, nome digitado errado e genérico", () => {
    expect(organizerErrorMessage("ORG_DADOS:slug")).toBe("Não foi possível criar o endereço do evento. Tente de novo.");
    expect(organizerErrorMessage("ORG_DADOS: O nome digitado não confere.")).toBe(
      "O nome digitado não confere. Digite o nome do evento como aparece na tela.",
    );
    expect(organizerErrorMessage("ORG_DADOS: Dados inválidos.")).toBe("Confira os dados e tente de novo.");
  });

  it("limite, acesso, desligado e e-mail", () => {
    expect(organizerErrorMessage("ORG_LIMITE: x")).toBe("Muitas tentativas em pouco tempo. Aguarde alguns minutos e tente novamente.");
    expect(organizerErrorMessage("ORG_ACESSO: x")).toBe("Acesso não permitido.");
    expect(organizerErrorMessage("ORG_DESLIGADO: x")).toBe("Esta área está indisponível no momento.");
    expect(organizerErrorMessage("ORG_EMAIL: x")).toBe("Confirme o e-mail com o código antes de continuar.");
  });

  it("todo código ORG_* das migrations tem mensagem simples (sem texto cru do banco)", () => {
    const codes = migrationOrgCodes();
    expect(codes.length).toBeGreaterThan(20);
    for (const code of codes) {
      const sample = code === "ORG_LOTACAO" ? "ORG_LOTACAO:100" : code === "ORG_ESTADO:mudanca" ? "ORG_ESTADO:mudanca:nome" : code;
      const message = organizerErrorMessage(sample);
      expect(message, code).toBeTypeOf("string");
      expect(message, code).not.toMatch(/ORG_|_/);
    }
  });

  it("mensagens 'ORG_ESTADO: <texto>' dos gatilhos: toda mensagem das migrations tem tradução conferida", () => {
    const found = migrationTextMessages("ORG_ESTADO");
    expect(found.length).toBeGreaterThan(0);
    expect(found).toEqual(Object.keys(STATE_TRIGGER_MESSAGES).sort());
    for (const message of found) expect(organizerErrorMessage(message), message).toBe(STATE_TRIGGER_MESSAGES[message]);
  });

  it("ORG_DONO: pedido não encontrado fala de pedido; o resto, de evento", () => {
    const found = migrationTextMessages("ORG_DONO");
    expect(found).toEqual(Object.keys(OWNER_MESSAGES).sort());
    for (const message of found) expect(organizerErrorMessage(message), message).toBe(OWNER_MESSAGES[message]);
  });

  it("área do Admin: erro de convite com texto para quem gera o convite", () => {
    expect(organizerErrorMessage("ORG_CONVITE: Apelido muito longo.", { area: "admin" })).toBe(
      "Não foi possível gerar o convite. Confira os dados e tente de novo.",
    );
    expect(organizerErrorMessage("ORG_CONVITE: Convite inválido.", { area: "organizer" })).toBe(
      "Este convite não vale mais. Peça um novo ao Espaço Byla.",
    );
    expect(organizerErrorMessage("ORG_DONO: x", { area: "admin" })).toBe("Evento não encontrado.");
  });

  it("estados das migrations não caem na mensagem genérica", () => {
    const generic = organizerErrorMessage("ORG_ESTADO:estado");
    for (const code of migrationOrgCodes().filter((c) => c.startsWith("ORG_ESTADO:") && c !== "ORG_ESTADO:estado")) {
      const sample = code === "ORG_ESTADO:mudanca" ? "ORG_ESTADO:mudanca:nome" : code;
      expect(organizerErrorMessage(sample), code).not.toBe(generic);
    }
  });
});
