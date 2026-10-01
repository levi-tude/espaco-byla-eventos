"use client";

import { CircleCheck } from "lucide-react";
import { useEffect, useRef } from "react";

import { browserStorage, clearCart } from "@/lib/cart/browser-cart";

type Props = {
  title: string;
  /** E-mail já mascarado no servidor; `null` quando não houve envio (ex.: cortesia). */
  maskedEmail: string | null;
  ticketCount: number;
  eventSlug: string;
  /** Só liga a animação de entrada; o status mostrado vem sempre do banco. */
  justConfirmed: boolean;
};

export function PaymentConfirmed({
  title,
  maskedEmail,
  ticketCount,
  eventSlug,
  justConfirmed,
}: Props) {
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
    clearCart(browserStorage(), eventSlug);
  }, [eventSlug]);

  return (
    <section
      className={`rounded-2xl border border-emerald-600/40 bg-emerald-50 p-6 text-center text-emerald-950 md:p-8 dark:border-emerald-400/40 dark:bg-emerald-500/10 dark:text-emerald-50 ${
        justConfirmed ? "motion-safe:animate-success-in" : ""
      }`}
      role="status"
    >
      <CircleCheck
        aria-hidden="true"
        className="mx-auto h-14 w-14 text-emerald-600 dark:text-emerald-400"
        strokeWidth={2.2}
      />
      <h1
        className="mt-3 font-display text-4xl tracking-wide outline-none sm:text-5xl"
        ref={headingRef}
        tabIndex={-1}
      >
        {title}
      </h1>
      {maskedEmail ? (
        <p className="mt-3 text-base">
          Enviamos seus ingressos para <strong>{maskedEmail}</strong>.
        </p>
      ) : null}
      <p className="mt-2 text-base">
        {ticketCount} {ticketCount === 1 ? "ingresso" : "ingressos"} · Mostre o
        QR Code na entrada.
      </p>
    </section>
  );
}
