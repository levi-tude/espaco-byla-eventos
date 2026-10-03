import type { ReactNode } from "react";

import { cx } from "@/components/ui/cx";

type StickyActionBarProps = {
  children: ReactNode;
  /** A partir de qual largura a barra some (quando a ação já aparece no corpo da página). */
  hideFrom?: "md" | "lg";
  className?: string;
};

/**
 * Barra fixa inferior para a ação principal no celular.
 * A página precisa reservar espaço embaixo (ex.: `pb-28`) para não esconder conteúdo.
 */
export function StickyActionBar({ children, hideFrom, className }: StickyActionBarProps) {
  return (
    <div
      className={cx(
        "fixed inset-x-0 bottom-0 z-30 border-t border-byla-border bg-byla-bg/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur",
        hideFrom === "md" && "md:hidden",
        hideFrom === "lg" && "lg:hidden",
        className,
      )}
    >
      <div className="mx-auto flex w-full max-w-3xl items-center gap-3">{children}</div>
    </div>
  );
}
