import { LoadingRegion, Skeleton } from "@/components/ui/Skeleton";

export default function RepassesLoading() {
  return (
    <main className="mx-auto w-full max-w-6xl px-4 pb-16 pt-2 sm:px-6 sm:pt-4">
      <LoadingRegion label="Carregando repasses…">
        <Skeleton className="h-10 w-40" />
        <Skeleton className="mt-4 h-5 w-full max-w-xl" />
        <Skeleton className="mt-6 h-12 w-full max-w-sm rounded-xl" />
        <div className="mt-8 grid gap-3">
          {[0, 1, 2, 3].map((item) => (
            <Skeleton className="h-16 w-full rounded-xl" key={item} />
          ))}
        </div>
      </LoadingRegion>
    </main>
  );
}
