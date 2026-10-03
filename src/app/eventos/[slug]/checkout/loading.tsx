import { SiteHeader } from "@/components/brand/SiteHeader";
import { LoadingRegion, Skeleton } from "@/components/ui/Skeleton";

export default function CheckoutLoading() {
  return (
    <main className="relative flex min-h-full flex-1 flex-col pb-16">
      <SiteHeader />
      <div className="mx-auto w-full max-w-5xl flex-1 px-4 pt-2 sm:px-6 sm:pt-4">
        <LoadingRegion label="Carregando ingressos…">
          <Skeleton className="h-11 w-44" />
          <Skeleton className="mt-3 h-4 w-32" />
          <Skeleton className="mt-2 h-10 w-3/4" />
          <div className="mt-6 lg:grid lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-10">
            <div>
              <Skeleton className="h-7 w-56" />
              <Skeleton className="mt-3 h-64 rounded-2xl" />
              <Skeleton className="mt-8 h-7 w-40" />
              <Skeleton className="mt-3 h-12" />
              <Skeleton className="mt-4 h-12" />
            </div>
            <Skeleton className="mt-6 hidden h-64 rounded-2xl lg:mt-0 lg:block" />
          </div>
        </LoadingRegion>
      </div>
    </main>
  );
}
