import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PublicSiteHeader } from "@/components/brand/PublicSiteHeader";
import { OrganizerTermsText } from "@/components/legal/OrganizerTermsText";
import { BackLink } from "@/components/ui/BackLink";
import { organizerAreaEnabled } from "@/lib/organizer/settings";

export const metadata: Metadata = {
  title: "Termos do organizador · ACDH Eventos",
  description:
    "Regras para quem cria e vende ingressos de eventos próprios pelo site da ACDH Eventos.",
};

export default async function OrganizerTermsPage() {
  if (!(await organizerAreaEnabled())) notFound();

  return (
    <main className="relative flex min-h-full flex-1 flex-col">
      <PublicSiteHeader />
      <article className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
        <h1 className="mb-2 font-display text-4xl tracking-wide text-foreground sm:text-5xl">
          Termos do organizador
        </h1>
        <OrganizerTermsText />
        <p className="mt-10">
          <BackLink href="/">Voltar para os eventos</BackLink>
        </p>
      </article>
    </main>
  );
}
