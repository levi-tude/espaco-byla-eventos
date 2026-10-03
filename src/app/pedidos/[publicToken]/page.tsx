import { Ban, Clock, Hourglass, type LucideIcon, Undo2 } from "lucide-react";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { SiteHeader } from "@/components/brand/SiteHeader";
import { OrderPayment } from "@/components/public/OrderPayment";
import { PaymentConfirmed } from "@/components/public/PaymentConfirmed";
import { TicketPageNav } from "@/components/public/TicketPageNav";
import { TicketQr } from "@/components/public/TicketQr";
import { ButtonLink } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Notice } from "@/components/ui/Notice";
import { eventDateFormatter } from "@/lib/datetime";
import { maskEmail } from "@/lib/domain/mask";
import { resumeCheckoutPath } from "@/lib/domain/public-token";
import { confirmOrderPaid } from "@/lib/payments/confirm-order";
import { extendHoldForPix } from "@/lib/payments/pix-hold";
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
      backLabel: "Voltar",
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
      backLabel: "Voltar ao gerenciamento",
    };
  }

  return {
    backHref: `/eventos/${eventSlug}`,
    backLabel: "Voltar",
  };
}

const COURTESY_PROVIDER = "cortesia_interna";

const moneyFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

function isReservationExpired(expiresAt: string | null) {
  return expiresAt !== null && Date.parse(expiresAt) <= Date.now();
}

function OrderShell({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  return (
    <main className="flex min-h-full flex-1 flex-col">
      <SiteHeader />
      <div
        className={`mx-auto w-full flex-1 px-4 pb-16 pt-2 sm:px-6 sm:pt-4 ${
          wide ? "max-w-5xl" : "max-w-2xl"
        }`}
      >
        {children}
      </div>
    </main>
  );
}

function StatusCard({
  icon: Icon,
  tone,
  title,
  children,
}: {
  icon: LucideIcon;
  tone: "warning" | "neutral";
  title: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      className="rounded-2xl border border-byla-border bg-byla-surface p-6 text-center sm:p-8"
      role="status"
    >
      <Icon
        aria-hidden
        className={`mx-auto h-12 w-12 ${tone === "warning" ? "text-byla-warning" : "text-byla-muted"}`}
      />
      <h1 className="mt-3 font-display text-4xl tracking-wide text-foreground">{title}</h1>
      <div className="mt-4 grid gap-3 text-base text-byla-muted">{children}</div>
    </section>
  );
}

async function lookupPendingPayment(
  admin: ReturnType<typeof createAdminClient>,
  order: OrderReference,
): Promise<{ paid: boolean; pix: PixData | null }> {
  const provider = getPaymentProvider();
  try {
    const existing = await provider.findOrderPayment(order);
    if (existing.kind === "paid") {
      await confirmOrderPaid(admin, order.id, provider.name, existing.amountCents, existing);
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
  searchParams,
}: PageProps<"/pedidos/[publicToken]">) {
  const [{ publicToken }, query] = await Promise.all([params, searchParams]);
  const justConfirmed = query.confirmado === "1";
  const admin = createAdminClient();
  const { data: order, error: orderError } = await admin
    .from("orders")
    .select(
      "id, event_id, status, buyer_name, buyer_email, total_cents, expires_at, created_at, payment_provider, cancel_reason",
    )
    .eq("public_token", publicToken)
    .maybeSingle();

  if (orderError) throw new Error("Não foi possível carregar o pedido.");
  if (!order) notFound();

  let initialPix: PixData | null = null;
  if (order.status === "pendente" || order.status === "expirado") {
    const pending = await lookupPendingPayment(admin, {
      id: order.id,
      createdAt: order.created_at,
    });
    if (pending.paid) {
      // Sem vaga, o pagamento deixa o pedido aguardando a equipe: o status vem do banco.
      const { data: updated } = await admin
        .from("orders")
        .select("status")
        .eq("id", order.id)
        .maybeSingle();
      order.status = updated?.status ?? order.status;
    } else if (order.status === "pendente" && pending.pix) {
      initialPix = pending.pix;
      order.expires_at =
        (await extendHoldForPix(admin, order.id, pending.pix)) ?? order.expires_at;
    }
  }

  const { data: event, error: eventError } = await admin
    .from("events")
    .select("name, starts_at, venue, slug")
    .eq("id", order.event_id)
    .single();

  if (eventError) throw new Error("Não foi possível carregar o evento.");

  const backNav = await resolveStaffBackNav(order.event_id, event.slug);

  if (order.status === "pendente" || order.status === "expirado") {
    const publicKey = process.env.MERCADOPAGO_PUBLIC_KEY;
    const expired =
      order.status === "expirado" ||
      (!initialPix && isReservationExpired(order.expires_at));

    return (
      <OrderShell>
        <div className="grid gap-5">
          <TicketPageNav
            backHref={backNav.backHref}
            backLabel={backNav.backLabel}
            eventSlug={event.slug}
          />
          <header>
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-byla-accent-text">
              Pagamento
            </p>
            <h1 className="mt-1 font-display text-4xl tracking-wide text-foreground">
              {event.name}
            </h1>
            <p className="mt-2 text-base text-byla-muted">
              {dateFormatter.format(new Date(event.starts_at))}
            </p>
            <p className="mt-3 flex items-baseline justify-between gap-3 rounded-xl border border-byla-border bg-byla-surface px-4 py-3 text-base text-foreground">
              Total
              <strong className="text-xl">
                {moneyFormatter.format(order.total_cents / 100)}
              </strong>
            </p>
          </header>
          {expired ? (
            <section className="rounded-2xl border border-byla-border bg-byla-surface p-6 text-center sm:p-8">
              <Clock aria-hidden className="mx-auto h-12 w-12 text-byla-warning" />
              <h2 className="mt-3 font-display text-3xl tracking-wide text-foreground">
                Tempo esgotado
              </h2>
              <p className="mt-3 text-base text-byla-muted">
                A reserva deste pedido expirou. Você pode escolher de novo; seus
                dados já vêm preenchidos.
              </p>
              <ButtonLink
                className="mt-6 w-full sm:w-auto"
                href={resumeCheckoutPath(event.slug, publicToken)}
                size="lg"
              >
                Escolher de novo com os mesmos dados
              </ButtonLink>
            </section>
          ) : publicKey ? (
            <OrderPayment
              amountCents={order.total_cents}
              buyerEmail={order.buyer_email}
              initialPix={initialPix}
              publicKey={publicKey}
              publicToken={publicToken}
              reservationExpiresAt={order.expires_at}
            />
          ) : (
            <Notice live={false} tone="warning">
              Pagamento em configuração. Falta a chave pública do Mercado Pago
              no ambiente.
            </Notice>
          )}
        </div>
      </OrderShell>
    );
  }

  if (order.status === "aguardando_decisao") {
    return (
      <OrderShell>
        <TicketPageNav
          backHref={backNav.backHref}
          backLabel={backNav.backLabel}
          eventSlug={event.slug}
        />
        <StatusCard icon={Hourglass} title="Pagamento recebido" tone="warning">
          <p className="text-foreground">
            Seu pagamento de{" "}
            <strong>{moneyFormatter.format(order.total_cents / 100)}</strong>{" "}
            chegou, mas precisa ser conferido pela nossa equipe antes de os
            ingressos serem liberados.
          </p>
          <p>
            Se os ingressos forem liberados, você recebe os QR Codes por
            e-mail em <strong className="text-foreground">{maskEmail(order.buyer_email)}</strong>. Se não
            houver lugar, o valor será devolvido.
          </p>
        </StatusCard>
      </OrderShell>
    );
  }

  if (order.status === "estornado") {
    const { data: refund } = await admin
      .from("order_refunds")
      .select("status, amount_cents, created_at, completed_at")
      .eq("order_id", order.id)
      .in("status", ["solicitado", "concluido"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const done = refund?.status !== "solicitado";
    const when = refund?.completed_at ?? refund?.created_at ?? null;
    const amount = moneyFormatter.format((refund?.amount_cents ?? order.total_cents) / 100);

    return (
      <OrderShell>
        <TicketPageNav
          backHref={backNav.backHref}
          backLabel={backNav.backLabel}
          eventSlug={event.slug}
        />
        <StatusCard
          icon={Undo2}
          title={done ? "Pedido estornado" : "Estorno em andamento"}
          tone="neutral"
        >
          <p className="text-foreground">
            {done ? "Pedido estornado" : "Estorno solicitado"}
            {when ? ` em ${dateFormatter.format(new Date(when))}` : ""}.{" "}
            {done
              ? `O valor de ${amount} foi devolvido para o meio de pagamento usado.`
              : `O valor de ${amount} está sendo devolvido para o meio de pagamento usado.`}
          </p>
          <p>Os ingressos deste pedido não são mais válidos.</p>
        </StatusCard>
      </OrderShell>
    );
  }

  if (order.status !== "pago") {
    const changedByBuyer =
      order.status === "cancelado" && order.cancel_reason === "alterado_pelo_comprador";
    return (
      <OrderShell>
        <TicketPageNav
          backHref={backNav.backHref}
          backLabel={backNav.backLabel}
          eventSlug={event.slug}
        />
        <StatusCard icon={Ban} title="Ingressos indisponíveis" tone="neutral">
          <p>
            {changedByBuyer
              ? "Este pedido foi cancelado quando você alterou a seleção."
              : "Este pedido foi cancelado ou expirou."}
          </p>
          {changedByBuyer ? (
            <div className="mt-3">
              <ButtonLink
                className="w-full sm:w-auto"
                href={resumeCheckoutPath(event.slug, publicToken)}
                size="lg"
              >
                Escolher de novo com os mesmos dados
              </ButtonLink>
            </div>
          ) : null}
        </StatusCard>
      </OrderShell>
    );
  }

  const { data: tickets, error: ticketsError } = await admin
    .from("tickets")
    .select("code, buyer_name, kind, status")
    .eq("order_id", order.id)
    .in("status", ["pago", "check_in"])
    .order("created_at");

  if (ticketsError) throw new Error("Não foi possível carregar os ingressos.");

  const isCourtesy = order.payment_provider === COURTESY_PROVIDER;

  return (
    <OrderShell wide>
      <div>
        <TicketPageNav
          backHref={backNav.backHref}
          backLabel={backNav.backLabel}
          eventSlug={event.slug}
        />

        <PaymentConfirmed
          eventSlug={event.slug}
          justConfirmed={justConfirmed}
          maskedEmail={isCourtesy ? null : maskEmail(order.buyer_email)}
          ticketCount={tickets?.length ?? 0}
          title={isCourtesy ? "Ingresso confirmado!" : "Pagamento confirmado!"}
        />

        <header className="mx-auto mt-10 max-w-2xl text-center">
          <h2 className="font-display text-4xl tracking-wide text-foreground sm:text-5xl">
            Seus ingressos
          </h2>
          <p className="mt-3 text-base text-foreground">
            {event.name} · {dateFormatter.format(new Date(event.starts_at))}
          </p>
          <p className="mt-1 text-base text-byla-muted">{event.venue}</p>
          <p className="mt-4 text-base text-byla-muted">
            Apresente o QR Code na entrada. Cada ingresso deve ser usado uma
            única vez. Use “Baixar ingresso (PDF)” para guardar no celular.
          </p>
        </header>

        {tickets?.length ? (
          <section className="mt-8 grid gap-6 md:grid-cols-2">
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
          <EmptyState className="mt-8" title="Nenhum ingresso disponível para este pedido." />
        )}
      </div>
    </OrderShell>
  );
}
