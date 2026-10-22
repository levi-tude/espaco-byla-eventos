"use client";

import { Button } from "@/components/ui/Button";

export function ReloadPageButton({ label = "Recarregar" }: { label?: string }) {
  return (
    <Button onClick={() => window.location.reload()} size="lg" type="button">
      {label}
    </Button>
  );
}
