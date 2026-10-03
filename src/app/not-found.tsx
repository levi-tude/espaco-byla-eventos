import { SearchX } from "lucide-react";

import { SiteHeader } from "@/components/brand/SiteHeader";
import { ButtonLink } from "@/components/ui/Button";

export default function NotFound() {
  return (
    <div className="flex flex-1 flex-col">
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center px-4 py-16 text-center">
        <SearchX aria-hidden className="h-10 w-10 text-byla-muted" />
        <h1 className="mt-4 font-display text-4xl tracking-wide text-foreground">
          Página não encontrada
        </h1>
        <p className="mt-2 text-byla-muted">
          O endereço pode estar errado, ou o evento não está mais à venda.
        </p>
        <ButtonLink className="mt-8" href="/" size="lg">
          Ver programação
        </ButtonLink>
      </main>
    </div>
  );
}
