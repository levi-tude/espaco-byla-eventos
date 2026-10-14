import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { SiteHeader } from "@/components/brand/SiteHeader";
import { OrganizerRequestForm } from "@/components/public/OrganizerRequestForm";
import { BackLink } from "@/components/ui/BackLink";
import { ORGANIZER_TERMS_PATH } from "@/lib/legal/organizer-terms";
import { organizerAreaEnabled } from "@/lib/organizer/settings";

export const metadata: Metadata = {
  title: "Quero fazer meu evento · Espaço Byla Eventos",
  description: "Conte sua ideia de evento e venda ingressos pelo site do Espaço Byla.",
};

export default async function OrganizerRequestPage() {
  if (!(await organizerAreaEnabled())) notFound();

  return (
    <main className="relative flex min-h-full flex-1 flex-col">
      <SiteHeader />
      <div className="mx-auto w-full max-w-xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
        <BackLink href="/">Voltar aos eventos</BackLink>
        <h1 className="mt-2 font-display text-4xl tracking-wide text-foreground sm:text-5xl">
          Quero fazer meu evento
        </h1>
        <p className="mt-3 text-base leading-relaxed text-byla-muted">
          Você produz eventos e quer vender ingressos pelo site do Espaço Byla? Conte sua ideia
          que a gente responde pelo WhatsApp.
        </p>
        <div className="mt-6 rounded-2xl border border-byla-border bg-byla-surface p-4 sm:p-6">
          <OrganizerRequestForm />
        </div>
        <p className="mt-6 text-base">
          <Link
            className="inline-flex min-h-11 items-center font-medium text-byla-link underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-byla-blue"
            href={ORGANIZER_TERMS_PATH}
          >
            Veja como funciona para organizadores
          </Link>
        </p>
      </div>
    </main>
  );
}
