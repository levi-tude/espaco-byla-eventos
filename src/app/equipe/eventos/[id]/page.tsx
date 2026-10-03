import { ExternalLink, ScanLine } from "lucide-react";
import { notFound } from "next/navigation";

import { AutoRefresh } from "@/components/equipe/AutoRefresh";
import { DecisionQueue } from "@/components/equipe/DecisionQueue";
import { EventForm } from "@/components/equipe/EventForm";
import { EventGalleryManager } from "@/components/equipe/EventGalleryManager";
import { RefundHistory } from "@/components/equipe/RefundHistory";
import { SalesToggle } from "@/components/equipe/SalesToggle";
import { CourtesyForm, TicketList } from "@/components/equipe/TicketList";
import type { EditorTicketType } from "@/components/equipe/TicketTypesEditor";
import { BackLink } from "@/components/ui/BackLink";
import { ButtonLink } from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/StatusBadge";
import type { Tone } from "@/components/ui/tone";
import { eventDateFormatter } from "@/lib/datetime";
import { salesState } from "@/lib/domain/availability";
import { loadEventAvailability } from "@/lib/domain/event-availability";
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

type Stat = { label: string; value: string | number; hint?: string | null };

export default async function EventoEquipePage({
  params,
}: PageProps<"/equipe/eventos/[id]">) {
  const { id } = await params;
  const supabase = await createServerClient();
  const [
    { data: isStaff },
    { data: event },
    { data: ticketTypes },
    { count: sold },
    { data: tickets },
    { data: decisionOrders },
    { data: refunds },
  ] = await Promise.all([
    supabase.rpc("is_staff"),
    supabase.from("events").select("*").eq("id", id).maybeSingle(),
    supabase
      .from("ticket_types")
      .select("id, preset, name, kind, price_cents, people_per_unit, max_units")
      .eq("event_id", id)
      .neq("kind", "cortesia")
      .is("archived_at", null)
      .order("sort_order")
      .order("id"),
    supabase
      .from("tickets")
      .select("id", { count: "exact", head: true })
      .eq("event_id", id)
      .in("status", ["pago", "check_in"]),
    supabase
      .from("tickets")
      .select(
        "id, order_id, buyer_name, kind, status, price_cents, checked_in_at, order_items(name), orders!inner(buyer_email, paid_at, public_token, status, decision_reason, total_cents, payment_provider)",
      )
      .eq("event_id", id)
      .order("created_at", { ascending: false }),
    supabase
      .from("orders")
      .select(
        "id, buyer_name, buyer_email, total_cents, paid_at, decision_reason, payment_provider, tickets(id, kind, buyer_name, status, order_items(name))",
      )
      .eq("event_id", id)
      .eq("status", "aguardando_decisao")
      .order("paid_at", { ascending: true }),
    supabase
      .from("order_refunds")
      .select(
        "id, order_id, status, amount_cents, reason, requested_by_name, created_at, completed_at, error_code, orders!inner(event_id, buyer_name)",
      )
      .eq("orders.event_id", id)
      .order("created_at", { ascending: false }),
  ]);

  if (!isStaff || !event) notFound();

  const gallery = await loadEventGallery(supabase, event.id);

  const availability = await loadEventAvailability(createAdminClient(), event);
  const typeAvailability = new Map(
    (availability?.types ?? []).map((type) => [type.ticketTypeId, type]),
  );
  const editorTypes: EditorTicketType[] = (ticketTypes ?? []).map((type) => {
    const current = typeAvailability.get(type.id);
    return {
      id: type.id,
      preset: type.preset,
      name: type.name,
      priceCents: type.price_cents,
      peoplePerUnit: type.people_per_unit,
      maxUnits: type.max_units,
      hasSales: current?.hasSales ?? true,
      unitsSold: current?.unitsSold ?? 0,
      unitsTaken: current?.unitsTaken ?? 0,
    };
  });
  const soldCount = availability?.sold ?? sold ?? 0;
  const remaining =
    availability?.remaining ?? Math.max(event.capacity - soldCount, 0);
  const state = salesState(event.sales_open, availability);
  const sales = teamSales[state];

  const listItems = (tickets ?? []).map((ticket) => {
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
    { label: "Lotação", value: event.capacity },
    ...categoryStats,
    {
      label: "Cortesias",
      value: validTickets.filter(({ kind }) => kind === "cortesia").length,
    },
    { label: "Total vendido", value: currency.format(revenueCents / 100) },
  ];

  const pendingDecisions = decisionOrders ?? [];
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
          {dateFormatter.format(new Date(event.starts_at))}
          {event.venue ? ` · ${event.venue}` : ""}
        </p>
        {state === "held" ? (
          <p className="mt-1 text-sm font-medium text-byla-warning">
            Lugares restantes reservados por compras em andamento.
          </p>
        ) : null}

        <div className="mt-5 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
          <ButtonLink className="col-span-2" href={`/equipe/eventos/${event.id}/check-in`}>
            <ScanLine aria-hidden className="h-5 w-5" />
            Abrir check-in
          </ButtonLink>
          <ButtonLink href={`/eventos/${event.slug}`} target="_blank" variant="secondary">
            Ver página
            <ExternalLink aria-hidden className="h-4 w-4" />
            <span className="sr-only">(abre em nova aba)</span>
          </ButtonLink>
          <SalesToggle eventId={event.id} salesOpen={event.sales_open} />
        </div>
      </header>

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
              Vendas
            </h2>
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
          </section>

          <DecisionQueue
            capacity={event.capacity}
            className={sectionClass}
            id="decisao"
            occupied={availability ? availability.sold + availability.held : null}
            orders={pendingDecisions.map((order) => ({
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
            }))}
          />

          <TicketList className={sectionClass} eventId={event.id} id="participantes" tickets={listItems} />
        </div>

        <div className="grid min-w-0 gap-10">
          <CourtesyForm
            className={sectionClass}
            eventId={event.id}
            id="cortesia"
            remaining={remaining}
          />

          <RefundHistory
            refunds={(refunds ?? []).map((refund) => {
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
                  startsAt: event.starts_at,
                  venue: event.venue,
                  description: event.description,
                  capacity: event.capacity,
                  inteiraQuota: event.inteira_quota,
                  meiaQuota: event.meia_quota,
                  ticketTypes: editorTypes,
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
