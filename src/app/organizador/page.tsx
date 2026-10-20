import type { Metadata } from "next";

import {
  OrganizerEventCard,
  type OrganizerEventCardData,
  organizerEventStatus,
} from "@/components/organizer/OrganizerEventCard";
import { OrganizerNoAccess } from "@/components/organizer/OrganizerNoAccess";
import { ButtonLink } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Notice } from "@/components/ui/Notice";
import { getActor } from "@/lib/auth/actor";
import { organizerAreaEnabled } from "@/lib/organizer/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Meus eventos",
  robots: { index: false, follow: false },
};

type SessionRow = {
  id: string;
  starts_at: string;
  ends_at: string | null;
  status: string;
  archived_at: string | null;
  capacity: number;
};

const byStart = (a: { starts_at: string }, b: { starts_at: string }) =>
  Date.parse(a.starts_at) - Date.parse(b.starts_at);

/** Ingressos pagos ou já usados na portaria, por evento (uma consulta para todos os cards). */
async function soldByEvent(eventIds: string[]): Promise<Map<string, number> | null> {
  if (!eventIds.length) return new Map();
  const { data, error } = await createAdminClient()
    .from("tickets")
    .select("event_id")
    .in("event_id", eventIds)
    .in("status", ["pago", "check_in"]);
  if (error) {
    console.error("[organizador] Falha ao contar ingressos vendidos.", error.code);
    return null;
  }
  const counts = new Map<string, number>();
  for (const row of data ?? []) {
    counts.set(row.event_id, (counts.get(row.event_id) ?? 0) + 1);
  }
  return counts;
}

export default async function OrganizerEventsPage() {
  const actor = await getActor();
  if (actor?.kind !== "organizador") {
    return <OrganizerNoAccess areaEnabled={await organizerAreaEnabled()} />;
  }

  const supabase = await createServerClient();
  const { data: rows, error } = await supabase
    .from("events")
    .select(
      "id, name, starts_at, cover_image_url, sales_open, approval_status, approval_note, organizer_id, event_sessions(id, starts_at, ends_at, status, archived_at, capacity)",
    )
    .eq("organizer_id", actor.userId)
    .is("deleted_at", null)
    .order("starts_at", { ascending: true });

  const own = (rows ?? []).filter((row) => row.organizer_id === actor.userId);
  const approvedIds = own.filter((row) => row.approval_status === "aprovado").map((row) => row.id);
  const soldCounts = approvedIds.length ? await soldByEvent(approvedIds) : new Map<string, number>();

  const events: OrganizerEventCardData[] = own.map(({ event_sessions: sessions, ...event }) => {
    const active = ((sessions ?? []) as SessionRow[])
      .filter((session) => session.status === "ativa" && session.archived_at === null)
      .sort(byStart);
    const lastSession = active.at(-1);
    const approved = event.approval_status === "aprovado";
    return {
      id: event.id,
      name: event.name,
      coverImageUrl: event.cover_image_url,
      sessionStarts: active.length ? active.map((session) => session.starts_at) : [event.starts_at],
      status: organizerEventStatus({
        approvalStatus: event.approval_status,
        salesOpen: event.sales_open,
        lastSessionAt: lastSession ? (lastSession.ends_at ?? lastSession.starts_at) : event.starts_at,
      }),
      refusalNote: event.approval_status === "recusado" ? event.approval_note : null,
      capacity: active.reduce((total, session) => total + session.capacity, 0),
      sold: approved ? (soldCounts === null ? null : (soldCounts.get(event.id) ?? 0)) : null,
    };
  });

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-4xl tracking-wide text-foreground">Meus eventos</h1>
          <p className="mt-1 text-base text-byla-muted">
            Crie seus eventos e acompanhe as vendas.
          </p>
        </div>
        <ButtonLink className="w-full sm:w-auto" href="/organizador/eventos/novo">
          + Criar evento
        </ButtonLink>
      </div>

      <Notice className="mt-6" live={false} tone="info">
        Precisa de cortesias? Peça à equipe da ACDH Eventos pelo WhatsApp.
      </Notice>

      {error ? (
        <Notice className="mt-6" tone="danger">
          Não foi possível carregar seus eventos.
        </Notice>
      ) : events.length === 0 ? (
        <EmptyState
          className="mt-6"
          description="Toque em “+ Criar evento” para começar. A ACDH Eventos confere antes de abrir as vendas."
          title="Você ainda não tem eventos."
        />
      ) : (
        <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {events.map((event) => (
            <li key={event.id}>
              <OrganizerEventCard event={event} />
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
