import { CalendarCheck, Inbox, Trash2 } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ApprovalCard, type ApprovalEvent } from "@/components/equipe/ApprovalCard";
import { OpsRequestCard, type OpsRequestView } from "@/components/equipe/OpsRequestCard";
import { cx } from "@/components/ui/cx";
import { EmptyState } from "@/components/ui/EmptyState";
import { Notice } from "@/components/ui/Notice";
import { getActor } from "@/lib/auth/actor";
import { eventDateFormatter, formatSessionLabel } from "@/lib/datetime";
import { createAdminClient } from "@/lib/supabase/admin";

const PAGE_PATH = "/equipe/aprovacoes";

const TABS = [
  { id: "eventos", label: "Eventos" },
  { id: "mudancas", label: "Mudanças" },
  { id: "exclusoes", label: "Exclusões" },
] as const;
type TabId = (typeof TABS)[number]["id"];

const tabClass =
  "inline-flex min-h-11 items-center whitespace-nowrap rounded-lg border px-4 text-base font-medium no-underline transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-byla-blue";

const shortDate = eventDateFormatter({ dateStyle: "short", timeStyle: "short" });

type AdminClient = ReturnType<typeof createAdminClient>;
type Counts = Record<TabId, number>;

function formatDate(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : shortDate.format(date);
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

async function loadCounts(admin: AdminClient, adminId: string): Promise<Counts | null> {
  const { data, error } = await admin.rpc("team_pending_counts", { p_staff: adminId });
  if (error) {
    console.error("[aprovacoes] Falha ao contar pendências.", error.code);
    return null;
  }
  const counts = data?.[0];
  return counts ? { eventos: counts.approvals, mudancas: counts.changes, exclusoes: counts.deletions } : null;
}

async function loadProducerNames(admin: AdminClient, eventIds: string[]): Promise<Map<string, string>> {
  if (!eventIds.length) return new Map();
  const { data, error } = await admin.rpc("event_producer_names", { p_event_ids: eventIds.slice(0, 200) });
  if (error) console.error("[aprovacoes] Falha ao carregar os nomes dos organizadores.", error.code);
  return new Map((data ?? []).map((row) => [row.event_id, row.public_name]));
}

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function AprovacoesPage({ searchParams }: Props) {
  const actor = await getActor();
  if (actor?.kind !== "equipe" || !actor.isAdmin) notFound();

  const query = await searchParams;
  const tabParam = first(query.aba);
  const tab: TabId = TABS.some((item) => item.id === tabParam) ? (tabParam as TabId) : "eventos";

  const admin = createAdminClient();
  const [counts, section] = await Promise.all([
    loadCounts(admin, actor.userId),
    tab === "eventos"
      ? eventsSection(admin, actor.userId)
      : requestsSection(admin, actor.userId, tab === "mudancas" ? "mudanca" : "exclusao"),
  ]);

  return (
    <main className="mx-auto w-full max-w-6xl px-4 pb-16 pt-4 sm:px-6">
      <h1 className="font-display text-4xl tracking-wide text-foreground">Aprovações</h1>
      <p className="mt-1 text-base text-byla-muted">
        Eventos de organizadores para aprovar e pedidos de mudança e de exclusão.
      </p>

      <nav aria-label="Seções de aprovações" className="mt-6 flex flex-wrap gap-2">
        {TABS.map((item) => {
          const count = counts?.[item.id] ?? 0;
          const active = item.id === tab;
          return (
            <Link
              aria-current={active ? "page" : undefined}
              className={cx(
                tabClass,
                active
                  ? "border-byla-action bg-byla-action text-white"
                  : "border-byla-border text-foreground hover:bg-byla-overlay",
              )}
              href={`${PAGE_PATH}?aba=${item.id}`}
              key={item.id}
            >
              {count > 0 ? `${item.label} (${count})` : item.label}
            </Link>
          );
        })}
      </nav>

      <div className="mt-6">{section}</div>
    </main>
  );
}

async function eventsSection(admin: AdminClient, adminId: string) {
  const { data, error } = await admin
    .from("events")
    .select(
      "id, name, slug, venue, description, cover_image_url, submitted_at, organizer_id, event_sessions(id, name, starts_at, ends_at, capacity, inteira_quota, meia_quota, status, archived_at, session_ticket_types(ticket_type_id, price_cents, max_units, on_sale)), ticket_types(id, name, kind, preset, archived_at, sort_order)",
    )
    .not("organizer_id", "is", null)
    .eq("approval_status", "em_analise")
    .is("deleted_at", null)
    .order("submitted_at", { ascending: true });
  if (error) console.error("[aprovacoes] Falha ao listar eventos em análise.", error.code);
  const rows = data ?? [];

  const [names, organizers] = await Promise.all([
    loadProducerNames(
      admin,
      rows.map((row) => row.id),
    ),
    rows.length
      ? admin.rpc("list_organizers", { p_admin: adminId })
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (organizers.error) console.error("[aprovacoes] Falha ao conferir as contas dos organizadores.", organizers.error.code);
  const organizerStatus = new Map((organizers.data ?? []).map((row) => [row.user_id, row.status]));

  const events: ApprovalEvent[] = rows.map((row) => {
    const types = new Map(
      (row.ticket_types ?? [])
        .filter((type) => type.kind !== "cortesia" && type.archived_at === null)
        .map((type) => [type.id, type]),
    );
    const sessions = (row.event_sessions ?? [])
      .filter((session) => session.status === "ativa" && session.archived_at === null)
      .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at))
      .map((session) => ({
        id: session.id,
        label: formatSessionLabel(session.name, session.starts_at, session.ends_at),
        capacity: session.capacity,
        inteiraQuota: session.inteira_quota,
        meiaQuota: session.meia_quota,
        prices: (session.session_ticket_types ?? [])
          .filter((price) => price.on_sale && types.has(price.ticket_type_id))
          .map((price) => ({ price, type: types.get(price.ticket_type_id)! }))
          .sort((a, b) => a.type.sort_order - b.type.sort_order)
          .map(({ price, type }) => ({
            name: type.name,
            preset: type.preset,
            priceCents: price.price_cents,
            maxUnits: price.max_units,
          })),
      }));
    const status = row.organizer_id ? organizerStatus.get(row.organizer_id) : undefined;
    return {
      id: row.id,
      name: row.name,
      venue: row.venue,
      description: row.description,
      coverImageUrl: row.cover_image_url,
      producerName: names.get(row.id) ?? null,
      organizerActive: status === undefined ? null : status === "ativo",
      submittedAt: formatDate(row.submitted_at) || null,
      sessions,
    };
  });

  return (
    <section aria-labelledby="eventos-titulo">
      <h2 className="sr-only" id="eventos-titulo">
        Eventos para aprovar
      </h2>
      {error ? (
        <Notice tone="danger">Não foi possível carregar os eventos. Atualize a página.</Notice>
      ) : events.length === 0 ? (
        <EmptyState icon={CalendarCheck} title="Nenhum evento esperando aprovação." />
      ) : (
        <div className="grid gap-4">
          {events.map((event) => (
            <ApprovalCard event={event} key={event.id} />
          ))}
        </div>
      )}
    </section>
  );
}

function changeDescription(details: unknown): string | null {
  if (typeof details !== "object" || details === null || Array.isArray(details)) return null;
  const what = (details as Record<string, unknown>).o_que;
  return typeof what === "string" && what.trim() ? what : null;
}

type DeletionStats = {
  paid: Map<string, number>;
  active: Map<string, number>;
  /** Primeira sessão ativa (pelo horário) de cada evento. */
  firstActive: Map<string, string>;
};

/** Pedidos pagos e sessões ativas de cada evento (para aceitar uma exclusão). */
async function loadDeletionStats(admin: AdminClient, eventIds: string[]): Promise<DeletionStats | null> {
  if (!eventIds.length) return { paid: new Map(), active: new Map(), firstActive: new Map() };
  const [orders, sessions] = await Promise.all([
    admin.from("orders").select("event_id").in("event_id", eventIds).eq("status", "pago"),
    admin.from("event_sessions").select("id, event_id, status, archived_at, starts_at").in("event_id", eventIds),
  ]);
  if (orders.error || sessions.error) {
    console.error("[aprovacoes] Falha ao conferir vendas e sessões.", orders.error?.code ?? sessions.error?.code);
    return null;
  }
  const paid = new Map<string, number>();
  for (const order of orders.data ?? []) paid.set(order.event_id, (paid.get(order.event_id) ?? 0) + 1);
  const active = new Map<string, number>();
  const firstActive = new Map<string, { id: string; startsAt: number }>();
  for (const session of sessions.data ?? []) {
    if (session.status === "ativa" && session.archived_at === null) {
      active.set(session.event_id, (active.get(session.event_id) ?? 0) + 1);
      const startsAt = Date.parse(session.starts_at);
      const current = firstActive.get(session.event_id);
      if (!current || startsAt < current.startsAt) firstActive.set(session.event_id, { id: session.id, startsAt });
    }
  }
  return {
    paid,
    active,
    firstActive: new Map([...firstActive].map(([eventId, session]) => [eventId, session.id])),
  };
}

async function requestsSection(admin: AdminClient, adminId: string, kind: "mudanca" | "exclusao") {
  const { data, error } = await admin.rpc("list_ops_requests", { p_staff: adminId, p_status: "pendente" });
  if (error) console.error("[aprovacoes] Falha ao listar pedidos.", error.code);
  const rows = (data ?? []).filter((row) => row.kind === kind);
  const deletion = kind === "exclusao";
  const stats = deletion ? await loadDeletionStats(admin, [...new Set(rows.map((row) => row.event_id))]) : null;

  const requests: OpsRequestView[] = rows.map((row) => ({
    id: row.id,
    kind,
    eventId: row.event_id,
    eventName: row.event_name,
    producerName: row.organizer_public_name,
    what: deletion ? null : changeDescription(row.details),
    reason: row.reason,
    createdAt: formatDate(row.created_at),
    ...(deletion
      ? {
          paidOrders: stats?.paid.get(row.event_id) ?? 0,
          activeSessions: stats ? (stats.active.get(row.event_id) ?? 0) : null,
          firstActiveSessionId: stats?.firstActive.get(row.event_id) ?? null,
        }
      : {}),
  }));

  return (
    <section aria-labelledby="pedidos-titulo">
      <h2 className="sr-only" id="pedidos-titulo">
        {deletion ? "Pedidos de exclusão" : "Pedidos de mudança"}
      </h2>
      {deletion && rows.length && !stats ? (
        <Notice className="mb-4" tone="warning">
          Não foi possível conferir vendas e sessões agora. O sistema confere de novo ao concluir a exclusão.
        </Notice>
      ) : null}
      {error ? (
        <Notice tone="danger">Não foi possível carregar os pedidos. Atualize a página.</Notice>
      ) : requests.length === 0 ? (
        <EmptyState
          icon={deletion ? Trash2 : Inbox}
          title={deletion ? "Nenhum pedido de exclusão." : "Nenhum pedido de mudança."}
        />
      ) : (
        <div className="grid gap-4">
          {requests.map((request) => (
            <OpsRequestCard key={request.id} request={request} />
          ))}
        </div>
      )}
    </section>
  );
}
