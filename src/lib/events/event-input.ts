import { ActionError } from "@/lib/action-result";
import { quotaDbErrorMessage } from "@/lib/domain/quotas";
import {
  mirrorPrices,
  normalizeSessions,
  sessionErrorLabel,
  type SessionInput,
  type SessionRpcItem,
  sessionsDbErrorMessage,
  type SessionTypeInfo,
} from "@/lib/domain/session-editor";
import {
  normalizeTicketTypes,
  presetDefinition,
  TICKET_TYPE_LIMITS,
  type TicketTypeInput,
  type TicketTypeRpcItem,
  ticketTypesErrorMessage,
} from "@/lib/domain/ticket-types";
import { organizerErrorMessage } from "@/lib/organizer/errors";

export const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type EventInput = {
  name: string;
  venue: string;
  description: string;
  /**
   * Tipos à venda na ordem de exibição; a cortesia o banco garante sozinho. O preço
   * e o limite de cada tipo vêm das sessões (os daqui são ignorados).
   */
  ticketTypes: TicketTypeInput[];
  /** Sessões ativas na ordem da tela; preços por `typeIndex` (posição em `ticketTypes`). */
  sessions: SessionInput[];
  coverImageUrl?: string | null;
};

export type NormalizedEventInput = {
  name: string;
  venue: string;
  description: string;
  coverImageUrl: string | null;
  ticketTypes: TicketTypeRpcItem[];
  sessions: SessionRpcItem[];
};

export function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

/** Nome, categoria e pessoas de cada tipo, para validar preços e limites por sessão. */
function sessionTypeInfos(types: unknown): SessionTypeInfo[] {
  if (!Array.isArray(types) || types.length === 0) {
    throw new ActionError("Marque pelo menos um tipo de ingresso para vender.");
  }
  return types.map((raw) => {
    const item = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
    const definition = item.preset == null ? null : presetDefinition(item.preset);
    if (definition) {
      return { name: definition.name, kind: definition.kind, peoplePerUnit: definition.peoplePerUnit };
    }
    const people = item.peoplePerUnit;
    if (
      item.preset != null ||
      typeof people !== "number" ||
      !Number.isInteger(people) ||
      people < 1 ||
      people > TICKET_TYPE_LIMITS.maxPeoplePerUnit
    ) {
      throw new ActionError("Tipo de ingresso inválido.");
    }
    const name = typeof item.name === "string" && item.name.trim() ? item.name.trim() : "tipo novo";
    return { name, kind: "inteira", peoplePerUnit: people };
  });
}

export function normalizeEventInput(input: EventInput): NormalizedEventInput {
  if (!input || typeof input !== "object") throw new ActionError("Dados inválidos.");
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const venue = typeof input.venue === "string" ? input.venue.trim() : "";
  const description = typeof input.description === "string" ? input.description.trim() : "";
  const coverImageUrl =
    typeof input.coverImageUrl === "string" ? input.coverImageUrl.trim() || null : null;

  if (!name || !venue) {
    throw new ActionError("Preencha nome e local do evento.");
  }

  const infos = sessionTypeInfos(input.ticketTypes);
  const sessions = normalizeSessions(input.sessions, infos);
  if (!sessions.ok) throw new ActionError(sessions.error);

  const mirror = mirrorPrices(sessions.items, infos.length);
  const missing = mirror.findIndex((price) => price === null);
  if (missing >= 0) {
    throw new ActionError(`Informe o preço de “${infos[missing].name}” em pelo menos uma sessão.`);
  }
  const ticketTypes = normalizeTicketTypes(
    input.ticketTypes.map((type, index) => ({ ...type, priceCents: mirror[index], maxUnits: null })),
  );
  if (!ticketTypes.ok) throw new ActionError(ticketTypes.error);

  if (coverImageUrl && !isHttpsUrl(coverImageUrl)) {
    throw new ActionError("Informe uma URL válida para a capa.");
  }

  return {
    name,
    venue,
    description,
    coverImageUrl,
    ticketTypes: ticketTypes.items,
    sessions: sessions.items,
  };
}

export function sessionLabels(sessions: SessionRpcItem[]): string[] {
  return sessions.map((session, index) => sessionErrorLabel(index, sessions.length, session.starts_at));
}

export function saveErrorMessage(message: string, labels: string[], removed?: Map<string, string>): string {
  return (
    sessionsDbErrorMessage(message, labels, removed) ??
    quotaDbErrorMessage(message) ??
    ticketTypesErrorMessage(message) ??
    organizerErrorMessage(message) ??
    "Não foi possível salvar o evento."
  );
}
