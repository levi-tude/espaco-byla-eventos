import { ExternalLink, ScanLine } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { AutoRefresh } from "@/components/equipe/AutoRefresh";
import { DecisionQueue } from "@/components/equipe/DecisionQueue";
import { EventForm } from "@/components/equipe/EventForm";
import { EventGalleryManager } from "@/components/equipe/EventGalleryManager";
import { RefundHistory } from "@/components/equipe/RefundHistory";
import { SalesToggle } from "@/components/equipe/SalesToggle";
import { type EditorSession, savedTypeKey } from "@/components/equipe/session-drafts";
import { SessionOpsPanel } from "@/components/equipe/SessionOpsPanel";
import { SessionSalesToggle } from "@/components/equipe/SessionSalesToggle";
import { CourtesyForm, TicketList } from "@/components/equipe/TicketList";
import type { EditorTicketType } from "@/components/equipe/TicketTypesEditor";
import { BackLink } from "@/components/ui/BackLink";
import { ButtonLink } from "@/components/ui/Button";
import { cx } from "@/components/ui/cx";
import { Notice } from "@/components/ui/Notice";
import { StatusBadge } from "@/components/ui/StatusBadge";
import type { Tone } from "@/components/ui/tone";
import {
  eventDateFormatter,
  formatSessionLabel,
  formatSessionShort,
  formatSessionTime,
} from "@/lib/datetime";
import { type EventAvailabilityWithTypes, salesState } from "@/lib/domain/availability";
import { loadSessionAvailability } from "@/lib/domain/event-availability";
import {
  orderStatsFor,
  selectPanelSession,
  sessionOrderStats,
  sumAvailability,
} from "@/lib/domain/session-panel";
import { parseSessionOpsSummary } from "@/lib/domain/session-ops";
import { sessionSalesClosesAt } from "@/lib/domain/sessions";
import { isRecentlyPaid } from "@/lib/domain/status";
import { orderItemName as itemName, ticketTypeLabel } from "@/lib/domain/ticket-types";
import { loadEventGallery } from "@/lib/media/gallery";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerClient } from "@/lib/supabase/server";

const teamSales: Record<ReturnType<typeof salesState>, { label: string; tone: Tone }> = {
  open: { label: "Venda aberta", tone: "success" },
  closed: { label: "Venda fechada", tone: "neutral" },
  sold_out: { label: "Esgotado", tone: "danger" },
  held: { label: "Venda aberta", tone: "warning" },
};

const dateFormatter = eventDateFormatter({ dateStyle: "full", timeStyle: "short" });

const currency = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

/** Ao pular por um atalho, a barra fixa de atalhos não pode cobrir o título da seção. */
const sectionClass = "scroll-mt-20";

const tabClass =
  "inline-flex min-h-11 items-center whitespace-nowrap rounded-lg border px-3 text-base font-medium no-underline transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-byla-blue";

type Stat = { label: string; value: string | number; hint?: string | null };

function nowMs() {
  return Date.now();
}

function sessionLabelOf(session: { name: string | null; starts_at: string; ends_at: string | null }) {
  return formatSessionLabel(session.name, session.starts_at, session.ends_at);
}

export default async function EventoEquipePage({
  params,
  searchParams,
}: PageProps<"/equipe/eventos/[id]">) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const supabase = await createServerClient();
  const [
    { data: isStaff },
    { data: event },
    { data: ticketTypes },
    { data: sessionRows },
    { data: tickets },
    { data: decisionOrders },
    { data: refunds },
    { data: orderRows },
  ] = await Promise.all([
    supabase.rpc("is_staff"),
    supabase.from("events").select("*").eq("id", id).maybeSingle(),
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
    supabase
      .from("tickets")
      .select(
        "id, order_id, session_id, buyer_name, kind, status, price_cents, checked_in_at, order_items(name), orders!inner(buyer_email, paid_at, public_token, status, decision_reason, total_cents, payment_provider)",
      )
      .eq("event_id", id)
      .order("created_at", { ascending: false }),
    supabase
      .from("orders")
      .select(
        "id, session_id, buyer_name, buyer_email, total_cents, paid_at, decision_reason, payment_provider, tickets(id, kind, buyer_name, status, order_items(name))",
      )
      .eq("event_id", id)
      .eq("status", "aguardando_decisao")
      .order("paid_at", { ascending: true }),
    supabase
      .from("order_refunds")
      .select(
        "id, order_id, status, amount_cents, reason, requested_by_name, created_at, completed_at, error_code, orders!inner(event_id, buyer_name, session_id)",
      )
      .eq("orders.event_id", id)
      .order("created_at", { ascending: false }),
    supabase.from("orders").select("session_id, status, expires_at").eq("event_id", id),
  ]);

  if (!isStaff || !event) notFound();

  const sessions = sessionRows ?? [];
  const activeSessions = sessions.filter((session) => session.status === "ativa");
  const sessionIds = sessions.map((session) => session.id);
  const multi = sessions.length > 1;
  const selected = selectPanelSession(sessions, query.sessao);
  const labels = new Map(sessions.map((session) => [session.id, sessionLabelOf(session)]));

  const admin = createAdminClient();
  const [gallery, { data: sessionPrices }, { data: opsData, error: opsError }, availabilities] =
    await Promise.all([
      loadEventGallery(supabase, event.id),
      sessionIds.length
        ? supabase
            .from("session_ticket_types")
            .select("session_id, ticket_type_id, price_cents, max_units, on_sale")
            .in("session_id", sessionIds)
        : Promise.resolve({ data: [] }),
      selected
        ? admin.rpc("session_ops_summary", { p_session_id: selected.id })
        : Promise.resolve({ data: null, error: null }),
      Promise.all(sessions.map((session) => loadSessionAvailability(admin, session.id))),
    ]);
  const availabilityBySession = new Map<string, EventAvailabilityWithTypes | null>(
    sessions.map((session, index) => [session.id, availabilities[index]]),
  );
  const availability = selected
    ? (availabilityBySession.get(selected.id) ?? null)
    : sumAvailability(availabilities);

  const types = ticketTypes ?? [];
  const typeKeyById = new Map(types.map((type) => [type.id, savedTypeKey(type)]));
  const allSessionsAvailability = sumAvailability(availabilities);
  const typeTotals = new Map(
    (allSessionsAvailability?.types ?? []).map((type) => [type.ticketTypeId, type]),
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
    const occupied = sessionAvailability
      ? sessionAvailability.sold + sessionAvailability.held
      : 0;
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
      // Sem a contagem do banco, a sessão fica protegida (não pode ser removida).
      liveOrders: stats.liveOrders || occupied > 0 || !sessionAvailability,
      paidOrders: stats.paidOrders,
    };
  });

  const inScope = (sessionId: string | null | undefined) =>
    !multi || !selected || sessionId === selected.id;

  const listItems = (tickets ?? [])
    .filter((ticket) => inScope(ticket.session_id))
    .map((ticket) => {
      const order = Array.isArray(ticket.orders) ? ticket.orders[0] : ticket.orders;
      return {
        id: ticket.id,
        orderId: ticket.order_id,
        orderTotalCents: order.total_cents,
        paymentProvider: order.payment_provider,
        buyerName: ticket.buyer_name,
        buyerEmail: order.buyer_email,
        kind: ticket.kind,
        typeLabel: ticketTypeLabel(itemName(ticket.order_items), ticket.kind),
        status: ticket.status,
        orderStatus: order.status,
        decisionReason: order.decision_reason,
        priceCents: ticket.price_cents,
        paidAt: order.paid_at,
        recentlyPaid:
          ticket.kind !== "cortesia" &&
          order.status === "pago" &&
          (ticket.status === "pago" || ticket.status === "check_in") &&
          isRecentlyPaid(order.paid_at),
        checkedInAt: ticket.checked_in_at,
        publicToken: order.public_token,
        sessionLabel: multi && !selected ? (labels.get(ticket.session_id) ?? null) : null,
      };
    });
  const validTickets = listItems.filter(
    ({ status }) => status === "pago" || status === "check_in",
  );
  const revenueCents = validTickets.reduce((total, ticket) => total + ticket.priceCents, 0);
  const byType = [
    ...validTickets
      .reduce(
        (counts, ticket) =>
          counts.set(ticket.typeLabel, (counts.get(ticket.typeLabel) ?? 0) + 1),
        new Map<string, number>(),
      )
      .entries(),
  ];

  const capacity = selected
    ? selected.capacity
    : sessions.reduce((total, session) => total + session.capacity, 0) || event.capacity;
  const soldCount = availability?.sold ?? validTickets.length;
  const remaining = availability?.remaining ?? Math.max(capacity - soldCount, 0);
  const state = salesState(
    event.sales_open && (selected ? selected.sales_open : true),
    availability,
  );
  const sales = teamSales[state];

  const categoryStats: Stat[] = availability
    ? (["inteira", "meia"] as const).map((kind) => {
        const category = availability.categories[kind];
        const held = category.taken - category.sold;
        return {
          label: kind === "inteira" ? "Inteiras vendidas" : "Meias vendidas",
          value:
            category.quota === null
              ? String(category.sold)
              : `${category.sold} / ${category.quota}`,
          hint: [
            held > 0 ? `${held} reservada${held === 1 ? "" : "s"} agora` : null,
            category.quota === null
              ? "sem quantidade separada"
              : `restam ${category.remaining ?? 0}`,
          ]
            .filter(Boolean)
            .join(" · "),
        };
      })
    : (["inteira", "meia"] as const).map((kind) => ({
        label: kind === "inteira" ? "Inteiras" : "Meias",
        value: validTickets.filter((ticket) => ticket.kind === kind).length,
      }));
  const stats: Stat[] = [
    { label: "Vendidos", value: soldCount, hint: "inclui cortesias" },
    {
      label: "Reservados agora",
      value: availability ? availability.held : "—",
      hint: "compras aguardando pagamento",
    },
    { label: "Restantes", value: remaining },
    { label: "Lotação", value: capacity },
    ...categoryStats,
    {
      label: "Cortesias",
      value: validTickets.filter(({ kind }) => kind === "cortesia").length,
    },
    { label: "Total vendido", value: currency.format(revenueCents / 100) },
  ];

  const selectedAvailability = selected ? (availabilityBySession.get(selected.id) ?? null) : null;
  const selectedPrices = selected
    ? types.map((type) => {
        const row = (sessionPrices ?? []).find(
          (price) => price.session_id === selected.id && price.ticket_type_id === type.id,
        );
        const typeAvailability = selectedAvailability?.types.find(
          (item) => item.ticketTypeId === type.id,
        );
        return {
          id: type.id,
          name: type.name,
          onSale: row?.on_sale ?? false,
          priceCents: row?.price_cents ?? null,
          maxUnits: row?.max_units ?? null,
          unitsSold: typeAvailability?.unitsSold ?? 0,
        };
      })
    : [];
  const now = nowMs();
  const closesAt = selected ? sessionSalesClosesAt(selected.starts_at) : null;
  const closesPassed = closesAt ? closesAt.getTime() <= now : false;
  if (opsError) console.error("[painel] Falha ao carregar o resumo da sessão.", { error: opsError.message });
  const opsSummary = selected ? parseSessionOpsSummary(opsData) : null;

  const pendingDecisions = (decisionOrders ?? []).filter((order) => inScope(order.session_id));
  const nextSession =
    activeSessions.find((session) => Date.parse(session.starts_at) > now) ?? null;
  const checkInHref = `/equipe/eventos/${event.id}/check-in${
    multi && selected ? `?sessao=${selected.id}` : ""
  }`;

  const courtesySessions = activeSessions.map((session) => ({
    id: session.id,
    label: labels.get(session.id) ?? "",
    remaining: availabilityBySession.get(session.id)?.remaining ?? session.capacity,
  }));

  const shortcuts = [
    { id: "vendas", label: "Vendas" },
    ...(pendingDecisions.length ? [{ id: "decisao", label: "Decisões" }] : []),
    { id: "participantes", label: "Participantes" },
    { id: "cortesia", label: "Cortesia" },
    { id: "editar", label: "Editar" },
  ];

  return (
    <main className="mx-auto w-full max-w-6xl px-4 pb-16 pt-2 sm:px-6 sm:pt-4">
      <AutoRefresh />
      <BackLink href="/equipe">Eventos</BackLink>

      <header className="mt-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h1 className="min-w-0 break-words font-display text-4xl tracking-wide text-foreground sm:text-5xl">
            {event.name}
          </h1>
          <StatusBadge tone={sales.tone}>{sales.label}</StatusBadge>
        </div>
        <p className="mt-2 text-base text-byla-muted">
          {multi
            ? `${sessions.length} sessões${
                nextSession ? ` · próxima: ${formatSessionShort(nextSession.starts_at)}` : ""
              }`
            : dateFormatter.format(new Date(sessions[0]?.starts_at ?? event.starts_at))}
          {event.venue ? ` · ${event.venue}` : ""}
        </p>
        {state === "held" ? (
          <p className="mt-1 text-sm font-medium text-byla-warning">
            Lugares restantes reservados por compras em andamento.
          </p>
        ) : null}

        <div className="mt-5 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
          <ButtonLink className="col-span-2" href={checkInHref}>
            <ScanLine aria-hidden className="h-5 w-5" />
            {multi && selected ? "Check-in desta sessão" : "Abrir check-in"}
          </ButtonLink>
          <ButtonLink href={`/eventos/${event.slug}`} target="_blank" variant="secondary">
            Ver página
            <ExternalLink aria-hidden className="h-4 w-4" />
            <span className="sr-only">(abre em nova aba)</span>
          </ButtonLink>
          <SalesToggle eventId={event.id} salesOpen={event.sales_open} />
        </div>
      </header>

      {multi ? (
        <nav aria-label="Sessões do evento" className="mt-6">
          <ul className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:px-0">
            <li className="shrink-0">
              <Link
                aria-current={!selected ? "page" : undefined}
                className={cx(
                  tabClass,
                  !selected
                    ? "border-byla-action bg-byla-action text-white"
                    : "border-byla-border text-foreground hover:bg-byla-overlay",
                )}
                href={`/equipe/eventos/${event.id}`}
                scroll={false}
              >
                Todas
              </Link>
            </li>
            {sessions.map((session) => {
              const current = selected?.id === session.id;
              return (
                <li className="shrink-0" key={session.id}>
                  <Link
                    aria-current={current ? "page" : undefined}
                    className={cx(
                      tabClass,
                      current
                        ? "border-byla-action bg-byla-action text-white"
                        : "border-byla-border text-foreground hover:bg-byla-overlay",
                      session.status === "cancelada" && !current && "line-through",
                    )}
                    href={`/equipe/eventos/${event.id}?sessao=${session.id}`}
                    scroll={false}
                  >
                    {labels.get(session.id)}
                    {session.status === "cancelada" ? " (cancelada)" : ""}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      ) : null}

      <nav
        aria-label="Seções do painel"
        className="sticky top-0 z-20 -mx-4 mt-6 border-b border-byla-border bg-byla-bg/95 px-4 backdrop-blur sm:-mx-6 sm:px-6"
      >
        <ul className="flex gap-1 overflow-x-auto py-1 pr-6 [mask-image:linear-gradient(to_right,black_85%,transparent)] [scrollbar-width:none] sm:pr-0 sm:[mask-image:none]">
          {shortcuts.map((shortcut) => (
            <li className="shrink-0" key={shortcut.id}>
              <a
                className="inline-flex min-h-11 items-center rounded-lg px-3 text-base font-medium text-byla-muted no-underline transition hover:bg-byla-overlay hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-byla-blue"
                href={`#${shortcut.id}`}
              >
                {shortcut.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <div className="mt-8 grid gap-10 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start lg:gap-8">
        <div className="grid min-w-0 gap-10">
          <section aria-labelledby="vendas-titulo" className={sectionClass} id="vendas">
            <h2 className="text-xl font-semibold text-foreground" id="vendas-titulo">
              {multi ? (selected ? `Vendas · ${labels.get(selected.id)}` : "Vendas · todas as sessões") : "Vendas"}
            </h2>
            {selected && closesAt ? (
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
                <p className="text-base text-byla-muted">
                  {selected.status === "cancelada"
                    ? "Sessão cancelada."
                    : !selected.sales_open
                      ? "Vendas desta sessão encerradas pela equipe."
                      : closesPassed
                        ? `Vendas encerradas às ${formatSessionTime(closesAt)}.`
                        : `A venda encerra sozinha às ${formatSessionTime(closesAt)}.`}
                </p>
                {selected.status === "ativa" && !closesPassed && (multi || !selected.sales_open) ? (
                  <SessionSalesToggle salesOpen={selected.sales_open} sessionId={selected.id} />
                ) : null}
              </div>
            ) : null}
            {selected && opsSummary ? (
              <SessionOpsPanel
                sessionLabel={labels.get(selected.id) ?? ""}
                started={Date.parse(selected.starts_at) <= now}
                summary={opsSummary}
              />
            ) : selected && opsError ? (
              <Notice className="mt-3" tone="danger">
                Não foi possível carregar avisos e cancelamento desta sessão. Atualize a página.
              </Notice>
            ) : null}
            <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {stats.map((stat) => (
                <div
                  className="rounded-xl border border-byla-border bg-byla-surface p-4"
                  key={stat.label}
                >
                  <dt className="text-sm text-byla-muted">{stat.label}</dt>
                  <dd className="mt-1 break-words text-2xl font-semibold tabular-nums text-foreground">
                    {stat.value}
                  </dd>
                  {stat.hint ? (
                    <dd className="mt-1 text-sm text-byla-muted">{stat.hint}</dd>
                  ) : null}
                </div>
              ))}
            </dl>
            {byType.length ? (
              <p className="mt-3 text-sm text-byla-muted">
                Ingressos válidos por tipo:{" "}
                {byType.map(([label, count]) => `${label}: ${count}`).join(" · ")}
              </p>
            ) : null}
            {multi && selected && selectedPrices.length ? (
              <div className="mt-4 rounded-xl border border-byla-border bg-byla-surface p-4">
                <h3 className="text-base font-semibold">Preços desta sessão</h3>
                <ul className="mt-2 grid gap-1.5">
                  {selectedPrices.map((price) => (
                    <li
                      className="flex flex-wrap items-baseline justify-between gap-x-3 text-base"
                      key={price.id}
                    >
                      <span className="font-medium">{price.name}</span>
                      <span className="text-byla-muted">
                        {price.onSale && price.priceCents !== null
                          ? currency.format(price.priceCents / 100)
                          : "Fora da venda"}
                        {` · vendidos ${price.unitsSold}`}
                        {price.maxUnits !== null ? ` de ${price.maxUnits}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>

          <DecisionQueue
            capacity={capacity}
            className={sectionClass}
            id="decisao"
            occupied={availability ? availability.sold + availability.held : null}
            orders={pendingDecisions.map((order) => {
              const orderAvailability = availabilityBySession.get(order.session_id) ?? null;
              const orderSession = sessions.find((session) => session.id === order.session_id);
              return {
                orderId: order.id,
                buyerName: order.buyer_name,
                buyerEmail: order.buyer_email,
                totalCents: order.total_cents,
                paidAt: order.paid_at,
                decisionReason: order.decision_reason,
                ticketCount: order.tickets.length,
                paymentProvider: order.payment_provider,
                hasCheckIn: order.tickets.some(({ status }) => status === "check_in"),
                ticketLabels: order.tickets.map(
                  (ticket) =>
                    `${ticketTypeLabel(itemName(ticket.order_items), ticket.kind)} — ${ticket.buyer_name}`,
                ),
                ...(multi
                  ? {
                      sessionLabel: labels.get(order.session_id) ?? null,
                      capacity: orderSession?.capacity ?? capacity,
                      occupied: orderAvailability
                        ? orderAvailability.sold + orderAvailability.held
                        : null,
                    }
                  : {}),
              };
            })}
          />

          <TicketList className={sectionClass} eventId={event.id} id="participantes" tickets={listItems} />
        </div>

        <div className="grid min-w-0 gap-10">
          <CourtesyForm
            className={sectionClass}
            defaultSessionId={selected?.status === "ativa" ? selected.id : null}
            eventId={event.id}
            id="cortesia"
            remaining={remaining}
            sessions={courtesySessions}
          />

          <RefundHistory
            refunds={(refunds ?? [])
              .filter((refund) => {
                const order = Array.isArray(refund.orders) ? refund.orders[0] : refund.orders;
                return inScope(order?.session_id);
              })
              .map((refund) => {
                const order = Array.isArray(refund.orders) ? refund.orders[0] : refund.orders;
                return {
                  id: refund.id,
                  orderId: refund.order_id,
                  buyerName: order?.buyer_name ?? "—",
                  amountCents: refund.amount_cents,
                  status: refund.status,
                  reason: refund.reason,
                  requestedByName: refund.requested_by_name,
                  createdAt: refund.created_at,
                  completedAt: refund.completed_at,
                  errorCode: refund.error_code,
                };
              })}
          />

          <section aria-labelledby="editar-titulo" className={sectionClass} id="editar">
            <h2 className="text-xl font-semibold text-foreground" id="editar-titulo">
              Editar evento
            </h2>
            <div className="mt-3 grid gap-6">
              <EventForm
                event={{
                  id: event.id,
                  name: event.name,
                  venue: event.venue,
                  description: event.description,
                  ticketTypes: editorTypes,
                  sessions: editorSessions,
                  coverImageUrl: event.cover_image_url,
                }}
              />
              <EventGalleryManager eventId={event.id} images={gallery} />
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
