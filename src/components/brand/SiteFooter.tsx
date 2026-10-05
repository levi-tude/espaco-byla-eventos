import Link from "next/link";

import { COMPANY } from "@/lib/legal/privacy";
import { TERMS_PATH } from "@/lib/legal/terms";

const linkClass =
  "inline-flex min-h-11 items-center rounded-lg px-2 font-medium underline-offset-2 transition hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-byla-blue";

export function SiteFooter() {
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-byla-border bg-byla-bg">
      <div className="mx-auto flex w-full max-w-6xl flex-col items-center gap-1 px-4 py-5 text-center text-sm text-byla-muted sm:flex-row sm:justify-center sm:gap-3 sm:px-6">
        <p>
          © {year} {COMPANY.brand}. Todos os direitos reservados.
        </p>
        <span aria-hidden className="hidden sm:inline">
          ·
        </span>
        <nav aria-label="Informações legais" className="flex items-center gap-1">
          <Link className={linkClass} href={TERMS_PATH}>
            Termos de compra
          </Link>
          <span aria-hidden>·</span>
          <Link className={linkClass} href="/privacidade">
            Política de Privacidade
          </Link>
        </nav>
      </div>
    </footer>
  );
}
