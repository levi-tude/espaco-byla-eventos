import { notFound } from "next/navigation";

import { TicketQr } from "@/components/public/TicketQr";
import { createAdminClient } from "@/lib/supabase/admin";

const dateFormatter = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "long",
  timeStyle: "short",
});

export default async function PedidoPage({
  params,
}: PageProps<"/pedidos/[publicToken]">) {
  const { publicToken } = await params;
  const admin = createAdminClient();
  const { data: order, error: orderError } = await admin
    .from("orders")
    .select("id, event_id, status, buyer_name")
    .eq("public_token", publicToken)
    .maybeSingle();

  if (orderError) throw new Error("Não foi possível carregar o pedido.");
  if (!order) notFound();

  const { data: event, error: eventError } = await admin
    .from("events")
    .select("name, starts_at, venue")
    .eq("id", order.event_id)
    .single();

  if (eventError) throw new Error("Não foi possível carregar o evento.");

  if (order.status === "pendente") {
    return (
      <main className="mx-auto flex w-full max-w-2xl flex-1 items-center px-6 py-16">
        <section className="w-full rounded-2xl border border-amber-200 bg-amber-50 p-8 text-center">
          <p className="text-sm font-medium text-amber-800">Pedido recebido</p>
          <h1 className="mt-2 text-3xl font-semibold">Aguardando pagamento</h1>
          <p className="mt-4 leading-7 text-zinc-700">
            Assim que o pagamento for confirmado, seus ingressos aparecerão
            nesta página.
          </p>
        </section>
      </main>
    );
  }

  if (order.status !== "pago") {
    return (
      <main className="mx-auto flex w-full max-w-2xl flex-1 items-center px-6 py-16">
        <section className="w-full rounded-2xl border border-zinc-200 bg-white p-8 text-center">
          <h1 className="text-3xl font-semibold">Ingressos indisponíveis</h1>
          <p className="mt-4 text-zinc-600">
            Este pedido foi cancelado ou expirou.
          </p>
        </section>
      </main>
    );
  }

  const { data: tickets, error: ticketsError } = await admin
    .from("tickets")
    .select("code, buyer_name, kind, status")
    .eq("order_id", order.id)
    .in("status", ["pago", "check_in"])
    .order("created_at");

  if (ticketsError) throw new Error("Não foi possível carregar os ingressos.");

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-12">
      <header className="text-center">
        <p className="text-sm font-medium text-emerald-700">
          Pagamento confirmado
        </p>
        <h1 className="mt-2 text-4xl font-semibold tracking-tight">
          Seus ingressos
        </h1>
        <p className="mt-4 text-zinc-600">
          {event.name} · {dateFormatter.format(new Date(event.starts_at))}
        </p>
        <p className="mt-1 text-zinc-600">{event.venue}</p>
        <p className="mt-4 text-sm text-zinc-500">
          Apresente o QR Code na entrada. Cada ingresso deve ser usado uma única
          vez.
        </p>
      </header>

      {tickets?.length ? (
        <section className="mt-10 grid gap-6 sm:grid-cols-2">
          {tickets.map((ticket) => (
            <TicketQr
              code={ticket.code}
              eventName={event.name}
              holderName={ticket.buyer_name}
              key={ticket.code}
              kind={ticket.kind}
              status={ticket.status as "pago" | "check_in"}
            />
          ))}
        </section>
      ) : (
        <p className="mt-10 rounded-xl bg-zinc-100 p-6 text-center">
          Nenhum ingresso disponível para este pedido.
        </p>
      )}
    </main>
  );
}
