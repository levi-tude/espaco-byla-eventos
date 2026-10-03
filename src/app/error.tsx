"use client";

import { SiteHeader } from "@/components/brand/SiteHeader";
import { ErrorScreen } from "@/components/ui/ErrorScreen";

export default function Error({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <div className="flex flex-1 flex-col">
      <SiteHeader />
      <ErrorScreen error={error} homeHref="/" homeLabel="Ver programação" retry={retry} />
    </div>
  );
}
