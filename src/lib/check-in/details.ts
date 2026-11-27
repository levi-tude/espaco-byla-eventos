import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  buildOrderSummary,
  type CheckInOrderSummary,
  type CheckInTicketKind,
} from "@/lib/domain/check-in";
import { meiaDiffCents } from "@/lib/domain/meia-check";
import { orderItemName, ticketTypeLabel } from "@/lib/domain/ticket-types";
import type { Database } from "@/types/database";

type AdminClient = SupabaseClient<Database>;

export type TicketRef = { code: string } | { ticketId: string };

export type CurrentTicket = {
  id: string;
  code: string;
  orderId: string;
  buyerName: string;
  checkedInAt: string | null;
  checkedInBy: string | null;
};

/**
 * Ingresso pelo código (QR) ou pelo id (lista de participantes), sempre preso ao evento
 * informado: ingresso de outro evento volta `null`. O código nunca sai do servidor.
 */
export async function findEventTicket(
  admin: AdminClient,
  eventId: string,
  ref: TicketRef,
): Promise<CurrentTicket | null> {
  const query = admin
    .from("tickets")
    .select("id, code, order_id, buyer_name, checked_in_at, checked_in_by")
    .eq("event_id", eventId);
  const { data, error } = await ("code" in ref
    ? query.eq("code", ref.code)
    : query.eq("id", ref.ticketId)
  ).maybeSingle();
  if (error) throw new Error(error.code || "consulta");
  if (!data) return null;
  return {
    id: data.id,
    code: data.code,
    orderId: data.order_id,
    buyerName: data.buyer_name,
    checkedInAt: data.checked_in_at,
    checkedInBy: data.checked_in_by,
  };
}

/** Ingressos válidos do mesmo pedido (só deste evento), com quem já entrou e o horário. */
export async function loadOrderSummary(
  admin: AdminClient,
  eventId: string,
  ticket: Pick<CurrentTicket, "id" | "orderId">,
): Promise<CheckInOrderSummary> {
  const { data, error } = await admin
    .from("tickets")
    .select("id, kind, status, checked_in_at, order_items(name)")
    .eq("event_id", eventId)
    .eq("order_id", ticket.orderId)
    .in("status", ["pago", "check_in"])
    .order("created_at")
    .order("id");
  if (error) throw new Error(error.code || "consulta");
  return buildOrderSummary(
    (data ?? []).map((row) => ({
      id: row.id,
      kind: row.kind as CheckInTicketKind,
      status: row.status,
      checkedInAt: row.checked_in_at,
      typeLabel: ticketTypeLabel(orderItemName(row.order_items), row.kind),
    })),
    ticket.id,
  );
}

/** Nome de quem registrou a entrada: equipe pelo nome, dono do evento como "organizador". */
export async function validatorName(
  admin: AdminClient,
  eventId: string,
  userId: string | null,
): Promise<string | null> {
  if (!userId) return null;
  const [{ data: staff }, { data: event }] = await Promise.all([
    admin.from("staff_profiles").select("display_name").eq("user_id", userId).maybeSingle(),
    admin.from("events").select("organizer_id").eq("id", eventId).maybeSingle(),
  ]);
  const name = staff?.display_name?.trim();
  if (name) return name;
  if (staff) return "equipe";
  if (event?.organizer_id === userId) return "organizador do evento";
  return null;
}

/** Quanto cobrar se a meia pagar a diferença (inteira − meia da sessão); null se não der. */
export async function loadMeiaDiff(
  admin: AdminClient,
  eventId: string,
  ticketId: string,
): Promise<number | null> {
  const { data: ticket, error } = await admin
    .from("tickets")
    .select("price_cents, session_id, kind")
    .eq("event_id", eventId)
    .eq("id", ticketId)
    .maybeSingle();
  if (error) throw new Error(error.code || "consulta");
  if (!ticket || ticket.kind !== "meia") return null;
  const [{ data: types, error: typesError }, { data: prices, error: pricesError }] = await Promise.all([
    admin
      .from("ticket_types")
      .select("id, kind, preset, people_per_unit, archived_at, sort_order, price_cents")
      .eq("event_id", eventId)
      .eq("kind", "inteira"),
    admin
      .from("session_ticket_types")
      .select("ticket_type_id, price_cents")
      .eq("session_id", ticket.session_id),
  ]);
  if (typesError || pricesError) throw new Error("consulta");
  const sessionPrice = new Map((prices ?? []).map((row) => [row.ticket_type_id, row.price_cents]));
  return meiaDiffCents(
    (types ?? []).map((type) => ({
      id: type.id,
      kind: type.kind,
      preset: type.preset,
      peoplePerUnit: type.people_per_unit,
      archived: type.archived_at !== null,
      sortOrder: type.sort_order,
      priceCents: sessionPrice.get(type.id) ?? type.price_cents,
    })),
    ticket.price_cents,
  );
}
