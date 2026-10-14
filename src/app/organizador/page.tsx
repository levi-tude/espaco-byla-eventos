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
import { loadSessionAvailability } from "@/lib/domain/event-availability";
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

/**
 * Vendidos = soma das sessões ativas (`session_availability`, só service_role). Os IDs
 * vêm da lista já filtrada pela sessão do organizador; em falha, o card mostra só a lotação.
 */
async function soldCount(sessions: SessionRow[]): Promise<number | null> {
  if (!sessions.length) return 0;
  const admin = createAdminClient();
  const results = await Promise.all(sessions.map((session) => loadSessionAvailability(admin, session.id)));
  if (results.some((result) => result === null)) return null;
  return results.reduce((total, result) => total + (result?.sold ?? 0), 0);
}

export default async function OrganizerEventsPage() {
  const actor = await getActor();
  if (actor?.kind !== "organizador") {
    return <OrganizerNoAccess areaEnabled={await organizerAreaEnabled()} />;
  }

  const supabase = await createServerClient();
  // A RLS também mostra eventos públicos de outros: filtra pelo dono e tira os excluídos.
  const { data: rows, error } = await supabase
    .from("events")
    .select(
      "id, name, starts_at, cover_image_url, sales_open, approval_status, approval_note, organizer_id, event_sessions(id, starts_at, ends_at, status, archived_at, capacity)",
    )
    .eq("organizer_id", actor.userId)
    .is("deleted_at", null)
    .order("starts_at", { ascending: true });

  const own = (rows ?? []).filter((row) => row.organizer_id === actor.userId);
  const events: OrganizerEventCardData[] = await Promise.all(
    own.map(async ({ event_sessions: sessions, ...event }) => {
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
        sold: approved ? await soldCount(active) : null,
      };
    }),
  );

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
        Precisa de cortesias? Peça à equipe do Espaço Byla pelo WhatsApp.
      </Notice>

      {error ? (
        <Notice className="mt-6" tone="danger">
          Não foi possível carregar seus eventos.
        </Notice>
      ) : events.length === 0 ? (
        <EmptyState
          className="mt-6"
          description="Toque em “+ Criar evento” para começar. O Espaço Byla confere antes de abrir as vendas."
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
