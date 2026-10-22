import type { Metadata } from "next";

import { OrganizerLoginForm } from "@/app/organizador/entrar/OrganizerLoginForm";
import { BrandMark } from "@/components/brand/BrandMark";
import { ThemeToggle } from "@/components/brand/ThemeToggle";
import { Notice } from "@/components/ui/Notice";
import { organizerAreaEnabled } from "@/lib/organizer/settings";

export const metadata: Metadata = {
  title: "Área do organizador",
  robots: { index: false, follow: false },
};

export default async function OrganizerEnterPage() {
  const enabled = await organizerAreaEnabled();

  return (
    <main className="relative flex min-h-dvh flex-col bg-byla-bg">
      <div className="flex justify-end px-4 pt-3 sm:px-6 sm:pt-4">
        <ThemeToggle />
      </div>
      <div className="flex flex-1 items-start justify-center px-4 pb-12 pt-4 sm:items-center sm:pt-0">
        <section className="w-full max-w-sm rounded-2xl border border-byla-border bg-byla-surface p-6 shadow-xl shadow-black/20 sm:p-8 dark:shadow-black/40">
          <div className="flex items-center gap-3">
            <BrandMark size={40} />
            <p className="font-display text-xl tracking-wide text-foreground">
              ACDH Eventos
            </p>
          </div>
          <h1 className="mt-6 text-2xl font-semibold tracking-tight text-foreground">
            Área do organizador
          </h1>

          {enabled ? (
            <OrganizerLoginForm />
          ) : (
            <Notice className="mt-6" live={false} tone="info">
              A área do organizador ainda não está disponível.
            </Notice>
          )}
        </section>
      </div>
    </main>
  );
}
