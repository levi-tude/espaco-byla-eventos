"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

type Props = {
  /** Botão sobre hero escuro */
  onMedia?: boolean;
};

export function ThemeToggle({ onMedia = false }: Props) {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

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
          ? "inline-flex h-10 w-10 items-center justify-center rounded-lg border border-white/35 bg-black/35 text-white backdrop-blur transition hover:bg-black/55"
          : "inline-flex h-10 w-10 items-center justify-center rounded-lg border border-byla-border bg-byla-surface text-foreground transition hover:border-byla-blue/50 hover:text-byla-blue"
      }
      disabled={!mounted}
      onClick={() => setTheme(isDark ? "light" : "dark")}
      type="button"
    >
      {isDark ? (
        <Sun aria-hidden className="h-4 w-4" />
      ) : (
        <Moon aria-hidden className="h-4 w-4" />
      )}
    </button>
  );
}
