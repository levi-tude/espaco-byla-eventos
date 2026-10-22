import type { Metadata } from "next";

import { PublicSiteHeader } from "@/components/brand/PublicSiteHeader";

import { ResetPasswordForm } from "./ResetPasswordForm";

export const metadata: Metadata = {
  title: "Nova senha · ACDH Eventos",
  robots: { index: false },
};

/** Pedido/troca de senha: não depende da chave da área do organizador (equipe também usa). */
export default async function ResetPasswordPage() {
  return (
    <main className="relative flex min-h-full flex-1 flex-col">
      <PublicSiteHeader />
      <div className="mx-auto w-full max-w-xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
        <h1 className="font-display text-4xl tracking-wide text-foreground sm:text-5xl">Nova senha</h1>
        <p className="mt-3 text-base leading-relaxed text-byla-muted">
          Digite o e-mail da conta para receber o link, ou abra o link que você já recebeu para
          criar uma senha nova.
        </p>
        <div className="mt-6 rounded-2xl border border-byla-border bg-byla-surface p-4 sm:p-6">
          <ResetPasswordForm />
        </div>
      </div>
    </main>
  );
}
