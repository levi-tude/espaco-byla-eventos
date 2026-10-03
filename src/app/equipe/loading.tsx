import { LoadingRegion, Skeleton } from "@/components/ui/Skeleton";

export default function EquipeLoading() {
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
      <LoadingRegion>
        <Skeleton className="h-10 w-48" />
        <Skeleton className="mt-3 h-5 w-full max-w-md" />
        <div className="mt-8 grid gap-3 lg:grid-cols-2">
          {[0, 1, 2].map((item) => (
            <Skeleton className="h-28 rounded-2xl" key={item} />
          ))}
        </div>
      </LoadingRegion>
    </main>
  );
}
