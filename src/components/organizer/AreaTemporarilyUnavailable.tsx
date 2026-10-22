import { ReloadPageButton } from "@/components/organizer/ReloadPageButton";
import { ORGANIZER_AREA_TEMPORARILY_UNAVAILABLE_MESSAGE } from "@/lib/organizer/settings";

/** Corpo da página quando o banco não responde e não há cache (sem fingir 404). */
export function AreaTemporarilyUnavailable() {
  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col items-center px-4 py-16 text-center sm:px-6">
      <h1 className="font-display text-3xl tracking-wide text-foreground sm:text-4xl">
        Área indisponível
      </h1>
      <p className="mt-3 text-base leading-relaxed text-byla-muted">
        {ORGANIZER_AREA_TEMPORARILY_UNAVAILABLE_MESSAGE}
      </p>
      <div className="mt-8">
        <ReloadPageButton />
      </div>
    </div>
  );
}
