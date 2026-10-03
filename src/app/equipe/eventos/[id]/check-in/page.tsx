import { notFound } from "next/navigation";

import { CheckInScanner } from "@/components/equipe/CheckInScanner";
import { BackLink } from "@/components/ui/BackLink";
import { createServerClient } from "@/lib/supabase/server";

export default async function CheckInPage({
  params,
}: PageProps<"/equipe/eventos/[id]/check-in">) {
  const { id } = await params;
  const supabase = await createServerClient();
  const { data: event } = await supabase
    .from("events")
    .select("id, name")
    .eq("id", id)
    .maybeSingle();

  if (!event) notFound();

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-3 sm:px-6 sm:py-8">
      <BackLink href={`/equipe/eventos/${event.id}`}>Voltar ao evento</BackLink>
      <div className="mb-4 mt-2 flex flex-wrap items-baseline gap-x-3">
        <h1 className="font-display text-4xl tracking-wide text-foreground">Check-in</h1>
        <p className="min-w-0 truncate text-lg text-byla-muted">{event.name}</p>
      </div>

      <CheckInScanner eventId={event.id} />
    </main>
  );
}
