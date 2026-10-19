import { LoadingRegion, Skeleton } from "@/components/ui/Skeleton";

export default function EventoEquipeLoading() {
  return (
    <main className="mx-auto w-full max-w-6xl px-4 pb-16 pt-2 sm:px-6 sm:pt-4">
      <LoadingRegion label="Carregando evento…">
        <Skeleton className="h-5 w-24" />
        <Skeleton className="mt-4 h-12 w-full max-w-2xl" />
        <Skeleton className="mt-4 h-20 w-full rounded-2xl" />
        <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <Skeleton className="h-80 w-full rounded-2xl" />
          <div className="grid gap-4">
            <Skeleton className="h-28 w-full rounded-2xl" />
            <Skeleton className="h-28 w-full rounded-2xl" />
          </div>
        </div>
      </LoadingRegion>
    </main>
  );
}
