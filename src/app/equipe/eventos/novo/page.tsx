import { Images } from "lucide-react";

import { EventForm } from "@/components/equipe/EventForm";
import { BackLink } from "@/components/ui/BackLink";
import { EmptyState } from "@/components/ui/EmptyState";

export default function NovoEventoPage() {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-16 pt-2 sm:px-6 sm:pt-4">
      <BackLink href="/equipe">Eventos</BackLink>
      <h1 className="mt-2 font-display text-4xl tracking-wide text-foreground sm:text-5xl">
        Novo evento
      </h1>
      <p className="mb-6 mt-1 text-base text-byla-muted">
        Cadastre as informações, escolha os tipos de ingresso à venda e defina os preços.
      </p>
      <EventForm />
      <EmptyState
        className="mt-6"
        description="Salve o evento para adicionar fotos à galeria."
        icon={Images}
        title="Fotos do evento"
      />
    </main>
  );
}
