"use client";

import { FormEvent, useState, useTransition } from "react";

import { startCheckout } from "./actions";

type TicketType = {
  kind: "inteira" | "meia";
  priceCents: number;
};

const moneyFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

export function CheckoutForm({
  slug,
  ticketTypes,
}: {
  slug: string;
  ticketTypes: TicketType[];
}) {
  const [quantities, setQuantities] = useState({ inteira: 0, meia: 0 });
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const totalCents = ticketTypes.reduce(
    (sum, ticketType) =>
      sum + ticketType.priceCents * quantities[ticketType.kind],
    0,
  );

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const data = new FormData(event.currentTarget);

    startTransition(async () => {
      try {
        const { checkoutUrl } = await startCheckout({
          slug,
          items: ticketTypes.map(({ kind }) => ({
            kind,
            qty: quantities[kind],
          })),
          buyer: {
            name: String(data.get("name") ?? ""),
            email: String(data.get("email") ?? ""),
            phone: String(data.get("phone") ?? ""),
          },
        });
        window.location.assign(checkoutUrl);
      } catch (cause) {
        setError(
          cause instanceof Error
            ? cause.message
            : "Não foi possível iniciar o pagamento.",
        );
      }
    });
  }

  return (
    <form className="mt-8 grid gap-6" onSubmit={submit}>
      <fieldset className="grid gap-3">
        <legend className="font-semibold">Escolha seus ingressos</legend>
        {ticketTypes.map((ticketType) => (
          <label
            className="flex items-center justify-between gap-4 rounded-lg border border-zinc-200 p-4"
            key={ticketType.kind}
          >
            <span>
              <span className="block capitalize">{ticketType.kind}</span>
              <span className="text-sm text-zinc-600">
                {moneyFormatter.format(ticketType.priceCents / 100)}
              </span>
            </span>
            <input
              aria-label={`Quantidade ${ticketType.kind}`}
              className="w-20 rounded-md border border-zinc-300 px-3 py-2"
              min="0"
              onChange={(event) =>
                setQuantities((current) => ({
                  ...current,
                  [ticketType.kind]: Number(event.target.value),
                }))
              }
              type="number"
              value={quantities[ticketType.kind]}
            />
          </label>
        ))}
      </fieldset>

      <fieldset className="grid gap-4">
        <legend className="font-semibold">Seus dados</legend>
        <label className="grid gap-1 text-sm">
          Nome
          <input
            className="rounded-md border border-zinc-300 px-3 py-2"
            name="name"
            required
          />
        </label>
        <label className="grid gap-1 text-sm">
          E-mail
          <input
            className="rounded-md border border-zinc-300 px-3 py-2"
            name="email"
            required
            type="email"
          />
        </label>
        <label className="grid gap-1 text-sm">
          Telefone (opcional)
          <input
            className="rounded-md border border-zinc-300 px-3 py-2"
            name="phone"
            type="tel"
          />
        </label>
      </fieldset>

      <div className="flex items-center justify-between border-t border-zinc-200 pt-5">
        <span className="font-medium">Total</span>
        <strong className="text-xl">
          {moneyFormatter.format(totalCents / 100)}
        </strong>
      </div>
      {error ? (
        <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>
      ) : null}
      <button
        className="rounded-lg bg-zinc-950 px-4 py-3 font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
        disabled={pending || totalCents === 0}
        type="submit"
      >
        {pending ? "Abrindo pagamento…" : "Pagar"}
      </button>
    </form>
  );
}
