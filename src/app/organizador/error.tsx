"use client";

import { ErrorScreen } from "@/components/ui/ErrorScreen";

export default function OrganizerError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-dvh flex-1 flex-col bg-byla-bg">
      <ErrorScreen
        error={error}
        homeHref="/organizador"
        homeLabel="Voltar para meus eventos"
        retry={reset}
      />
    </div>
  );
}
