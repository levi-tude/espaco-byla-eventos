import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { SiteHeader } from "@/components/brand/SiteHeader";
import { OrganizerTermsText } from "@/components/legal/OrganizerTermsText";
import { SignupWizard } from "@/components/organizer/SignupWizard";
import { organizerAreaEnabled } from "@/lib/organizer/settings";

export const metadata: Metadata = {
  title: "Convite para organizadores · ACDH Eventos",
  robots: { index: false },
};

export default async function InvitePage() {
  if (!(await organizerAreaEnabled())) notFound();

  return (
    <main className="relative flex min-h-full flex-1 flex-col">
      <SiteHeader />
      <div className="mx-auto w-full max-w-xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
        <h1 className="font-display text-4xl tracking-wide text-foreground sm:text-5xl">
          Criar conta de organizador
        </h1>
        <p className="mt-3 text-base leading-relaxed text-byla-muted">
          Com a conta você cria seus eventos no site da ACDH Eventos e acompanha as vendas.
        </p>
        <div className="mt-6 rounded-2xl border border-byla-border bg-byla-surface p-4 sm:p-6">
          <SignupWizard terms={<OrganizerTermsText />} />
        </div>
      </div>
    </main>
  );
}
