import { notFound } from "next/navigation";

import { AutoRefresh } from "@/components/equipe/AutoRefresh";
import { CheckInCounter } from "@/components/equipe/CheckInCounter";
import { CheckInScanner } from "@/components/equipe/CheckInScanner";
import { BackLink } from "@/components/ui/BackLink";
import { ButtonLink } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Notice";
import { formatSessionShort } from "@/lib/datetime";
import { loadMeiaSummary } from "@/lib/check-in/meia";
import { checkInCounts } from "@/lib/domain/check-in";
import { sessionName, suggestCheckInSession, type SessionSummary } from "@/lib/domain/sessions";
import { createServerClient } from "@/lib/supabase/server";

function sessionLabel(session: SessionSummary) {
  return [sessionName(session.name), formatSessionShort(session.startsAt)]
    .filter(Boolean)
    .join(" · ");
}

export default async function CheckInPage({
  params,
  searchParams,
}: PageProps<"/equipe/eventos/[id]/check-in">) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const supabase = await createServerClient();
  const { data: event } = await supabase
    .from("events")
    .select("id, name")
    .eq("id", id)
    .maybeSingle();

  if (!event) notFound();

  const { data: rows } = await supabase
    .from("event_sessions")
    .select("id, name, starts_at, ends_at, status, capacity")
    .eq("event_id", event.id)
    .eq("status", "ativa")
    .is("archived_at", null)
    .order("starts_at");

  const sessions: SessionSummary[] = (rows ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    status: row.status === "ativa" ? "ativa" : "cancelada",
  }));
  const requested = typeof query.sessao === "string" ? query.sessao : null;
  const current =
    sessions.find((session) => session.id === requested) ?? suggestCheckInSession(sessions);

  const { data: validTickets } = current
    ? await supabase
        .from("tickets")
        .select("kind, status")
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
      <BackLink href={`/equipe/eventos/${event.id}`}>Voltar ao evento</BackLink>
      <div className="mb-4 mt-2 flex flex-wrap items-baseline gap-x-3">
        <h1 className="font-display text-4xl tracking-wide text-foreground">Check-in</h1>
        <p className="min-w-0 truncate text-lg text-byla-muted">{event.name}</p>
      </div>

      {current ? (
        <>
          {sessions.length > 1 ? (
            <nav aria-label="Sessão do check-in" className="mb-4 flex flex-wrap gap-2">
              {sessions.map((session) => (
                <ButtonLink
                  aria-current={session.id === current.id ? "true" : undefined}
                  href={`/equipe/eventos/${event.id}/check-in?sessao=${session.id}`}
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
        <Notice tone="warning">Este evento não tem sessão ativa para check-in.</Notice>
      )}
    </main>
  );
}
