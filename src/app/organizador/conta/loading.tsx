import { LoadingRegion, Skeleton } from "@/components/ui/Skeleton";

export default function ContaOrganizadorLoading() {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-16 pt-2 sm:px-6 sm:pt-4">
      <LoadingRegion label="Carregando conta…">
        <Skeleton className="h-10 w-40" />
        <Skeleton className="mt-6 h-48 w-full rounded-2xl" />
        <Skeleton className="mt-6 h-36 w-full rounded-2xl" />
        <Skeleton className="mt-6 h-32 w-full rounded-2xl" />
      </LoadingRegion>
    </main>
  );
}
