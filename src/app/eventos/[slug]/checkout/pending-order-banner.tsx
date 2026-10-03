"use client";

import { Clock } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { ChangeSelectionButton } from "@/components/public/ChangeSelectionButton";
import { ButtonLink } from "@/components/ui/Button";
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
      className="rounded-2xl border border-byla-info/40 bg-byla-info-bg p-4"
      role="status"
    >
      <div className="flex gap-3">
        <Clock aria-hidden className="mt-0.5 h-5 w-5 shrink-0 text-byla-info" />
        <div className="min-w-0">
          <p className="text-base font-semibold text-foreground">
            Você tem um pedido aguardando pagamento (reserva até{" "}
            <strong>{timeFormatter.format(new Date(expiresAt))}</strong>).
          </p>
          <p className="mt-1 text-base text-foreground">
            Continue o pagamento desse pedido ou altere a seleção. Alterar cancela o
            pedido anterior e libera os lugares.
          </p>
        </div>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 sm:items-start">
        <ButtonLink href={`/pedidos/${encodeURIComponent(publicToken)}`}>
          Continuar pagamento
        </ButtonLink>
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
