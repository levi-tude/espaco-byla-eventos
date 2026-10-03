import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { cx } from "@/components/ui/cx";

type BackLinkProps = {
  href: string;
  children: ReactNode;
  className?: string;
};

export function BackLink({ href, children, className }: BackLinkProps) {
  return (
    <Link
      className={cx(
        "-ml-2 inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-base text-byla-muted no-underline transition hover:text-foreground",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-byla-blue",
        className,
      )}
      href={href}
    >
      <ArrowLeft aria-hidden className="h-4 w-4" />
      {children}
    </Link>
  );
}
