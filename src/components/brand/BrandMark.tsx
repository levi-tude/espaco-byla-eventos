"use client";

import Image from "next/image";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

type Props = {
  size?: number;
  className?: string;
  /** Força logo clara (ex.: sobre hero escuro) */
  forceDark?: boolean;
};

/** Logo adaptativa: flor clara no escuro; marca amarelo/azul no claro. */
export function BrandMark({ size = 36, className, forceDark = false }: Props) {
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const dark = forceDark || !mounted || resolvedTheme === "dark";
  const src = dark ? "/brand/flower-white.png" : "/brand/mark-yellow-blue.png";

  return (
    <Image
      alt=""
      className={className ?? "object-contain"}
      height={size}
      src={src}
      style={{ width: size, height: size }}
      width={size}
      priority
    />
  );
}
