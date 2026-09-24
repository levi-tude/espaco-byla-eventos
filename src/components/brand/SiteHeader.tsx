import Link from "next/link";

import { BrandMark } from "@/components/brand/BrandMark";
import { ThemeToggle } from "@/components/brand/ThemeToggle";

type Props = {
  variant?: "public" | "equipe";
  /** Hero sobre imagem escura: texto sempre claro */
  onMedia?: boolean;
};

export function SiteHeader({ variant = "public", onMedia = false }: Props) {
  return (
    <header
      className={
        onMedia
          ? "absolute inset-x-0 top-0 z-20 border-b border-transparent bg-gradient-to-b from-black/70 to-transparent"
          : "border-b border-byla-border bg-byla-bg/95 backdrop-blur"
      }
    >
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-6 py-4">
        <Link
          className={`flex items-center gap-3 no-underline ${
            onMedia ? "text-white" : "text-foreground"
          }`}
          href={variant === "equipe" ? "/equipe" : "/"}
        >
          <BrandMark forceDark={onMedia} size={36} />
          <span
            className={`font-display text-lg tracking-wide sm:text-xl ${
              onMedia ? "text-white" : "text-foreground"
            }`}
          >
            Espaço Byla Eventos
          </span>
        </Link>
        <ThemeToggle onMedia={onMedia} />
      </div>
    </header>
  );
}
