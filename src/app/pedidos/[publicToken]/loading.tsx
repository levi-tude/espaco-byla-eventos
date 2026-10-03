import { SiteHeader } from "@/components/brand/SiteHeader";
import { LoadingRegion, Skeleton } from "@/components/ui/Skeleton";

export default function PedidoLoading() {
  return (
    <main className="flex min-h-full flex-1 flex-col">
      <SiteHeader />
      <div className="mx-auto w-full max-w-2xl flex-1 px-4 pb-16 pt-2 sm:px-6 sm:pt-4">
        <LoadingRegion label="Carregando pedido…">
          <Skeleton className="h-11 w-32" />
          <Skeleton className="mt-6 h-4 w-28" />
          <Skeleton className="mt-3 h-10 w-3/4" />
          <Skeleton className="mt-3 h-14 w-full rounded-xl" />
          <Skeleton className="mt-5 h-80 w-full rounded-2xl" />
        </LoadingRegion>
      </div>
    </main>
  );
}
