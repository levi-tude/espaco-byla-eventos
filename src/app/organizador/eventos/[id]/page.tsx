import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { EventSharePanel } from "@/components/events/EventSharePanel";
import { EventForm } from "@/components/equipe/EventForm";
import { EventGalleryManager } from "@/components/equipe/EventGalleryManager";
import { type EditorSession, savedTypeKey } from "@/components/equipe/session-drafts";
import type { EditorTicketType } from "@/components/equipe/TicketTypesEditor";
import { ApprovalBanner } from "@/components/organizer/ApprovalBanner";
import { DeleteEventSection } from "@/components/organizer/DeleteEventSection";
import { OrganizerEventTabs } from "@/components/organizer/OrganizerEventTabs";
import { OpsRequestList, type OrganizerOpsRequest } from "@/components/organizer/OpsRequestList";
import { formatEventDays, organizerEventStatus } from "@/components/organizer/OrganizerEventCard";
import { OrganizerFinancePanel } from "@/components/organizer/OrganizerFinancePanel";
import { OrganizerNoAccess } from "@/components/organizer/OrganizerNoAccess";
import { type OrganizerOrder, OrganizerOrderList } from "@/components/organizer/OrganizerOrderList";
import { OrganizerSalesPanel, type OrganizerSalesSession } from "@/components/organizer/OrganizerSalesPanel";
import { BackLink } from "@/components/ui/BackLink";
import { ButtonLink } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Notice";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { alertTeamSetup } from "@/lib/alerts/team-alert";
import { getActor, requireEventAccess } from "@/lib/auth/actor";
import { eventDateFormatter, formatSessionLabel } from "@/lib/datetime";
import type { EventAvailabilityWithTypes } from "@/lib/domain/availability";
import { loadEventSessions, loadSessionAvailability } from "@/lib/domain/event-availability";
import { orderStatsFor, sessionOrderStats, sumAvailability } from "@/lib/domain/session-panel";
import { orderNumber, sessionSalesClosesAt } from "@/lib/domain/sessions";
import type { GalleryImage } from "@/lib/media/gallery";
import { publicMediaUrl } from "@/lib/media/paths";
import { eventShareModel, publicAppBaseUrl } from "@/lib/events/share-link";
import { payoutSituation } from "@/lib/organizer/finance";
import { ORGANIZER_EVENT_TABS, type OrganizerEventTabId } from "@/lib/organizer/event-tabs";
import { loadOrganizerEventFinance } from "@/lib/organizer/load-finance";
import { lockedFieldsFor } from "@/lib/organizer/post-approval";
import { organizerAreaEnabled } from "@/lib/organizer/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerClient } from "@/lib/supabase/server";
import type { Json } from "@/types/database";

export const metadata: Metadata = {
  title: "Meu evento",
  robots: { index: false, follow: false },
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ORDER_STATUSES = ["pago", "estornado", "aguardando_decisao"] as const;
const REQUEST_KINDS = ["estorno", "exclusao", "mudanca"] as const;
const REQUEST_STATUSES = ["pendente", "atendido", "recusado", "cancelado"] as const;
const SOLD_STATUSES = new Set(["pago", "estornado", "aguardando_decisao"]);

const EVENT_SELECT = `
  id, slug, name, venue, description, cover_image_url, sales_open, approval_status, approval_note, organizer_id, deleted_at,
  ticket_types(id, preset, name, kind, people_per_unit, sort_order, archived_at),
  event_sessions(
    id, name, starts_at, ends_at, capacity, inteira_quota, meia_quota, sales_open, status, archived_at,
    session_ticket_types(ticket_type_id, price_cents, max_units, on_sale)
  ),
  event_images(id, storage_path, created_at)
`;

const createdFormatter = eventDateFormatter({ dateStyle: "short" });

function oneOf<T extends string>(options: readonly T[], value: unknown): T | null {
  return options.find((option) => option === value) ?? null;
}

function parseItems(value: Json): OrganizerOrder["items"] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) =>
    item && typeof item === "object" && !Array.isArray(item) &&
    typeof item.name === "string" && typeof item.quantity === "number"
      ? [{ name: item.name, quantity: item.quantity }]
      : [],
  );
}

function changeWhat(details: Json): string | null {
  if (!details || typeof details !== "object" || Array.isArray(details)) return null;
  return typeof details.o_que === "string" ? details.o_que : null;
}

function nowMs() {
  return Date.now();
}

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function EventoOrganizadorPage({ params, searchParams }: Props) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  if (!UUID_PATTERN.test(id)) notFound();

  const [actor, access] = await Promise.all([
    getActor(),
    requireEventAccess(id).catch(() => null),
  ]);
  if (actor?.kind !== "organizador") {
    return <OrganizerNoAccess areaEnabled={await organizerAreaEnabled()} />;
  }
  if (access?.access !== "dono") notFound();

  const supabase = await createServerClient();
  const { data: rawEvent, error: eventQueryError } = await supabase
    .from("events")
    .select(EVENT_SELECT)
    .eq("id", id)
    .maybeSingle();

  if (!rawEvent) {
    if (eventQueryError) {
      console.error("[organizador] Falha ao ler o evento.", eventQueryError.code);
      return (
        <main className="mx-auto w-full max-w-6xl px-4 pb-16 pt-2 sm:px-6 sm:pt-4">
          <BackLink href="/organizador">Meus eventos</BackLink>
          <Notice className="mt-6" tone="danger">
            Não foi possível carregar os dados do evento. Atualize a página.
          </Notice>
        </main>
      );
    }
    notFound();
  }

  const event = rawEvent;
  if (event.organizer_id !== actor.userId || event.deleted_at) notFound();

  const ticketTypes = (event.ticket_types ?? [])
    .filter((type) => type.kind !== "cortesia" && type.archived_at === null)
    .sort(
      (a, b) =>
        (a.sort_order ?? 0) - (b.sort_order ?? 0) || String(a.id).localeCompare(String(b.id)),
    );
  const sessions = (event.event_sessions ?? [])
    .filter((session) => session.archived_at === null)
    .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at));
  const activeSessions = sessions.filter((session) => session.status === "ativa");
  const sessionIds = sessions.map((session) => session.id);

  const sessionPrices = sessions.flatMap((session) =>
    (session.session_ticket_types ?? []).map((row) => ({
      session_id: session.id,
      ticket_type_id: row.ticket_type_id,
      price_cents: row.price_cents,
      max_units: row.max_units,
      on_sale: row.on_sale,
    })),
  );

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const gallery: GalleryImage[] = [...(event.event_images ?? [])]
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
    .map(({ id: imageId, storage_path }) => ({
      id: imageId,
      url: publicMediaUrl(supabaseUrl, storage_path),
    }));

  const admin = createAdminClient();
  const availabilitiesPromise = Promise.all(
    sessionIds.map((sessionId) => loadSessionAvailability(admin, sessionId)),
  );

  const [ordersResult, summary, buyerOrders, opsRequests, finance, availabilities] = await Promise.all([
    admin.from("orders").select("session_id, status, expires_at").eq("event_id", event.id),
    loadEventSessions(admin, event.id),
    admin.rpc("organizer_event_orders", { p_actor: actor.userId, p_event_id: event.id }),
    admin.rpc("organizer_event_requests", { p_actor: actor.userId, p_event_id: event.id }),
    loadOrganizerEventFinance(actor.userId, event.id),
    availabilitiesPromise,
  ]);
  if (buyerOrders.error) console.error("[organizador] Falha ao ler os pedidos do evento.", buyerOrders.error.code);
  if (opsRequests.error) console.error("[organizador] Falha ao ler os pedidos à equipe.", opsRequests.error.code);

  const orderRows = ordersResult.data;
  const editorLoadFailed = Boolean(eventQueryError || ordersResult.error);
  if (editorLoadFailed) console.error("[organizador] Falha ao ler os dados do evento para edição.");

  const orders: OrganizerOrder[] = (buyerOrders.data ?? []).flatMap((row) => {
    const status = oneOf(ORDER_STATUSES, row.status);
    if (!status) return [];
    return [
      {
        orderId: row.order_id,
        orderNumber: orderNumber(row.order_id),
        buyerName: row.buyer_name,
        buyerEmail: row.buyer_email,
        sessionLabel: formatSessionLabel(row.session_name, row.session_starts_at),
        items: parseItems(row.items),
        status,
        isCourtesy: row.is_courtesy,
        ticketsTotal: row.tickets_total,
        ticketsCheckedIn: row.tickets_checked_in,
        refundRequest: oneOf(REQUEST_STATUSES, row.refund_request_status),
      },
    ];
  });
  const requests: OrganizerOpsRequest[] = (opsRequests.data ?? []).flatMap((row) => {
    const kind = oneOf(REQUEST_KINDS, row.kind);
    const status = oneOf(REQUEST_STATUSES, row.status);
    if (!kind || !status) return [];
    return [
      {
        id: row.id,
        kind,
        orderNumber: row.order_id ? orderNumber(row.order_id) : null,
        what: kind === "mudanca" ? changeWhat(row.details) : null,
        reason: row.reason,
        status,
        decisionNote: row.decision_note,
        createdLabel: createdFormatter.format(new Date(row.created_at)),
      },
    ];
  });
  const availabilityBySession = new Map<string, EventAvailabilityWithTypes | null>(
    sessions.map((session, index) => [session.id, availabilities[index]]),
  );

  const types = ticketTypes;
  const typeKeyById = new Map(types.map((type) => [type.id, savedTypeKey(type)]));
  const typeTotals = new Map(
    (sumAvailability(availabilities)?.types ?? []).map((type) => [type.ticketTypeId, type]),
  );
  const editorTypes: EditorTicketType[] = types.map((type) => {
    const current = typeTotals.get(type.id);
    return {
      id: type.id,
      preset: type.preset,
      name: type.name,
      peoplePerUnit: type.people_per_unit,
      hasSales: current?.hasSales ?? true,
      unitsSold: current?.unitsSold ?? 0,
      unitsTaken: current?.unitsTaken ?? 0,
    };
  });

  const orderStats = sessionOrderStats(orderRows ?? []);
  const editorSessions: EditorSession[] = activeSessions.map((session) => {
    const stats = orderStatsFor(orderStats, session.id);
    const sessionAvailability = availabilityBySession.get(session.id) ?? null;
    const occupied = sessionAvailability ? sessionAvailability.sold + sessionAvailability.held : 0;
    const liveOrders = stats.liveOrders || occupied > 0 || !sessionAvailability;
    return {
      id: session.id,
      name: session.name,
      startsAt: session.starts_at,
      endsAt: session.ends_at,
      capacity: session.capacity,
      inteiraQuota: session.inteira_quota,
      meiaQuota: session.meia_quota,
      prices: Object.fromEntries(
        sessionPrices.flatMap((row) => {
          const key = row.session_id === session.id ? typeKeyById.get(row.ticket_type_id) : null;
          return key
            ? [[key, { priceCents: row.price_cents, maxUnits: row.max_units, onSale: row.on_sale }]]
            : [];
        }),
      ),
      sold: sessionAvailability?.sold ?? 0,
      occupied,
      hasOrders: stats.hasOrders,
      liveOrders,
      paidOrders: stats.paidOrders,
      lockedFields: lockedFieldsFor(event.approval_status, liveOrders),
    };
  });

  const now = nowMs();
  const approved = event.approval_status === "aprovado";
  const inReview = event.approval_status === "em_analise";
  const onSaleBySession = new Set(
    sessionPrices
      .filter((row) => row.on_sale && typeKeyById.has(row.ticket_type_id))
      .map((row) => row.session_id),
  );
  const missing = [
    ...(event.cover_image_url?.trim() ? [] : ["Capa do evento"]),
    ...(activeSessions.some((session) => Date.parse(session.starts_at) > now)
      ? []
      : ["Uma sessão com data futura"]),
    ...(activeSessions.length && activeSessions.every((session) => onSaleBySession.has(session.id))
      ? []
      : ["Preço de pelo menos um tipo de ingresso em cada sessão"]),
  ];

  const summaryById = new Map((summary?.sessions ?? []).map((session) => [session.id, session]));
  const salesSessions: OrganizerSalesSession[] = sessions.map((session) => {
    const sale = summaryById.get(session.id);
    const sessionAvailability = availabilityBySession.get(session.id) ?? null;
    return {
      id: session.id,
      label: formatSessionLabel(session.name, session.starts_at, session.ends_at),
      cancelled: session.status === "cancelada",
      closed: sessionSalesClosesAt(session.starts_at).getTime() <= now,
      salesOpen: session.sales_open,
      selling: sale?.selling ?? false,
      soldOut: sale?.soldOut ?? false,
      sold: sessionAvailability?.sold ?? null,
      remaining: sale?.remaining ?? sessionAvailability?.remaining ?? null,
    };
  });

  const lastSession = activeSessions.at(-1);
  const share = eventShareModel({
    name: event.name,
    slug: event.slug,
    whenLabel: formatEventDays(activeSessions.map((session) => session.starts_at)),
    approvalStatus: event.approval_status,
    organizerId: event.organizer_id,
    deletedAt: event.deleted_at,
    lastSessionAt: lastSession ? (lastSession.ends_at ?? lastSession.starts_at) : null,
    appUrl: publicAppBaseUrl(),
    now: new Date(now),
  });
  const status = organizerEventStatus({
    approvalStatus: event.approval_status,
    salesOpen: event.sales_open,
    lastSessionAt: lastSession ? (lastSession.ends_at ?? lastSession.starts_at) : null,
  });
  const hasSales =
    Boolean(ordersResult.error) ||
    (orderRows ?? []).some(
      (order) =>
        SOLD_STATUSES.has(order.status) ||
        (order.status === "pendente" && order.expires_at !== null && Date.parse(order.expires_at) > now),
    );
  const deletionPending = requests.some((request) => request.kind === "exclusao" && request.status === "pendente");

  const initialTab: OrganizerEventTabId = ORGANIZER_EVENT_TABS.some((item) => item.id === query.aba)
    ? (query.aba as OrganizerEventTabId)
    : "evento";

  let refundPixKey: string | null = null;
  if (finance && payoutSituation(finance).kind === "devolucao") {
    refundPixKey = process.env.ORGANIZER_REFUND_PIX_KEY?.trim() || null;
    if (!refundPixKey) {
      await alertTeamSetup(admin, "pix_devolucao_sem_chave", "Configure ORGANIZER_REFUND_PIX_KEY no ambiente do site.");
    }
  }

  return (
    <main className="mx-auto w-full max-w-6xl px-4 pb-16 pt-2 sm:px-6 sm:pt-4">
      <BackLink href="/organizador">Meus eventos</BackLink>

      <header className="mt-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h1 className="min-w-0 break-words font-display text-4xl tracking-wide text-foreground sm:text-5xl">
            {event.name}
          </h1>
          <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
        </div>
        <div className="mt-4">
          <ApprovalBanner
            approvalNote={event.approval_note}
            approvalStatus={event.approval_status}
            eventId={event.id}
            missing={missing}
            salesOpen={event.sales_open}
          />
        </div>
        <EventSharePanel model={share} />
      </header>

      <OrganizerEventTabs
        deleteSection={
          <DeleteEventSection
            deletionPending={deletionPending}
            eventId={event.id}
            eventName={event.name}
            hasSales={hasSales}
          />
        }
        eventId={event.id}
        evento={
          <>
            <h2 className="text-xl font-semibold text-foreground" id="evento-titulo">
              Evento
            </h2>
            <div className="mt-3 grid gap-6">
              {editorLoadFailed ? (
                <Notice tone="danger">Não foi possível carregar os dados do evento. Atualize a página.</Notice>
              ) : (
                <EventForm
                  area="organizador"
                  event={{
                    id: event.id,
                    name: event.name,
                    venue: event.venue,
                    description: event.description,
                    ticketTypes: editorTypes,
                    sessions: editorSessions,
                    coverImageUrl: event.cover_image_url,
                  }}
                  inReview={inReview}
                  lockedFields={lockedFieldsFor(event.approval_status, false)}
                />
              )}
              <fieldset className="min-w-0" disabled={inReview}>
                <EventGalleryManager eventId={event.id} images={gallery} />
              </fieldset>
            </div>
          </>
        }
        financeiro={
          <>
            <h2 className="text-xl font-semibold text-foreground" id="financeiro-titulo">
              Financeiro
            </h2>
            <div className="mt-3">
              {finance ? (
                <OrganizerFinancePanel finance={finance} refundPixKey={refundPixKey} />
              ) : (
                <Notice tone="danger">Não foi possível carregar o financeiro. Atualize a página.</Notice>
              )}
            </div>
          </>
        }
        initialTab={initialTab}
        pedidos={
          <>
            <h2 className="text-xl font-semibold text-foreground" id="pedidos-titulo">
              Pedidos
            </h2>
            <div className="mt-3">
              {buyerOrders.error ? (
                <Notice tone="danger">Não foi possível carregar os pedidos. Atualize a página.</Notice>
              ) : (
                <OrganizerOrderList orders={orders} />
              )}
            </div>
          </>
        }
        pedidosEquipe={
          <>
            <h2 className="text-xl font-semibold text-foreground" id="pedidos-equipe-titulo">
              Pedidos à equipe
            </h2>
            <div className="mt-3">
              {opsRequests.error ? (
                <Notice tone="danger">Não foi possível carregar os pedidos à equipe. Atualize a página.</Notice>
              ) : (
                <OpsRequestList requests={requests} />
              )}
            </div>
          </>
        }
        portaria={
          <>
            <h2 className="text-xl font-semibold text-foreground" id="portaria-titulo">
              Portaria
            </h2>
            <div className="mt-3 grid gap-3">
              {approved ? (
                <>
                  <p className="text-base text-byla-muted">
                    Na entrada, leia o QR Code de cada ingresso com a câmera do celular.
                  </p>
                  <ButtonLink fullWidth href={`/organizador/eventos/${event.id}/portaria`} size="lg">
                    Abrir leitor de QR Code
                  </ButtonLink>
                </>
              ) : (
                <p className="text-base text-byla-muted">
                  A portaria fica disponível depois que a ACDH Eventos aprovar o evento.
                </p>
              )}
            </div>
          </>
        }
        vendas={
          <>
            <h2 className="text-xl font-semibold text-foreground" id="vendas-titulo">
              Vendas
            </h2>
            <div className="mt-3">
              <OrganizerSalesPanel
                approved={approved}
                eventId={event.id}
                eventSalesOpen={event.sales_open}
                sessions={salesSessions}
              />
            </div>
          </>
        }
      />
    </main>
  );
}
