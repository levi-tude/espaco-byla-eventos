import Link from "next/link";

import { EventForm } from "@/components/equipe/EventForm";

export default function NovoEventoPage() {
  return (
    <main className="mx-auto w-full max-w-4xl px-6 py-10">
      <Link className="text-sm text-zinc-600 hover:text-zinc-950" href="/equipe">
        ← Voltar para eventos
      </Link>
      <h1 className="mt-5 text-3xl font-semibold tracking-tight">Novo evento</h1>
      <p className="mb-8 mt-1 text-zinc-600">
        Cadastre as informações e os preços dos ingressos.
      </p>
      <EventForm />
    </main>
  );
}
