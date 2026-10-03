import { SiteHeader } from "@/components/brand/SiteHeader";
import { LoadingRegion, Skeleton } from "@/components/ui/Skeleton";

export default function EventoLoading() {
  return (
    <main className="relative flex min-h-full flex-1 flex-col pb-16">
      <SiteHeader />
      <div className="mx-auto w-full max-w-6xl flex-1 px-4 pt-2 sm:px-6 sm:pt-4">
        <LoadingRegion label="Carregando evento…">
          <Skeleton className="h-11 w-40" />
          <div className="mt-2 lg:grid lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-x-10">
            <div>
              <Skeleton className="-mx-4 aspect-video rounded-none sm:mx-0 sm:rounded-2xl" />
              <Skeleton className="mt-6 h-5 w-56" />
              <Skeleton className="mt-3 h-10 w-3/4" />
              <Skeleton className="mt-3 h-5 w-40" />
            </div>
            <Skeleton className="mt-6 h-56 rounded-2xl lg:mt-0" />
          </div>
        </LoadingRegion>
      </div>
    </main>
  );
}
