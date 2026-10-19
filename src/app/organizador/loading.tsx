import { LoadingRegion, Skeleton } from "@/components/ui/Skeleton";

export default function OrganizadorLoading() {
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
      <LoadingRegion label="Carregando seus eventos…">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0 flex-1">
            <Skeleton className="h-10 w-48" />
            <Skeleton className="mt-2 h-5 w-full max-w-md" />
          </div>
          <Skeleton className="h-11 w-full max-w-xs rounded-xl sm:w-40" />
        </div>
        <Skeleton className="mt-6 h-16 w-full rounded-2xl" />
        <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((item) => (
            <li key={item}>
              <Skeleton className="aspect-[4/3] w-full rounded-2xl" />
              <Skeleton className="mt-3 h-6 w-3/4" />
              <Skeleton className="mt-2 h-4 w-1/2" />
            </li>
          ))}
        </ul>
      </LoadingRegion>
    </main>
  );
}
