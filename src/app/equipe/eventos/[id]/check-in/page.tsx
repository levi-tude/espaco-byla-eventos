import Link from "next/link";
import { notFound } from "next/navigation";

import { CheckInScanner } from "@/components/equipe/CheckInScanner";
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
    <main className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 sm:py-10">
      <Link
        className="inline-flex min-h-11 items-center text-base font-medium text-zinc-700"
        href={`/equipe/eventos/${event.id}`}
      >
        ← Voltar ao evento
      </Link>
      <h1 className="mt-3 text-3xl font-bold tracking-tight">Check-in</h1>
      <p className="mb-6 mt-1 text-lg text-zinc-600">{event.name}</p>

      <CheckInScanner eventId={event.id} />
    </main>
  );
}
