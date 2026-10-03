"use client";

import { ErrorScreen } from "@/components/ui/ErrorScreen";

export default function Error({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return <ErrorScreen error={error} homeHref="/equipe" homeLabel="Voltar para eventos" retry={retry} />;
}
