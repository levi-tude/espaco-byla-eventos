"use client";

import { useRouter } from "next/navigation";
import { useTransition, useState } from "react";

import { changeOrderSelection } from "@/app/pedidos/[publicToken]/actions";

type Props = {
  publicToken: string;
  /** Pedido cancelado com sucesso; sem isso, vai para a escolha já preenchida. */
  onChanged?: (checkoutPath: string) => void;
  /** Avisa enquanto o cancelamento está em andamento (ex.: pausar a consulta do PIX). */
  onBusyChange?: (busy: boolean) => void;
  className?: string;
};

const GENERIC_FAILURE =
  "Não foi possível alterar a seleção agora. Tente novamente em instantes.";

export function ChangeSelectionButton({
  publicToken,
  onChanged,
  onBusyChange,
  className = "",
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");

  function change() {
    setMessage("");
    onBusyChange?.(true);
    startTransition(async () => {
      try {
        const result = await changeOrderSelection(publicToken);
        if (result.status === "changed") {
          if (onChanged) {
            onChanged(result.checkoutPath);
            onBusyChange?.(false);
          } else {
            router.push(result.checkoutPath);
          }
          return;
        }
        onBusyChange?.(false);
        if (result.status === "paid") {
          router.replace(`/pedidos/${encodeURIComponent(publicToken)}?confirmado=1`);
          return;
        }
        setMessage(result.message);
        if (result.status === "unavailable") router.refresh();
      } catch {
        onBusyChange?.(false);
        setMessage(GENERIC_FAILURE);
      }
    });
  }

  return (
    <div className={`grid gap-2 ${className}`}>
      <button
        className="min-h-11 rounded-lg border border-byla-border bg-byla-surface px-4 py-2.5 text-sm font-semibold text-foreground transition hover:border-byla-blue/60 disabled:cursor-not-allowed disabled:opacity-50"
        disabled={pending}
        onClick={change}
        type="button"
      >
        {pending ? "Cancelando este pedido…" : "Alterar seleção"}
      </button>
      {message ? (
        <p
          className="rounded-lg border border-amber-500/40 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-100"
          role="alert"
        >
          {message}
        </p>
      ) : null}
    </div>
  );
}
