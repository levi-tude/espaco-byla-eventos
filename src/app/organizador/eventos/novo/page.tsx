import type { Metadata } from "next";

import { EventForm } from "@/components/equipe/EventForm";
import { OrganizerNoAccess } from "@/components/organizer/OrganizerNoAccess";
import { BackLink } from "@/components/ui/BackLink";
import { getActor } from "@/lib/auth/actor";
import { organizerAreaEnabled } from "@/lib/organizer/settings";

export const metadata: Metadata = {
  title: "Criar evento",
  robots: { index: false, follow: false },
};

export default async function NovoEventoOrganizadorPage() {
  const actor = await getActor();
  if (actor?.kind !== "organizador") {
    return <OrganizerNoAccess areaEnabled={await organizerAreaEnabled()} />;
  }

  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-16 pt-2 sm:px-6 sm:pt-4">
      <BackLink href="/organizador">Meus eventos</BackLink>
      <h1 className="mt-2 font-display text-4xl tracking-wide text-foreground">Criar evento</h1>
      <p className="mt-1 text-base text-byla-muted">
        O evento fica como rascunho, só para você. Quando estiver pronto, envie para o ACDH Eventos
        aprovar.
      </p>
      <div className="mt-6">
        <EventForm area="organizador" />
      </div>
    </main>
  );
}
