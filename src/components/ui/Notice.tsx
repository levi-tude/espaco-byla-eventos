import { CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";

import { cx } from "@/components/ui/cx";
import { TONE_CLASSES, type Tone } from "@/components/ui/tone";

const ICONS: Record<Tone, typeof Info> = {
  success: CircleCheck,
  warning: TriangleAlert,
  danger: CircleAlert,
  info: Info,
  neutral: Info,
};

type NoticeProps = {
  tone?: Tone;
  title?: ReactNode;
  className?: string;
  children?: ReactNode;
  /** Use `false` quando o aviso já estiver na página desde o início e não precisar ser anunciado. */
  live?: boolean;
};

export function Notice({ tone = "info", title, className, children, live = true }: NoticeProps) {
  const Icon = ICONS[tone];
  const role = !live ? undefined : tone === "danger" ? "alert" : "status";

  return (
    <div
      className={cx("flex gap-3 rounded-xl border p-4 text-base", TONE_CLASSES[tone], className)}
      role={role}
    >
      <Icon aria-hidden className="mt-0.5 h-5 w-5 shrink-0" />
      <div className="min-w-0 flex-1">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children ? <div className={cx(Boolean(title) && "mt-1", "text-foreground")}>{children}</div> : null}
      </div>
    </div>
  );
}
