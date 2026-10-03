"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState, useTransition } from "react";

import {
  type BrowserCart,
  browserStorage,
  readCart,
  writeCart,
} from "@/lib/cart/browser-cart";
import type { CheckoutResume } from "@/lib/cart/resume";
import {
  type CategoryRemaining,
  fitSelection,
  MAX_PEOPLE_PER_ORDER,
  maxSelectableUnits,
  remainingNotice,
  type SelectableType,
  typeRemainingNotice,
  typeUnitsLeft,
} from "@/lib/domain/availability";
import {
  ticketKindLabels,
  unitContentsLabel,
} from "@/lib/domain/ticket-types";
import { PRIVACY_REQUIRED_MESSAGE } from "@/lib/legal/privacy";
import { useMounted } from "@/lib/use-mounted";
import type { Enums } from "@/types/database";

import { findPendingOrder, startCheckout } from "./actions";
import { PendingOrderBanner } from "./pending-order-banner";

export type CheckoutTicketType = {
  id: string;
  name: string;
  kind: Enums<"ticket_kind">;
  preset: string | null;
  priceCents: number;
  peoplePerUnit: number;
  /** Unidades restantes do limite próprio do tipo; `null` = sem limite. */
  remainingUnits: number | null;
};

type Quantities = Record<string, number>;
type Buyer = Pick<BrowserCart, "name" | "email" | "phone">;

type CheckoutFormProps = {
  slug: string;
  ticketTypes: CheckoutTicketType[];
  /** Lugares livres agora (descontando reservas); `null` se não foi possível consultar. */
  remaining: number | null;
  /** Pessoas restantes nas cotas de inteiras e meias (`null` = sem cota). */
  categoryRemaining: CategoryRemaining;
  /** Pedido anterior (`?retomar=`) que preenche a escolha e os dados. */
  resume: CheckoutResume | null;
};

const moneyFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

const EMPTY_BUYER: Buyer = { name: "", email: "", phone: "" };

function parseQty(raw: string): number {
  const digits = raw.replace(/\D/g, "").slice(0, 3);
  return digits ? Number(digits) : 0;
}

function qtyOf(quantities: Quantities, id: string): number {
  return quantities[id] ?? 0;
}

function sameSelection(a: Quantities, b: Quantities, ids: readonly string[]) {
  return ids.every((id) => qtyOf(a, id) === qtyOf(b, id));
}

export function CheckoutForm(props: CheckoutFormProps) {
  // O carrinho salvo só existe no navegador: remonta depois da hidratação para lê-lo.
  const mounted = useMounted();
  return (
    <CheckoutFormFields
      key={mounted ? "browser" : "server"}
      restoreCart={mounted}
      {...props}
    />
  );
}

function CheckoutFormFields({
  slug,
  ticketTypes,
  remaining: initialRemaining,
  categoryRemaining: initialCategoryRemaining,
  resume,
  restoreCart,
}: CheckoutFormProps & { restoreCart: boolean }) {
  const ids = ticketTypes.map(({ id }) => id);
  const [remaining, setRemaining] = useState(initialRemaining);
  const [categoryRemaining, setCategoryRemaining] = useState(initialCategoryRemaining);
  const [typeRemaining, setTypeRemaining] = useState<Record<string, number | null>>(
    () => Object.fromEntries(ticketTypes.map((type) => [type.id, type.remainingUnits])),
  );
  const capacityLeft = remaining ?? MAX_PEOPLE_PER_ORDER;
  const selectable = (limits: Record<string, number | null>): SelectableType[] =>
    ticketTypes.map((type) => ({
      id: type.id,
      kind: type.kind,
      peoplePerUnit: type.peoplePerUnit,
      remainingUnits: limits[type.id] ?? null,
    }));

  const [initial] = useState(() => {
    // Carrinho de antes dos tipos configuráveis: inteira/meia viram os tipos prontos.
    const legacyKinds = {
      inteira: ticketTypes.find((type) => type.preset === "inteira")?.id,
      meia: ticketTypes.find((type) => type.preset === "meia")?.id,
    };
    const cart = restoreCart
      ? readCart(browserStorage(), slug, Date.now(), legacyKinds)
      : null;
    const cartToken = cart?.pendingOrderToken ?? null;
    // Um pedido mais novo feito neste navegador vale mais que o link de retomada.
    const preferCart = Boolean(cart && cartToken && cartToken !== resume?.publicToken);
    const source = resume && !preferCart ? resume : null;
    const requested = source?.quantities ?? cart?.quantities ?? {};
    const offered: Quantities = Object.fromEntries(
      ids.map((id) => [id, qtyOf(requested, id)]),
    );
    const droppedFromRequest = Object.entries(requested).some(
      ([id, qty]) => qty > 0 && !ids.includes(id),
    );
    // Pedido ainda reservado: os lugares dele não entram em "restantes"; mostra como está.
    const quantities = source?.awaitingUntil
      ? offered
      : fitSelection(offered, selectable(typeRemaining), capacityLeft, categoryRemaining);
    const pendingToken = resume?.awaitingUntil
      ? resume.publicToken
      : cartToken && cartToken !== resume?.publicToken
        ? cartToken
        : null;
    const fromCart = source === null && cart !== null;
    return {
      quantities,
      buyer: source
        ? source.buyer
        : cart
          ? { name: cart.name, email: cart.email, phone: cart.phone }
          : EMPTY_BUYER,
      adjusted:
        (source !== null &&
          !source.awaitingUntil &&
          (source.droppedItems ||
            droppedFromRequest ||
            !sameSelection(quantities, source.quantities, ids))) ||
        (fromCart && (Boolean(cart.droppedItems) || droppedFromRequest)),
      pendingToken,
      pendingUntil: pendingToken && resume?.awaitingUntil ? resume.awaitingUntil : null,
    };
  });
  const [quantities, setQuantities] = useState<Quantities>(initial.quantities);
  const [buyer, setBuyer] = useState<Buyer>(initial.buyer);
  const [pendingToken, setPendingToken] = useState(initial.pendingToken);
  const [pendingUntil, setPendingUntil] = useState(initial.pendingUntil);
  const [checkingPending, setCheckingPending] = useState(
    restoreCart && initial.pendingToken !== null && initial.pendingUntil === null,
  );
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const awaitingPayment = pendingToken !== null && pendingUntil !== null;
  const totalCents = ticketTypes.reduce(
    (sum, type) => sum + type.priceCents * qtyOf(quantities, type.id),
    0,
  );
  const peopleIn = (current: Quantities, kind?: string) =>
    ticketTypes.reduce(
      (sum, type) =>
        kind === undefined || type.kind === kind
          ? sum + type.peoplePerUnit * qtyOf(current, type.id)
          : sum,
      0,
    );
  const totalPeople = peopleIn(quantities);
  const selectionLimit = Math.min(capacityLeft, MAX_PEOPLE_PER_ORDER);
  const notice = remaining === null ? null : remainingNotice(remaining);
  const limitHint =
    totalPeople > 0 && totalPeople >= selectionLimit
      ? selectionLimit < MAX_PEOPLE_PER_ORDER
        ? "Você escolheu todos os lugares disponíveis no momento."
        : `Máximo de ${MAX_PEOPLE_PER_ORDER} pessoas por compra.`
      : "";

  useEffect(() => {
    if (!restoreCart) return;
    writeCart(browserStorage(), slug, {
      quantities,
      ...buyer,
      ...(pendingToken ? { pendingOrderToken: pendingToken } : {}),
    });
  }, [restoreCart, slug, quantities, buyer, pendingToken]);

  // Voltar da tela de pagamento não cria outro pedido: o anterior é oferecido primeiro.
  useEffect(() => {
    if (!checkingPending || !pendingToken) return;
    let active = true;
    findPendingOrder(slug, pendingToken)
      .then((found) => {
        if (!active) return;
        if (found.state === "awaiting_payment") setPendingUntil(found.expiresAt);
        else setPendingToken(null);
      })
      .catch(() => {
        // Sem resposta: segue sem o aviso; o pedido anterior vence sozinho.
      })
      .finally(() => {
        if (active) setCheckingPending(false);
      });
    return () => {
      active = false;
    };
  }, [checkingPending, pendingToken, slug]);

  // Os lugares do pedido cancelado voltaram: recarrega a disponibilidade já preenchido.
  function selectionChanged(checkoutPath: string) {
    setPendingUntil(null);
    setPendingToken(null);
    router.replace(checkoutPath);
  }

  function maxFor(type: CheckoutTicketType, current: Quantities = quantities) {
    const own = type.peoplePerUnit * qtyOf(current, type.id);
    return maxSelectableUnits({
      remaining: capacityLeft,
      peopleSelectedElsewhere: peopleIn(current) - own,
      peoplePerUnit: type.peoplePerUnit,
      typeRemainingUnits: typeRemaining[type.id] ?? null,
      categoryRemaining:
        type.kind === "inteira" || type.kind === "meia"
          ? categoryRemaining[type.kind]
          : null,
      categoryPeopleSelectedElsewhere: peopleIn(current, type.kind) - own,
    });
  }

  function setQty(
    type: CheckoutTicketType,
    next: number | ((qty: number) => number),
  ) {
    setQuantities((current) => {
      const currentQty = qtyOf(current, type.id);
      const wanted = typeof next === "function" ? next(currentQty) : next;
      const safe = Math.max(0, Math.min(maxFor(type, current), Math.trunc(wanted) || 0));
      return currentQty === safe ? current : { ...current, [type.id]: safe };
    });
  }

  function setBuyerField(field: keyof Buyer, value: string) {
    setBuyer((current) => ({ ...current, [field]: value }));
  }

  function clearSelection() {
    setQuantities({});
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (awaitingPayment || checkingPending) return;
    setError("");
    const data = new FormData(event.currentTarget);

    startTransition(async () => {
      try {
        const result = await startCheckout({
          slug,
          items: ticketTypes
            .filter((type) => qtyOf(quantities, type.id) > 0)
            .map((type) => ({ ticketTypeId: type.id, qty: qtyOf(quantities, type.id) })),
          buyer,
          acceptedPrivacy: data.get("privacy") === "on",
        });
        if ("error" in result) {
          setError(result.error);
          const updated = result.availability;
          if (updated) {
            const limits = { ...typeRemaining, ...updated.typeRemaining };
            setRemaining(updated.remaining);
            setCategoryRemaining(updated.categoryRemaining);
            setTypeRemaining(limits);
            setQuantities((current) =>
              fitSelection(
                current,
                selectable(limits),
                updated.remaining,
                updated.categoryRemaining,
              ),
            );
          }
          return;
        }
        // Gravado já, antes de sair da página: ao voltar, o pedido é reconhecido.
        writeCart(browserStorage(), slug, {
          quantities,
          ...buyer,
          pendingOrderToken: result.publicToken,
        });
        setPendingToken(result.publicToken);
        router.push(`/pedidos/${result.publicToken}`);
      } catch {
        setError("Não foi possível iniciar o pagamento. Tente novamente.");
      }
    });
  }

  const fieldClass =
    "rounded-lg border border-byla-border bg-byla-input px-3 py-2.5 text-foreground outline-none focus:border-byla-blue focus:ring-2 focus:ring-byla-ring";
  const stepperClass =
    "inline-flex h-11 w-11 items-center justify-center rounded-lg border border-byla-border bg-byla-input text-xl font-semibold text-foreground disabled:opacity-40";

  return (
    <form className="mt-8 grid gap-6" onSubmit={submit}>
      {pendingToken && pendingUntil ? (
        <PendingOrderBanner
          expiresAt={pendingUntil}
          onChanged={selectionChanged}
          publicToken={pendingToken}
        />
      ) : null}
      {initial.adjusted ? (
        <p
          className="rounded-lg border border-amber-500/40 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-100"
          role="status"
        >
          Alguns itens não estão mais disponíveis. Ajustamos sua seleção.
        </p>
      ) : null}
      <fieldset className="grid gap-3" disabled={awaitingPayment}>
        <legend className="font-semibold text-foreground">
          Escolha seus ingressos
        </legend>
        {notice ? (
          <p className="text-sm font-semibold text-amber-700 dark:text-byla-yellow">
            {notice}
          </p>
        ) : null}
        {ticketTypes.map((type) => {
          const qty = qtyOf(quantities, type.id);
          const max = maxFor(type);
          const typeNotice = typeRemainingNotice(
            typeUnitsLeft(
              { ...type, remainingUnits: typeRemaining[type.id] ?? null },
              categoryRemaining,
            ),
          );
          const showContents =
            type.peoplePerUnit > 1 || type.name !== ticketKindLabels[type.kind];
          return (
            <div
              className="flex items-center justify-between gap-4 rounded-xl border border-byla-border bg-byla-overlay p-4"
              key={type.id}
            >
              <div className="min-w-0">
                <p className="font-medium text-foreground">{type.name}</p>
                <p className="text-sm text-byla-muted">
                  {moneyFormatter.format(type.priceCents / 100)}
                  {showContents
                    ? ` · ${unitContentsLabel(type.peoplePerUnit, type.kind)}`
                    : ""}
                </p>
                {typeNotice ? (
                  <p className="text-xs font-semibold text-amber-700 dark:text-byla-yellow">
                    {typeNotice}
                  </p>
                ) : null}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  aria-label={`Diminuir ${type.name}`}
                  className={stepperClass}
                  disabled={qty <= 0 || pending}
                  onClick={() => setQty(type, (current) => current - 1)}
                  type="button"
                >
                  −
                </button>
                <input
                  aria-label={`Quantidade ${type.name}`}
                  className={`${fieldClass} w-14 text-center`}
                  disabled={pending || (max === 0 && qty === 0)}
                  inputMode="numeric"
                  max={max}
                  min={0}
                  onChange={(event) => setQty(type, parseQty(event.target.value))}
                  type="text"
                  value={String(qty)}
                />
                <button
                  aria-label={`Aumentar ${type.name}`}
                  className={stepperClass}
                  disabled={qty >= max || pending}
                  onClick={() => setQty(type, (current) => current + 1)}
                  type="button"
                >
                  +
                </button>
              </div>
            </div>
          );
        })}
        <div className="flex min-h-6 flex-wrap items-center justify-between gap-2">
          <p aria-live="polite" className="text-sm text-byla-muted">
            {limitHint}
          </p>
          {totalPeople > 0 ? (
            <button
              className="text-sm font-medium text-byla-blue underline underline-offset-2 disabled:opacity-50"
              disabled={pending}
              onClick={clearSelection}
              type="button"
            >
              Limpar seleção
            </button>
          ) : null}
        </div>
      </fieldset>

      <fieldset className="grid gap-4" disabled={awaitingPayment}>
        <legend className="font-semibold text-foreground">Seus dados</legend>
        <label className="grid gap-1 text-sm text-byla-muted">
          Nome
          <input
            autoComplete="name"
            className={fieldClass}
            maxLength={200}
            name="name"
            onChange={(event) => setBuyerField("name", event.target.value)}
            required
            value={buyer.name}
          />
        </label>
        <label className="grid gap-1 text-sm text-byla-muted">
          E-mail
          <input
            autoComplete="email"
            className={fieldClass}
            maxLength={320}
            name="email"
            onChange={(event) => setBuyerField("email", event.target.value)}
            required
            type="email"
            value={buyer.email}
          />
        </label>
        <label className="grid gap-1 text-sm text-byla-muted">
          Telefone (opcional)
          <input
            autoComplete="tel"
            className={fieldClass}
            inputMode="tel"
            maxLength={40}
            name="phone"
            onChange={(event) => setBuyerField("phone", event.target.value)}
            type="tel"
            value={buyer.phone}
          />
        </label>
        <label className="flex items-start gap-3 text-sm text-byla-muted">
          <input
            className="mt-0.5 h-5 w-5 shrink-0 accent-byla-blue"
            name="privacy"
            onChange={(event) => event.currentTarget.setCustomValidity("")}
            onInvalid={(event) =>
              event.currentTarget.setCustomValidity(PRIVACY_REQUIRED_MESSAGE)
            }
            required
            type="checkbox"
          />
          <span>
            Li e aceito a{" "}
            <Link
              className="font-medium text-byla-blue underline underline-offset-2"
              href="/privacidade"
              rel="noopener"
              target="_blank"
            >
              Política de Privacidade
            </Link>
            .
          </span>
        </label>
      </fieldset>

      <div className="flex items-center justify-between border-t border-byla-border pt-5">
        <span className="font-medium text-foreground">
          Total
          {totalPeople > 0
            ? ` · ${totalPeople} ingresso${totalPeople === 1 ? "" : "s"}`
            : ""}
        </span>
        <strong className="text-2xl text-amber-700 dark:text-byla-yellow">
          {moneyFormatter.format(totalCents / 100)}
        </strong>
      </div>
      {error ? (
        <p
          className="rounded-lg border border-amber-500/40 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-100"
          role="alert"
        >
          {error}
        </p>
      ) : null}
      <button
        className="min-h-12 rounded-lg bg-byla-blue px-4 py-3 font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
        disabled={pending || totalCents === 0 || awaitingPayment || checkingPending}
        type="submit"
      >
        {pending
          ? "Reservando ingressos…"
          : checkingPending
            ? "Conferindo pedido anterior…"
            : "Continuar para o pagamento"}
      </button>
      {awaitingPayment ? (
        <p className="-mt-3 text-center text-sm text-byla-muted">
          Para mudar ingressos ou dados, toque em “Alterar seleção” acima.
        </p>
      ) : null}
    </form>
  );
}
