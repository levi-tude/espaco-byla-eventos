/**
 * Abas da página do evento do organizador. Fica fora do componente "use client":
 * no servidor, valores exportados de um arquivo de cliente viram referências de
 * cliente (não o array), e `.some` quebrava a página.
 */
export const ORGANIZER_EVENT_TABS = [
  { id: "evento", label: "Evento" },
  { id: "vendas", label: "Vendas" },
  { id: "pedidos", label: "Pedidos" },
  { id: "portaria", label: "Portaria" },
  { id: "pedidos-equipe", label: "Pedidos à equipe" },
  { id: "financeiro", label: "Financeiro" },
] as const;

export type OrganizerEventTabId = (typeof ORGANIZER_EVENT_TABS)[number]["id"];
