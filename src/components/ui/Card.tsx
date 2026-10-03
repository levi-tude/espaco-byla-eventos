import type { HTMLAttributes } from "react";

import { cx } from "@/components/ui/cx";

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cx("rounded-2xl border border-byla-border bg-byla-surface p-4 sm:p-6", className)}
      {...props}
    />
  );
}
