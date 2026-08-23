import { LoadingRegion, Skeleton } from '@/components/ui/skeleton';

export default function AuthLoading() {
  return (
    <LoadingRegion
      label="Carregando"
      className="flex min-h-screen items-center justify-center bg-app p-6"
    >
      <div className="flex w-full max-w-sm flex-col gap-4">
        <Skeleton className="h-9 w-2/3" />
        <Skeleton className="h-3 w-full" />
        <Skeleton className="mt-3 h-11 rounded-control" />
        <Skeleton className="h-11 rounded-control" />
        <Skeleton className="mt-2 h-11 rounded-control" />
      </div>
    </LoadingRegion>
  );
}
