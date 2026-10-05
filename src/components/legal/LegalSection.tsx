import type { ReactNode } from "react";

export function LegalSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="font-display text-2xl tracking-wide text-foreground">
        {title}
      </h2>
      <div className="mt-3 grid gap-3 text-base leading-relaxed text-byla-muted">
        {children}
      </div>
    </section>
  );
}

/** E-mail público de contato (env `PRIVACY_CONTACT_EMAIL`) ou, sem ele, um texto neutro. */
export function LegalContact() {
  const contactEmail = process.env.PRIVACY_CONTACT_EMAIL?.trim();
  return contactEmail ? (
    <a
      className="break-words font-medium text-byla-link underline underline-offset-2"
      href={`mailto:${contactEmail}`}
    >
      {contactEmail}
    </a>
  ) : (
    "os canais oficiais de atendimento do Espaço Byla"
  );
}
