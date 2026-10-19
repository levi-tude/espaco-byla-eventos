import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { SiteHeader } from "@/components/brand/SiteHeader";
import { organizerAreaEnabled } from "@/lib/organizer/settings";

import { ResetPasswordForm } from "./ResetPasswordForm";

export const metadata: Metadata = {
  title: "Nova senha · ACDH Eventos",
  robots: { index: false },
};

export default async function ResetPasswordPage() {
  if (!(await organizerAreaEnabled())) notFound();

  return (
    <main className="relative flex min-h-full flex-1 flex-col">
      <SiteHeader />
      <div className="mx-auto w-full max-w-xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
        <h1 className="font-display text-4xl tracking-wide text-foreground sm:text-5xl">Nova senha</h1>
        <p className="mt-3 text-base leading-relaxed text-byla-muted">
          Crie uma senha nova para a sua conta de organizador. Este link só funciona uma vez.
        </p>
        <div className="mt-6 rounded-2xl border border-byla-border bg-byla-surface p-4 sm:p-6">
          <ResetPasswordForm />
        </div>
      </div>
    </main>
  );
}
