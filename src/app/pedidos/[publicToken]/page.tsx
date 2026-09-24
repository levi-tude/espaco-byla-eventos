import { notFound, redirect } from "next/navigation";

import { SiteHeader } from "@/components/brand/SiteHeader";
import { TicketPageNav } from "@/components/public/TicketPageNav";
import { TicketQr } from "@/components/public/TicketQr";
import {
  cancelOrderIfPending,
  markOrderPaidIfPending,
} from "@/lib/domain/orders";
import { getPaymentProvider } from "@/lib/payments/provider";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerClient } from "@/lib/supabase/server";

const dateFormatter = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "long",
  timeStyle: "short",
});

async function resolveStaffBackNav(eventId: string, eventSlug: string) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      backHref: `/eventos/${eventSlug}`,
      backLabel: "← Voltar",
    };
  }

  const { data: profile } = await supabase
    .from("staff_profiles")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (profile) {
    return {
      backHref: `/equipe/eventos/${eventId}`,
      backLabel: "← Voltar ao gerenciamento",
    };
  }

  return {
    backHref: `/eventos/${eventSlug}`,
    backLabel: "← Voltar",
  };
}

async function reconcileReturnPayment(
  orderId: string,
  publicToken: string,
  searchParams: Record<string, string | string[] | undefined>,
) {
  const provider = getPaymentProvider();
  if (!provider.confirmPayment) return;

  const rawPaymentId = searchParams.payment_id ?? searchParams.collection_id;
  const paymentId = Array.isArray(rawPaymentId)
    ? rawPaymentId[0]
    : rawPaymentId;
  if (!paymentId) return;

  const result = await provider.confirmPayment(paymentId);
  if (!result.externalId || result.externalId !== orderId) return;

  const admin = createAdminClient();
  if (result.kind === "paid") {
    await markOrderPaidIfPending(admin, result.externalId, provider.name);
    redirect(`/pedidos/${publicToken}`);
  }

  if (result.kind === "cancelled") {
    await cancelOrderIfPending(admin, result.externalId, provider.name);
    redirect(`/pedidos/${publicToken}`);
  }
}

export default async function PedidoPage({
  params,
  searchParams,
}: PageProps<"/pedidos/[publicToken]">) {
  const { publicToken } = await params;
  const query = await searchParams;
  const admin = createAdminClient();
  const { data: order, error: orderError } = await admin
    .from("orders")
    .select("id, event_id, status, buyer_name")
    .eq("public_token", publicToken)
    .maybeSingle();

  if (orderError) throw new Error("Não foi possível carregar o pedido.");
  if (!order) notFound();

  if (order.status === "pendente") {
    await reconcileReturnPayment(order.id, publicToken, query);
    // Releitura após possível confirmação via redirect do Mercado Pago
    const { data: refreshed } = await admin
      .from("orders")
      .select("id, event_id, status, buyer_name")
      .eq("id", order.id)
      .single();
    if (refreshed) Object.assign(order, refreshed);
  }

  const { data: event, error: eventError } = await admin
    .from("events")
    .select("name, starts_at, venue, slug")
    .eq("id", order.event_id)
    .single();

  if (eventError) throw new Error("Não foi possível carregar o evento.");

  const backNav = await resolveStaffBackNav(order.event_id, event.slug);

  if (order.status === "pendente") {
    return (
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-6 py-10">
        <SiteHeader variant="equipe" />
        <div className="pt-4">
          <TicketPageNav
            backHref={backNav.backHref}
            backLabel={backNav.backLabel}
            eventSlug={event.slug}
          />
          <section className="w-full rounded-2xl border border-amber-500/40 bg-amber-950/30 p-8 text-center">
            <p className="text-sm font-medium text-amber-300">Não pago</p>
            <h1 className="mt-2 font-display text-4xl tracking-wide text-foreground">
              Aguardando pagamento
            </h1>
            <p className="mt-4 leading-7 text-byla-muted">
              Assim que o pagamento for confirmado, seus ingressos aparecerão
              nesta página.
            </p>
          </section>
        </div>
      </main>
    );
  }

  if (order.status !== "pago") {
    return (
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-6 py-10">
        <SiteHeader variant="equipe" />
        <div className="pt-4">
          <TicketPageNav
            backHref={backNav.backHref}
            backLabel={backNav.backLabel}
            eventSlug={event.slug}
          />
          <section className="w-full rounded-2xl border border-byla-border bg-byla-surface p-8 text-center">
            <h1 className="font-display text-4xl tracking-wide text-foreground">
              Ingressos indisponíveis
            </h1>
            <p className="mt-4 text-byla-muted">
              Este pedido foi cancelado ou expirou.
            </p>
          </section>
        </div>
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
    <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-10">
      <SiteHeader variant="equipe" />
      <div className="pt-4">
        <TicketPageNav
          backHref={backNav.backHref}
          backLabel={backNav.backLabel}
          eventSlug={event.slug}
        />

        <header className="text-center">
          <p className="text-sm font-medium text-emerald-400">
            Pagamento confirmado
          </p>
          <h1 className="mt-2 font-display text-5xl tracking-wide text-foreground">
            Seus ingressos
          </h1>
          <p className="mt-4 text-byla-muted">
            {event.name} · {dateFormatter.format(new Date(event.starts_at))}
          </p>
          <p className="mt-1 text-byla-muted">{event.venue}</p>
          <p className="mt-4 text-sm text-zinc-500">
            Apresente o QR Code na entrada. Cada ingresso deve ser usado uma
            única vez. Use “Baixar ingresso (PDF)” para guardar no celular.
          </p>
        </header>

        {tickets?.length ? (
          <section className="mt-10 grid gap-6 sm:grid-cols-2">
            {tickets.map((ticket) => (
              <TicketQr
                code={ticket.code}
                eventName={event.name}
                eventWhen={dateFormatter.format(new Date(event.starts_at))}
                holderName={ticket.buyer_name}
                key={ticket.code}
                kind={ticket.kind}
                status={ticket.status as "pago" | "check_in"}
                venue={event.venue}
              />
            ))}
          </section>
        ) : (
          <p className="mt-10 rounded-xl border border-byla-border bg-byla-surface p-6 text-center text-byla-muted">
            Nenhum ingresso disponível para este pedido.
          </p>
        )}
      </div>
    </main>
  );
}
