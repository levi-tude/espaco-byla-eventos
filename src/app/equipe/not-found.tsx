import { SearchX } from "lucide-react";

import { ButtonLink } from "@/components/ui/Button";

export default function NotFound() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center px-4 py-16 text-center">
      <SearchX aria-hidden className="h-10 w-10 text-byla-muted" />
      <h1 className="mt-4 font-display text-4xl tracking-wide text-foreground">
        Não encontrado
      </h1>
      <p className="mt-2 text-byla-muted">Este evento não existe ou foi removido.</p>
      <ButtonLink className="mt-8" href="/equipe" size="lg">
        Voltar para eventos
      </ButtonLink>
    </main>
  );
}
