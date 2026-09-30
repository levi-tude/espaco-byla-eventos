import { notFound } from "next/navigation";

import { SiteHeader } from "@/components/brand/SiteHeader";
import { OrderPayment } from "@/components/public/OrderPayment";
import { TicketPageNav } from "@/components/public/TicketPageNav";
import { TicketQr } from "@/components/public/TicketQr";
import { eventDateFormatter } from "@/lib/datetime";
import { confirmOrderPaid } from "@/lib/payments/confirm-order";
import { getPaymentProvider } from "@/lib/payments/provider";
import type { OrderReference, PixData } from "@/lib/payments/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerClient } from "@/lib/supabase/server";

const dateFormatter = eventDateFormatter({
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

const moneyFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

function isReservationExpired(expiresAt: string | null) {
  return expiresAt !== null && Date.parse(expiresAt) <= Date.now();
}

async function lookupPendingPayment(
  admin: ReturnType<typeof createAdminClient>,
  order: OrderReference,
): Promise<{ paid: boolean; pix: PixData | null }> {
  const provider = getPaymentProvider();
  try {
    const existing = await provider.findOrderPayment(order);
    if (existing.kind === "paid") {
      await confirmOrderPaid(admin, order.id, provider.name, existing.amountCents);
      return { paid: true, pix: null };
    }
    return {
      paid: false,
      pix: existing.kind === "pending_pix" ? existing.pix : null,
    };
  } catch (error) {
    console.error("[pagamento] Falha ao consultar pagamento do pedido.", error);
    return { paid: false, pix: null };
  }
}

export default async function PedidoPage({
  params,
}: PageProps<"/pedidos/[publicToken]">) {
  const { publicToken } = await params;
  const admin = createAdminClient();
  const { data: order, error: orderError } = await admin
    .from("orders")
    .select(
      "id, event_id, status, buyer_name, buyer_email, total_cents, expires_at, created_at",
    )
    .eq("public_token", publicToken)
    .maybeSingle();

  if (orderError) throw new Error("Não foi possível carregar o pedido.");
  if (!order) notFound();

  let initialPix: PixData | null = null;
  if (order.status === "pendente") {
    const pending = await lookupPendingPayment(admin, {
      id: order.id,
      createdAt: order.created_at,
    });
    if (pending.paid) order.status = "pago";
    initialPix = pending.pix;
  }

  const { data: event, error: eventError } = await admin
    .from("events")
    .select("name, starts_at, venue, slug")
    .eq("id", order.event_id)
    .single();

  if (eventError) throw new Error("Não foi possível carregar o evento.");

  const backNav = await resolveStaffBackNav(order.event_id, event.slug);

  if (order.status === "pendente") {
    const publicKey = process.env.MERCADOPAGO_PUBLIC_KEY;
    const expired = !initialPix && isReservationExpired(order.expires_at);

    return (
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-6 py-10">
        <SiteHeader variant="equipe" />
        <div className="grid gap-6 pt-4">
          <TicketPageNav
            backHref={backNav.backHref}
            backLabel={backNav.backLabel}
            eventSlug={event.slug}
          />
          <header>
            <p className="text-sm font-medium text-byla-yellow">Pagamento</p>
            <h1 className="mt-1 font-display text-4xl tracking-wide text-foreground">
              {event.name}
            </h1>
            <p className="mt-2 text-byla-muted">
              {dateFormatter.format(new Date(event.starts_at))} · Total{" "}
              <strong className="text-foreground">
                {moneyFormatter.format(order.total_cents / 100)}
              </strong>
            </p>
          </header>
          {expired ? (
            <section className="rounded-2xl border border-byla-border bg-byla-surface p-8 text-center">
              <h2 className="font-display text-3xl tracking-wide text-foreground">
                Tempo esgotado
              </h2>
              <p className="mt-3 text-byla-muted">
                A reserva deste pedido expirou. Volte ao evento e faça uma nova
                compra.
              </p>
            </section>
          ) : publicKey ? (
            <OrderPayment
              amountCents={order.total_cents}
              buyerEmail={order.buyer_email}
              initialPix={initialPix}
              publicKey={publicKey}
              publicToken={publicToken}
            />
          ) : (
            <p className="rounded-lg border border-amber-500/40 bg-amber-950/40 p-4 text-amber-100">
              Pagamento em configuração. Falta a chave pública do Mercado Pago
              no ambiente.
            </p>
          )}
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
