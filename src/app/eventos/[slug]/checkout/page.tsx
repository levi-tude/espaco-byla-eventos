import Link from "next/link";
import { notFound } from "next/navigation";

import { SiteHeader } from "@/components/brand/SiteHeader";
import { CheckoutForm } from "./checkout-form";
import { createAdminClient } from "@/lib/supabase/admin";

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
    <main className="relative flex min-h-full flex-1 flex-col">
      <SiteHeader variant="equipe" />
      <div className="mx-auto w-full max-w-2xl flex-1 px-6 py-8">
        <Link
          className="text-sm font-medium text-byla-muted transition hover:text-foreground"
          href={`/eventos/${slug}`}
        >
          ← Voltar ao evento
        </Link>
        <section className="mt-6 rounded-2xl border border-byla-border bg-byla-surface p-6 md:p-10">
          <p className="text-sm font-medium text-byla-yellow">
            Finalizar compra
          </p>
          <h1 className="mt-1 font-display text-4xl tracking-wide text-foreground">
            {event.name}
          </h1>
          {event.sales_open && publicTicketTypes.length ? (
            <CheckoutForm slug={slug} ticketTypes={publicTicketTypes} />
          ) : (
            <p className="mt-6 rounded-lg border border-byla-border bg-byla-bg p-4 text-byla-muted">
              As vendas deste evento estão fechadas.
            </p>
          )}
        </section>
      </div>
    </main>
  );
}
