import type { ReactNode } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { signOutOrganizerAction } from "@/app/organizador/verificar/actions";
import { BrandMark } from "@/components/brand/BrandMark";
import { ThemeToggle } from "@/components/brand/ThemeToggle";
import { OrganizerTermsBanner } from "@/components/organizer/OrganizerTermsBanner";
import { buttonClasses } from "@/components/ui/Button";
import { AREAS } from "@/lib/auth/area";
import { getActor } from "@/lib/auth/actor";
import { readLoginState } from "@/lib/auth/login-verification";
import { organizerNeedsTermsAcceptance } from "@/lib/organizer/terms-gate";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

const LINKS = [
  { href: "/organizador", label: "Meus eventos" },
  { href: "/organizador/conta", label: "Minha conta" },
];

export default async function OrganizadorLayout({ children }: { children: ReactNode }) {
  const { login, verify } = AREAS.organizador;
  const pathname = (await headers()).get("x-pathname");

  if (pathname === login || pathname === verify) {
    return children;
  }

  const state = await readLoginState(await createServerClient(), "organizador");
  if (state.status === "pendente") redirect(verify);
  if (state.status !== "verificado") redirect(login);

  let needsTerms = false;
  try {
    const actor = await getActor();
    if (actor?.kind === "organizador") {
      needsTerms = await organizerNeedsTermsAcceptance(createAdminClient(), actor.userId);
    }
  } catch (error) {
    // Não derruba a área inteira por falha ao ler o status dos termos.
    console.error("[organizador] Falha ao montar o aviso de termos.", error);
    needsTerms = false;
  }

  return (
    <div className="min-h-screen bg-byla-bg text-foreground">
      <header className="border-b border-byla-border bg-byla-surface">
        <div className="mx-auto grid max-w-6xl grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 px-4 py-2 sm:gap-x-4 sm:px-6 sm:py-3">
          <div className="flex min-w-0 items-center gap-2 sm:gap-3">
            <BrandMark size={32} />
            <p className="truncate font-display text-lg tracking-wide text-foreground">
              ACDH Eventos
            </p>
          </div>

          {/* No celular o menu ocupa a linha de baixo inteira para não apertar "Sair". */}
          <nav
            aria-label="Navegação do organizador"
            className="col-span-2 row-start-2 flex gap-x-3 sm:col-span-1 sm:pl-11"
          >
            {LINKS.map((link) => (
              <Link
                aria-current={pathname === link.href ? "page" : undefined}
                className="-ml-1 inline-flex min-h-11 items-center whitespace-nowrap rounded-lg px-1 text-base text-byla-muted transition hover:text-byla-link focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-byla-blue aria-[current=page]:font-semibold aria-[current=page]:text-foreground"
                href={link.href}
                key={link.href}
              >
                {link.label}
              </Link>
            ))}
          </nav>

          <div className="col-start-2 row-start-1 flex shrink-0 items-center gap-2 sm:row-span-2">
            <ThemeToggle />
            <form action={signOutOrganizerAction}>
              <button className={buttonClasses({ variant: "secondary" })} type="submit">
                Sair
              </button>
            </form>
          </div>
        </div>
      </header>

      {needsTerms ? <OrganizerTermsBanner /> : null}
      {children}
    </div>
  );
}
