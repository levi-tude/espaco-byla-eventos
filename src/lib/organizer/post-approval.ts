export type LockedField = "nome" | "local" | "horario" | "preco" | "lotacao";

/**
 * Espelho de organizer_change_violations, só para travar a tela. Quem decide é o banco.
 * Em sessão com venda, "preco" também cobre tirar da venda ou arquivar um tipo que estava
 * à venda, e "lotacao" só barra reduzir (aumentar lugares o banco aceita).
 */
export function lockedFieldsFor(approvalStatus: string, sessionHasSales: boolean): LockedField[] {
  if (approvalStatus !== "aprovado") return [];
  return sessionHasSales ? ["nome", "local", "horario", "preco", "lotacao"] : ["nome", "local"];
}

export const LOCKED_FIELD_LABELS: Record<LockedField, string> = {
  nome: "nome do evento",
  local: "local",
  horario: "horário",
  preco: "preço",
  lotacao: "lugares",
};
