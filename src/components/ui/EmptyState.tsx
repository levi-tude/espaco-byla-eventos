import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cx } from "@/components/ui/cx";

type EmptyStateProps = {
  icon?: LucideIcon;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
};

export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cx(
        "flex flex-col items-center gap-2 rounded-2xl border border-dashed border-byla-border px-4 py-10 text-center",
        className,
      )}
    >
      {Icon ? <Icon aria-hidden className="h-8 w-8 text-byla-muted" /> : null}
      <p className="font-semibold text-foreground">{title}</p>
      {description ? <p className="max-w-sm text-byla-muted">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
