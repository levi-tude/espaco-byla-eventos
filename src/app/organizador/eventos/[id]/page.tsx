import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { EventForm } from "@/components/equipe/EventForm";
import { EventGalleryManager } from "@/components/equipe/EventGalleryManager";
import { type EditorSession, savedTypeKey } from "@/components/equipe/session-drafts";
import type { EditorTicketType } from "@/components/equipe/TicketTypesEditor";
import { ApprovalBanner } from "@/components/organizer/ApprovalBanner";
import { organizerEventStatus } from "@/components/organizer/OrganizerEventCard";
import { OrganizerNoAccess } from "@/components/organizer/OrganizerNoAccess";
import { OrganizerSalesPanel, type OrganizerSalesSession } from "@/components/organizer/OrganizerSalesPanel";
import { BackLink } from "@/components/ui/BackLink";
import { cx } from "@/components/ui/cx";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { getActor, requireEventAccess } from "@/lib/auth/actor";
import { formatSessionLabel } from "@/lib/datetime";
import type { EventAvailabilityWithTypes } from "@/lib/domain/availability";
import { loadEventSessions, loadSessionAvailability } from "@/lib/domain/event-availability";
import { orderStatsFor, sessionOrderStats, sumAvailability } from "@/lib/domain/session-panel";
import { sessionSalesClosesAt } from "@/lib/domain/sessions";
import { loadEventGallery } from "@/lib/media/gallery";
import { lockedFieldsFor } from "@/lib/organizer/post-approval";
import { organizerAreaEnabled } from "@/lib/organizer/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Meu evento",
  robots: { index: false, follow: false },
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Abas do celular (no computador, tudo aparece em colunas). Novas abas entram aqui. */
const TABS = [
  { id: "evento", label: "Evento" },
  { id: "vendas", label: "Vendas" },
] as const;
type TabId = (typeof TABS)[number]["id"];

const tabClass =
  "inline-flex min-h-11 items-center whitespace-nowrap rounded-lg border px-4 text-base font-medium no-underline transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-byla-blue";

function nowMs() {
  return Date.now();
}

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function EventoOrganizadorPage({ params, searchParams }: Props) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const actor = await getActor();
  if (actor?.kind !== "organizador") {
    return <OrganizerNoAccess areaEnabled={await organizerAreaEnabled()} />;
  }
  if (!UUID_PATTERN.test(id)) notFound();
  const access = await requireEventAccess(id).catch(() => null);
  if (access?.access !== "dono") notFound();

  const supabase = await createServerClient();
  const [{ data: event }, { data: ticketTypes }, { data: sessionRows }] = await Promise.all([
    supabase
      .from("events")
      .select(
        "id, slug, name, venue, description, cover_image_url, sales_open, approval_status, approval_note, organizer_id, deleted_at",
      )
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("ticket_types")
      .select("id, preset, name, kind, people_per_unit")
      .eq("event_id", id)
      .neq("kind", "cortesia")
      .is("archived_at", null)
      .order("sort_order")
      .order("id"),
    supabase
      .from("event_sessions")
      .select("id, name, starts_at, ends_at, capacity, inteira_quota, meia_quota, sales_open, status")
      .eq("event_id", id)
      .is("archived_at", null)
      .order("starts_at"),
  ]);
  if (!event || event.organizer_id !== actor.userId || event.deleted_at) notFound();

  const sessions = sessionRows ?? [];
  const activeSessions = sessions.filter((session) => session.status === "ativa");
  const sessionIds = sessions.map((session) => session.id);

  // Pedidos e lotação só com service_role: o acesso de dono já foi conferido acima.
  const admin = createAdminClient();
  const [gallery, { data: sessionPrices }, { data: orderRows }, availabilities, summary] =
    await Promise.all([
      loadEventGallery(supabase, event.id),
      sessionIds.length
        ? supabase
            .from("session_ticket_types")
            .select("session_id, ticket_type_id, price_cents, max_units, on_sale")
            .in("session_id", sessionIds)
        : Promise.resolve({ data: [] }),
      admin.from("orders").select("session_id, status, expires_at").eq("event_id", event.id),
      Promise.all(sessions.map((session) => loadSessionAvailability(admin, session.id))),
      loadEventSessions(admin, event.id),
    ]);
  const availabilityBySession = new Map<string, EventAvailabilityWithTypes | null>(
    sessions.map((session, index) => [session.id, availabilities[index]]),
  );

  const types = ticketTypes ?? [];
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
    // Sem a contagem do banco, a sessão fica protegida (travada e sem remover).
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
        (sessionPrices ?? []).flatMap((row) => {
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
    (sessionPrices ?? [])
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
  const status = organizerEventStatus({
    approvalStatus: event.approval_status,
    salesOpen: event.sales_open,
    lastSessionAt: lastSession ? (lastSession.ends_at ?? lastSession.starts_at) : null,
  });
  const tab: TabId = TABS.some((item) => item.id === query.aba) ? (query.aba as TabId) : "evento";
  const shownOnMobile = (section: TabId) => (tab === section ? "" : "hidden lg:block");

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
      </header>

      <nav aria-label="Partes do evento" className="mt-6 lg:hidden">
        <ul className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
          {TABS.map((item) => {
            const current = item.id === tab;
            return (
              <li className="shrink-0" key={item.id}>
                <Link
                  aria-current={current ? "page" : undefined}
                  className={cx(
                    tabClass,
                    current
                      ? "border-byla-action bg-byla-action text-white"
                      : "border-byla-border text-foreground hover:bg-byla-overlay",
                  )}
                  href={
                    item.id === "evento"
                      ? `/organizador/eventos/${event.id}`
                      : `/organizador/eventos/${event.id}?aba=${item.id}`
                  }
                  scroll={false}
                >
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="mt-6 grid gap-10 lg:mt-8 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start lg:gap-8">
        <section aria-labelledby="evento-titulo" className={shownOnMobile("evento")}>
          <h2 className="text-xl font-semibold text-foreground" id="evento-titulo">
            Evento
          </h2>
          <div className="mt-3 grid gap-6">
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
            <fieldset className="min-w-0" disabled={inReview}>
              <EventGalleryManager eventId={event.id} images={gallery} />
            </fieldset>
          </div>
        </section>

        <section aria-labelledby="vendas-titulo" className={shownOnMobile("vendas")}>
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
        </section>
      </div>
    </main>
  );
}
