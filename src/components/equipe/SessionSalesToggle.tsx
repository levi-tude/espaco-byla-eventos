"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { setSessionSalesOpen } from "@/app/equipe/eventos/actions";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Notice";

/** "Encerrar vendas desta sessão" (a venda também fecha sozinha 5 min depois do início). */
export function SessionSalesToggle({
  sessionId,
  salesOpen,
}: {
  sessionId: string;
  salesOpen: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  function toggle() {
    if (
      salesOpen &&
      !window.confirm("Encerrar as vendas desta sessão agora? Você pode reabrir depois.")
    ) {
      return;
    }
    setMessage(null);
    startTransition(async () => {
      try {
        const result = await setSessionSalesOpen(sessionId, !salesOpen);
        if (!result.ok) return setMessage(result.error);
        router.refresh();
      } catch {
        setMessage("Não foi possível alterar a venda desta sessão.");
      }
    });
  }

  return (
    <>
      <Button
        loading={isPending}
        loadingLabel={salesOpen ? "Encerrando..." : "Reabrindo..."}
        onClick={toggle}
        variant="secondary"
      >
        {salesOpen ? "Encerrar vendas desta sessão" : "Reabrir vendas desta sessão"}
      </Button>
      {message ? (
        <Notice className="basis-full" tone="danger">
          {message}
        </Notice>
      ) : null}
    </>
  );
}
