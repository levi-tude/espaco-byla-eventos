import { LoadingRegion, Skeleton } from "@/components/ui/Skeleton";

export default function EventoOrganizadorLoading() {
  return (
    <main className="mx-auto w-full max-w-6xl px-4 pb-16 pt-2 sm:px-6 sm:pt-4">
      <LoadingRegion label="Carregando evento…">
        <Skeleton className="h-5 w-28" />
        <Skeleton className="mt-4 h-12 w-full max-w-xl" />
        <Skeleton className="mt-4 h-20 w-full rounded-2xl" />
        <Skeleton className="mt-4 h-24 w-full rounded-2xl" />
        <div className="mt-6 flex gap-2 overflow-hidden lg:hidden">
          {[0, 1, 2, 3].map((item) => (
            <Skeleton className="h-11 w-24 shrink-0 rounded-lg" key={item} />
          ))}
        </div>
        <div className="mt-6 grid gap-10 lg:grid-cols-[minmax(0,1fr)_24rem] lg:gap-8">
          <div>
            <Skeleton className="h-7 w-24" />
            <Skeleton className="mt-3 h-64 w-full rounded-2xl" />
            <Skeleton className="mt-6 h-40 w-full rounded-2xl" />
          </div>
          <div className="hidden gap-6 lg:grid">
            <Skeleton className="h-32 w-full rounded-2xl" />
            <Skeleton className="h-28 w-full rounded-2xl" />
          </div>
        </div>
      </LoadingRegion>
    </main>
  );
}
