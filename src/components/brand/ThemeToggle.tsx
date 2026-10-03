"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";

import { useMounted } from "@/lib/use-mounted";

type Props = {
  /** Botão sobre hero escuro */
  onMedia?: boolean;
};

export function ThemeToggle({ onMedia = false }: Props) {
  const { resolvedTheme, setTheme } = useTheme();
  const mounted = useMounted();
  const isDark = mounted && resolvedTheme === "dark";

  return (
    <button
      aria-label={
        !mounted
          ? "Alternar tema"
          : isDark
            ? "Ativar tema claro"
            : "Ativar tema escuro"
      }
      className={
        onMedia
          ? "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-white/35 bg-black/35 text-white backdrop-blur transition hover:bg-black/55 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          : "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-byla-border bg-byla-surface text-foreground transition hover:border-byla-link/50 hover:text-byla-link focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-byla-blue"
      }
      disabled={!mounted}
      onClick={() => setTheme(isDark ? "light" : "dark")}
      type="button"
    >
      {isDark ? (
        <Sun aria-hidden className="h-5 w-5" />
      ) : (
        <Moon aria-hidden className="h-5 w-5" />
      )}
    </button>
  );
}
