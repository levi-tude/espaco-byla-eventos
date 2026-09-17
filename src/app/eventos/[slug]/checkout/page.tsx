import Link from "next/link";
import { notFound } from "next/navigation";

import { createAdminClient } from "@/lib/supabase/admin";

import { CheckoutForm } from "./checkout-form";

export default async function CheckoutPage({
  params,
}: PageProps<"/eventos/[slug]/checkout">) {
  const { slug } = await params;
  const admin = createAdminClient();
  const { data: event } = await admin
    .from("events")
    .select("id, name, sales_open")
    .eq("slug", slug)
    .maybeSingle();

  if (!event) notFound();

  const { data: ticketTypes } = await admin
    .from("ticket_types")
    .select("kind, price_cents")
    .eq("event_id", event.id)
    .in("kind", ["inteira", "meia"])
    .eq("active", true)
    .order("price_cents", { ascending: false });
  const publicTicketTypes = (ticketTypes ?? []).flatMap((ticketType) =>
    ticketType.kind === "inteira" || ticketType.kind === "meia"
      ? [{ kind: ticketType.kind, priceCents: ticketType.price_cents }]
      : [],
  );

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-12">
      <Link
        className="text-sm text-zinc-600 hover:text-zinc-950"
        href={`/eventos/${slug}`}
      >
        ← Voltar ao evento
      </Link>
      <section className="mt-6 rounded-2xl border border-zinc-200 bg-white p-6 md:p-10">
        <p className="text-sm font-medium text-zinc-600">Finalizar compra</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">
          {event.name}
        </h1>
        {event.sales_open && publicTicketTypes.length ? (
          <CheckoutForm slug={slug} ticketTypes={publicTicketTypes} />
        ) : (
          <p className="mt-6 rounded-lg bg-zinc-100 p-4">
            As vendas deste evento estão fechadas.
          </p>
        )}
      </section>
    </main>
  );
}
