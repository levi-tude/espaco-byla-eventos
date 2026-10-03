"use client";

import { CircleAlert } from "lucide-react";
import { useEffect } from "react";

import { Button, ButtonLink } from "@/components/ui/Button";

type ErrorScreenProps = {
  error: Error & { digest?: string };
  retry: () => void;
  homeHref: string;
  homeLabel: string;
};

export function ErrorScreen({ error, retry, homeHref, homeLabel }: ErrorScreenProps) {
  useEffect(() => {
    console.error("[tela] Erro inesperado.", error.digest ?? "");
  }, [error]);

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center px-4 py-16 text-center">
      <CircleAlert aria-hidden className="h-10 w-10 text-byla-danger" />
      <h1 className="mt-4 font-display text-4xl tracking-wide text-foreground">Algo deu errado</h1>
      <p className="mt-2 text-byla-muted">
        Não foi possível carregar esta página agora. Tente de novo em alguns segundos.
      </p>
      <div className="mt-8 flex w-full flex-col gap-3 sm:flex-row sm:justify-center">
        <Button onClick={() => retry()} size="lg">
          Tentar de novo
        </Button>
        <ButtonLink href={homeHref} size="lg" variant="secondary">
          {homeLabel}
        </ButtonLink>
      </div>
    </main>
  );
}
