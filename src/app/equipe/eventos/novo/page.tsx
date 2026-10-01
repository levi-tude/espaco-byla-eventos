import Link from "next/link";

import { EventForm } from "@/components/equipe/EventForm";

export default function NovoEventoPage() {
  return (
    <main className="mx-auto w-full max-w-4xl px-6 py-10">
      <Link
        className="text-sm text-byla-muted transition hover:text-foreground"
        href="/equipe"
      >
        ← Voltar para eventos
      </Link>
      <h1 className="mt-5 font-display text-4xl tracking-wide text-foreground">
        Novo evento
      </h1>
      <p className="mb-8 mt-1 text-byla-muted">
        Cadastre as informações e os preços dos ingressos.
      </p>
      <EventForm />
      <p className="mt-6 rounded-xl border border-dashed border-byla-border p-5 text-sm text-byla-muted">
        Salve o evento para adicionar fotos à galeria.
      </p>
    </main>
  );
}
