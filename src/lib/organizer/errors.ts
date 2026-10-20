import { LOCKED_FIELD_LABELS, type LockedField } from "@/lib/organizer/post-approval";

export const ORGANIZER_STATE_MESSAGES = {
  em_analise: "O evento está em análise. Toque em “Voltar para rascunho” para editar.",
  capa: "Adicione uma capa antes de enviar para aprovação.",
  sem_sessao_futura: "Cadastre pelo menos uma sessão com data futura.",
  sem_preco: "Cada sessão precisa de pelo menos um tipo de ingresso à venda.",
  nao_aprovado: "As vendas abrem depois que o ACDH Eventos aprovar o evento.",
  exclusao_pendente: "Há um pedido de exclusão em análise. As vendas ficam pausadas até a resposta.",
  com_vendas: "Este evento já teve vendas. Use “Pedir exclusão”.",
  sem_vendas: "Este evento não tem vendas. Use “Excluir evento”.",
  ja_pedido: "Já existe um pedido igual em análise.",
  nao_pago: "Só pedidos pagos podem ter estorno pedido.",
  cortesia: "Cortesia não tem estorno. Fale com a equipe do ACDH Eventos.",
  check_in: "Este pedido já tem ingresso usado na entrada.",
  sessoes_ativas: "Cancele todas as sessões ativas antes de concluir a exclusão.",
  organizador_inativo: "A conta deste organizador não está ativa.",
  estado: "Esta ação não está disponível agora. Recarregue a página.",
} as const;
const STATE_MESSAGES: Record<string, string> = ORGANIZER_STATE_MESSAGES;

const FIELD_ORDER: LockedField[] = ["nome", "local", "horario", "preco", "lotacao"];

/** O banco manda os campos em ordem alfabética; a mensagem segue a ordem da tela. */
function joinLabels(fields: string[]): string {
  const known = FIELD_ORDER.filter((field) => fields.includes(field)).map((field) => LOCKED_FIELD_LABELS[field]);
  const labels = known.length > 0 ? known : ["esses dados"];
  return labels.length === 1 ? labels[0] : `${labels.slice(0, -1).join(", ")} e ${labels.at(-1)}`;
}

export type OrganizerErrorContext = {
  /** "admin": telas da equipe (ex.: gerar convite). Padrão: comprador/organizador. */
  area?: "organizer" | "admin";
};

/** Traduz os códigos ORG_* do banco. Nunca devolve o texto cru do banco. */
export function organizerErrorMessage(dbMessage: string, context: OrganizerErrorContext = {}): string | null {
  const lotacao = dbMessage.match(/ORG_LOTACAO:(\d+)/);
  if (lotacao) return `Cada sessão pode ter no máximo ${lotacao[1]} lugares.`;
  if (dbMessage.includes("ORG_LOTACAO")) return "A sessão passou do limite de lugares.";
  const mudanca = dbMessage.match(/ORG_ESTADO:mudanca:([a-z,]+)/);
  if (mudanca) {
    return `Depois da aprovação, mudar ${joinLabels(mudanca[1].split(","))} precisa ser pedido ao ACDH Eventos (botão “Pedir mudança”).`;
  }
  const estado = dbMessage.match(/ORG_ESTADO:([a-z_]+)/);
  if (estado) return STATE_MESSAGES[estado[1]] ?? STATE_MESSAGES.estado;
  if (dbMessage.includes("ORG_ESTADO")) {
    return dbMessage.includes("só abre vendas depois de aprovado") ? STATE_MESSAGES.nao_aprovado : STATE_MESSAGES.estado;
  }
  if (dbMessage.includes("ORG_CONVITE")) {
    return context.area === "admin"
      ? "Não foi possível gerar o convite. Confira os dados e tente de novo."
      : "Este convite não vale mais. Peça um novo ao ACDH Eventos.";
  }
  if (dbMessage.includes("ORG_DONO")) {
    return dbMessage.includes("Pedido não encontrado") ? "Pedido não encontrado." : "Evento não encontrado.";
  }
  if (dbMessage.includes("ORG_DESLIGADO")) return "Esta área está indisponível no momento.";
  if (dbMessage.includes("ORG_LIMITE")) return "Muitas tentativas em pouco tempo. Aguarde alguns minutos e tente novamente.";
  if (dbMessage.includes("ORG_ACESSO")) return "Acesso não permitido.";
  if (dbMessage.includes("ORG_DADOS:slug")) return "Não foi possível criar o endereço do evento. Tente de novo.";
  if (dbMessage.includes("ORG_DADOS") && dbMessage.includes("nome digitado não confere")) {
    return "O nome digitado não confere. Digite o nome do evento como aparece na tela.";
  }
  if (dbMessage.includes("ORG_DADOS")) return "Confira os dados e tente de novo.";
  if (dbMessage.includes("ORG_EMAIL")) return "Confirme o e-mail com o código antes de continuar.";
  return null;
}
