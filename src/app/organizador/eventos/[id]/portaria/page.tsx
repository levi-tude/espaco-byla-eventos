import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AutoRefresh } from "@/components/equipe/AutoRefresh";
import { CheckInCounter } from "@/components/equipe/CheckInCounter";
import { CheckInScanner } from "@/components/equipe/CheckInScanner";
import { OrganizerNoAccess } from "@/components/organizer/OrganizerNoAccess";
import { BackLink } from "@/components/ui/BackLink";
import { ButtonLink } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Notice";
import { getActor, requireEventAccess } from "@/lib/auth/actor";
import { formatSessionShort } from "@/lib/datetime";
import { loadMeiaSummary } from "@/lib/check-in/meia";
import { checkInCounts } from "@/lib/domain/check-in";
import { sessionName, suggestCheckInSession, type SessionSummary } from "@/lib/domain/sessions";
import { UUID_PATTERN } from "@/lib/events/event-input";
import { organizerAreaEnabled } from "@/lib/organizer/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Portaria",
  robots: { index: false, follow: false },
};

function sessionLabel(session: SessionSummary) {
  return [sessionName(session.name), formatSessionShort(session.startsAt)].filter(Boolean).join(" · ");
}

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** Leitor de QR Code da equipe, só para os eventos do próprio organizador. */
export default async function PortariaOrganizadorPage({ params, searchParams }: Props) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const actor = await getActor();
  if (actor?.kind !== "organizador") {
    return <OrganizerNoAccess areaEnabled={await organizerAreaEnabled()} />;
  }
  if (!UUID_PATTERN.test(id)) notFound();
  const access = await requireEventAccess(id).catch(() => null);
  if (access?.access !== "dono") notFound();

  const supabase = await createServerClient();
  const [{ data: event }, { data: rows }] = await Promise.all([
    supabase.from("events").select("id, name, organizer_id, deleted_at").eq("id", id).maybeSingle(),
    supabase
      .from("event_sessions")
      .select("id, name, starts_at, ends_at, status, capacity")
      .eq("event_id", id)
      .eq("status", "ativa")
      .is("archived_at", null)
      .order("starts_at"),
  ]);
  if (!event || event.organizer_id !== actor.userId || event.deleted_at) notFound();

  const sessions: SessionSummary[] = (rows ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    status: row.status === "ativa" ? "ativa" : "cancelada",
  }));
  const requested = typeof query.sessao === "string" ? query.sessao : null;
  const current = sessions.find((session) => session.id === requested) ?? suggestCheckInSession(sessions);

  // Contagem com service_role: o acesso de dono já foi conferido acima.
  const { data: validTickets } = current
    ? await createAdminClient()
        .from("tickets")
        .select("kind, status")
        .eq("event_id", event.id)
        .eq("session_id", current.id)
        .in("status", ["pago", "check_in"])
    : { data: [] };
  const capacity = (rows ?? []).find((row) => row.id === current?.id)?.capacity ?? null;
  const counts = checkInCounts(validTickets ?? [], capacity);
  // Conferência de meia com a sessão do próprio usuário; sem a migration, fica desligada.
  const meia = current
    ? await loadMeiaSummary(supabase, event.id, current.id)
    : { available: false, summary: null };

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-3 sm:px-6 sm:py-8">
      <AutoRefresh intervalMs={10_000} />
      <BackLink href={`/organizador/eventos/${event.id}?aba=portaria`}>Voltar ao evento</BackLink>
      <div className="mb-4 mt-2 flex flex-wrap items-baseline gap-x-3">
        <h1 className="font-display text-4xl tracking-wide text-foreground">Portaria</h1>
        <p className="min-w-0 truncate text-lg text-byla-muted">{event.name}</p>
      </div>

      {current ? (
        <>
          {sessions.length > 1 ? (
            <nav aria-label="Sessão da portaria" className="mb-4 flex flex-wrap gap-2">
              {sessions.map((session) => (
                <ButtonLink
                  aria-current={session.id === current.id ? "true" : undefined}
                  href={`/organizador/eventos/${event.id}/portaria?sessao=${session.id}`}
                  key={session.id}
                  replace
                  variant={session.id === current.id ? "primary" : "secondary"}
                >
                  {sessionLabel(session)}
                </ButtonLink>
              ))}
            </nav>
          ) : null}
          <p className="mb-3 text-2xl font-bold text-foreground">{sessionLabel(current)}</p>
          <CheckInCounter counts={counts} meia={meia.summary} />
          <CheckInScanner
            eventId={event.id}
            key={current.id}
            meiaChecks={meia.available}
            sessionId={current.id}
          />
        </>
      ) : (
        <Notice tone="warning">Este evento não tem sessão ativa para a portaria.</Notice>
      )}
    </main>
  );
}
