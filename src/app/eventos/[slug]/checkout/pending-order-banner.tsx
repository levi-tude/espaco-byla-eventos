"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { ChangeSelectionButton } from "@/components/public/ChangeSelectionButton";
import { browserStorage, readCart } from "@/lib/cart/browser-cart";
import { eventDateFormatter } from "@/lib/datetime";
import { useMounted } from "@/lib/use-mounted";

import { findPendingOrder } from "./actions";

const timeFormatter = eventDateFormatter({ timeStyle: "short" });

type PendingOrder = { token: string; expiresAt: string };

export function PendingOrderBanner({
  publicToken,
  expiresAt,
  onChanged,
}: {
  publicToken: string;
  expiresAt: string;
  onChanged: (checkoutPath: string) => void;
}) {
  return (
    <section
      className="rounded-xl border border-byla-blue/50 bg-byla-overlay p-4"
      role="status"
    >
      <p className="font-medium text-foreground">
        Você tem um pedido aguardando pagamento (reserva até{" "}
        <strong>{timeFormatter.format(new Date(expiresAt))}</strong>).
      </p>
      <p className="mt-1 text-sm text-byla-muted">
        Continue o pagamento desse pedido ou altere a seleção. Alterar cancela o
        pedido anterior e libera os lugares.
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 sm:items-start">
        <Link
          className="inline-flex min-h-11 items-center justify-center rounded-lg bg-byla-blue px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-110"
          href={`/pedidos/${encodeURIComponent(publicToken)}`}
        >
          Continuar pagamento
        </Link>
        <ChangeSelectionButton onChanged={onChanged} publicToken={publicToken} />
      </div>
    </section>
  );
}

/**
 * Sem lugares livres, o checkout não mostra o formulário; mas os lugares podem ser
 * os do próprio pedido pendente deste navegador, que precisa continuar acessível.
 */
export function HeldPendingOrder({
  slug,
  initialOrder,
}: {
  slug: string;
  /** Pedido do link `?retomar=` ainda aguardando pagamento. */
  initialOrder: PendingOrder | null;
}) {
  const mounted = useMounted();
  const router = useRouter();
  const [found, setFound] = useState<PendingOrder | null>(initialOrder);

  useEffect(() => {
    if (!mounted || initialOrder) return;
    const token = readCart(browserStorage(), slug)?.pendingOrderToken;
    if (!token) return;
    let active = true;
    findPendingOrder(slug, token)
      .then((result) => {
        if (active && result.state === "awaiting_payment") {
          setFound({ token, expiresAt: result.expiresAt });
        }
      })
      .catch(() => {
        // Sem resposta: fica só a mensagem de lugares reservados.
      });
    return () => {
      active = false;
    };
  }, [mounted, slug, initialOrder]);

  if (!found) return null;
  return (
    <div className="mt-4">
      <PendingOrderBanner
        expiresAt={found.expiresAt}
        onChanged={(checkoutPath) => router.replace(checkoutPath)}
        publicToken={found.token}
      />
    </div>
  );
}
