"use client";

import { useRouter } from "next/navigation";
import { useTransition, useState } from "react";

import { changeOrderSelection } from "@/app/pedidos/[publicToken]/actions";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Notice";

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
      <Button
        loading={pending}
        loadingLabel="Cancelando este pedido…"
        onClick={change}
        variant="secondary"
      >
        Alterar seleção
      </Button>
      {message ? <Notice tone="warning">{message}</Notice> : null}
    </div>
  );
}
