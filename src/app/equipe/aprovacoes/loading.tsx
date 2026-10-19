import { LoadingRegion, Skeleton } from "@/components/ui/Skeleton";

export default function AprovacoesLoading() {
  return (
    <main className="mx-auto w-full max-w-6xl px-4 pb-16 pt-2 sm:px-6 sm:pt-4">
      <LoadingRegion label="Carregando aprovações…">
        <Skeleton className="h-10 w-56" />
        <div className="mt-6 flex gap-2">
          {[0, 1, 2].map((item) => (
            <Skeleton className="h-11 w-28 rounded-lg" key={item} />
          ))}
        </div>
        <div className="mt-8 grid gap-4">
          {[0, 1, 2].map((item) => (
            <Skeleton className="h-36 w-full rounded-2xl" key={item} />
          ))}
        </div>
      </LoadingRegion>
    </main>
  );
}
