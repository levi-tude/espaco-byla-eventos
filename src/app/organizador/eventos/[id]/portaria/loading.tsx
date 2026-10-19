import { LoadingRegion, Skeleton } from "@/components/ui/Skeleton";

export default function PortariaOrganizadorLoading() {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-16 pt-2 sm:px-6 sm:pt-4">
      <LoadingRegion label="Carregando portaria…">
        <Skeleton className="h-5 w-28" />
        <Skeleton className="mt-4 h-8 w-56" />
        <Skeleton className="mt-6 h-12 w-full rounded-xl" />
        <Skeleton className="mt-8 aspect-square w-full max-w-md rounded-2xl" />
      </LoadingRegion>
    </main>
  );
}
