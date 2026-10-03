import type { ReactNode } from "react";

import { cx } from "@/components/ui/cx";
import { TONE_CLASSES, type Tone } from "@/components/ui/tone";

type StatusBadgeProps = {
  tone?: Tone;
  className?: string;
  children: ReactNode;
};

export function StatusBadge({ tone = "neutral", className, children }: StatusBadgeProps) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-sm font-semibold",
        TONE_CLASSES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
