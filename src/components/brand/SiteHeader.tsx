import Link from "next/link";

import { BrandMark } from "@/components/brand/BrandMark";
import { ThemeToggle } from "@/components/brand/ThemeToggle";
import { buttonClasses } from "@/components/ui/Button";

type Props = {
  variant?: "public" | "equipe";
  /** Hero sobre imagem escura: texto sempre claro */
  onMedia?: boolean;
  /**
   * Destino do botão "Área do organizador". Em páginas servidor, use
   * `PublicSiteHeader` (resolve sozinho). Em error/loading, omita.
   */
  organizerHref?: string | null;
};

/** Cabeçalho síncrono (error.tsx, loading). Sem botão de organizador se `organizerHref` omitido. */
export function SiteHeader({ variant = "public", onMedia = false, organizerHref = null }: Props) {
  const organizerLinkClass = onMedia
    ? buttonClasses({
        variant: "secondary",
        className:
          "shrink-0 border-white/40 bg-black/30 text-white hover:border-white/70 hover:bg-black/45 hover:text-white",
      })
    : buttonClasses({ variant: "secondary", className: "shrink-0" });

  return (
    <header
      className={
        onMedia
          ? "absolute inset-x-0 top-0 z-20 border-b border-transparent bg-gradient-to-b from-black/70 to-transparent"
          : "border-b border-byla-border bg-byla-bg/95 backdrop-blur"
      }
    >
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-2 px-4 py-2 sm:gap-3 sm:px-6 sm:py-3">
        <Link
          className={`flex min-h-11 min-w-0 items-center gap-2 rounded-lg no-underline sm:gap-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-byla-blue ${
            onMedia ? "text-white" : "text-foreground"
          }`}
          href={variant === "equipe" ? "/equipe" : "/"}
        >
          <BrandMark forceDark={onMedia} size={36} />
          <span
            className={`truncate font-display text-lg tracking-wide sm:text-xl ${
              onMedia ? "text-white" : "text-foreground"
            }`}
          >
            ACDH Eventos
          </span>
        </Link>
        <div className="flex shrink-0 items-center gap-2">
          {variant === "public" && organizerHref ? (
            <Link className={organizerLinkClass} href={organizerHref}>
              <span className="sm:hidden">Organizador</span>
              <span className="hidden sm:inline">Área do organizador</span>
            </Link>
          ) : null}
          <ThemeToggle onMedia={onMedia} />
        </div>
      </div>
    </header>
  );
}
