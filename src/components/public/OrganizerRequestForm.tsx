"use client";

import Link from "next/link";
import { type FormEvent, useState, useTransition } from "react";

import { submitOrganizerRequest } from "@/app/quero-fazer-meu-evento/actions";
import { useHumanCheck } from "@/components/public/HumanCheck";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { Field, TextAreaField } from "@/components/ui/Field";
import { Notice } from "@/components/ui/Notice";

const PRIVACY_REQUIRED_MESSAGE = "Marque que leu a Política de Privacidade.";

export function OrganizerRequestSent() {
  return (
    <Notice title="Recebemos!" tone="success">
      A equipe da ACDH Eventos vai falar com você pelo contato informado.
    </Notice>
  );
}

export function OrganizerRequestForm() {
  const humanCheck = useHumanCheck("org_request");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const data = new FormData(event.currentTarget);
    const field = (name: string) => String(data.get(name) ?? "");

    startTransition(async () => {
      try {
        const humanToken = await humanCheck.takeToken();
        const result = await submitOrganizerRequest({
          name: field("name"),
          contact: field("contact"),
          idea: field("idea"),
          approxDate: field("approxDate"),
          privacyAccepted: data.get("privacy") === "on",
          humanToken,
        });
        if (result.ok) setSent(true);
        else setError(result.error);
      } catch {
        setError("Não foi possível enviar seu pedido agora. Tente de novo em alguns minutos.");
      }
    });
  }

  if (sent) return <OrganizerRequestSent />;

  return (
    <form className="grid gap-4" onSubmit={submit}>
      <Field autoComplete="name" label="Nome" maxLength={120} minLength={2} name="name" required />
      <Field
        autoCapitalize="none"
        autoComplete="tel"
        hint="Seu WhatsApp com DDD ou seu e-mail."
        label="WhatsApp ou e-mail para contato"
        maxLength={160}
        minLength={5}
        name="contact"
        required
        spellCheck={false}
      />
      <TextAreaField
        hint="Que tipo de evento é, para quantas pessoas, o que você precisa."
        label="Ideia do evento"
        maxLength={1000}
        minLength={10}
        name="idea"
        required
        rows={5}
      />
      <Field
        autoComplete="off"
        hint="Ex.: dezembro de 2026"
        label="Data aproximada (opcional)"
        maxLength={60}
        name="approxDate"
      />
      <Checkbox
        name="privacy"
        onChange={(event) => event.currentTarget.setCustomValidity("")}
        onInvalid={(event) => event.currentTarget.setCustomValidity(PRIVACY_REQUIRED_MESSAGE)}
        required
      >
        Li a{" "}
        <Link
          className="font-medium text-byla-link underline underline-offset-2"
          href="/privacidade"
          rel="noopener"
          target="_blank"
        >
          Política de Privacidade
        </Link>
        .
      </Checkbox>
      {humanCheck.slot}
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <Button className="sm:w-auto" fullWidth loading={pending} loadingLabel="Enviando…" size="lg" type="submit">
        Enviar pedido
      </Button>
    </form>
  );
}
