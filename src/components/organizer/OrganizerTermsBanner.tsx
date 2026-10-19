"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { acceptOrganizerTermsAction } from "@/app/organizador/conta/actions";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Notice";
import { ORGANIZER_TERMS_PATH } from "@/lib/legal/organizer-terms";

/** Aviso de reaceite obrigatório quando a versão dos Termos do organizador muda. */
export function OrganizerTermsBanner() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function accept() {
    setBusy(true);
    setError("");
    const result = await acceptOrganizerTermsAction();
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    router.refresh();
  }

  return (
    <Notice className="mx-auto mt-4 max-w-6xl px-4 sm:px-6" tone="warning">
      <p className="font-semibold text-foreground">Termos do organizador atualizados</p>
      <p className="mt-1 text-base">
        Leia a nova versão e aceite para criar, editar ou enviar eventos.{" "}
        <Link
          className="font-medium text-byla-link underline underline-offset-2"
          href={ORGANIZER_TERMS_PATH}
          rel="noopener"
          target="_blank"
        >
          Abrir Termos do organizador
        </Link>
      </p>
      {error ? <p className="mt-2 text-sm text-byla-warning">{error}</p> : null}
      <Button className="mt-3" disabled={busy} onClick={accept}>
        {busy ? "Registrando…" : "Li e aceito a nova versão"}
      </Button>
    </Notice>
  );
}
