"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { setSalesOpen } from "@/app/equipe/eventos/actions";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Notice";

export function SalesToggle({ eventId, salesOpen }: { eventId: string; salesOpen: boolean }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  function toggleSales() {
    setMessage(null);

    startTransition(async () => {
      try {
        const result = await setSalesOpen(eventId, !salesOpen);
        if (!result.ok) return setMessage(result.error);
        router.refresh();
      } catch {
        setMessage("Não foi possível alterar a venda.");
      }
    });
  }

  return (
    <>
      <Button
        loading={isPending}
        loadingLabel={salesOpen ? "Fechando..." : "Abrindo..."}
        onClick={toggleSales}
        variant="secondary"
      >
        {salesOpen ? "Fechar venda" : "Abrir venda"}
      </Button>
      {message ? (
        <Notice className="basis-full" tone="danger">
          {message}
        </Notice>
      ) : null}
    </>
  );
}
