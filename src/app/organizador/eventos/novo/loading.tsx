import { LoadingRegion, Skeleton } from "@/components/ui/Skeleton";

export default function NovoEventoOrganizadorLoading() {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-16 pt-2 sm:px-6 sm:pt-4">
      <LoadingRegion label="Carregando formulário…">
        <Skeleton className="h-5 w-28" />
        <Skeleton className="mt-4 h-10 w-48" />
        <Skeleton className="mt-2 h-5 w-full max-w-lg" />
        <Skeleton className="mt-8 h-96 w-full rounded-2xl" />
      </LoadingRegion>
    </main>
  );
}
