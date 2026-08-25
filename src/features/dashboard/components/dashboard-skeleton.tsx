export function DashboardSkeleton() {
  return (
    <div className="flex flex-col animate-pulse">
      {/* Header Skeleton */}
      <div className="flex flex-col gap-4 border-b border-line bg-surface px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-2">
          <div className="h-6 w-40 rounded-md bg-line-soft" />
          <div className="h-4 w-64 rounded-md bg-line-soft" />
        </div>
        <div className="flex gap-2">
          <div className="h-9 w-48 rounded-xl bg-line-soft" />
          <div className="h-9 w-24 rounded-xl bg-line-soft" />
        </div>
      </div>

      <div className="flex flex-col gap-6 p-4 sm:p-6">
        {/* KPI Grid Skeleton */}
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-28 rounded-2xl border border-line bg-surface p-4" />
          ))}
        </div>

        {/* Shortcuts Skeleton */}
        <div className="h-20 rounded-2xl border border-line bg-surface p-4" />

        {/* Charts & Attention Panel Skeleton */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="h-80 rounded-2xl border border-line bg-surface p-5 lg:col-span-2" />
          <div className="h-80 rounded-2xl border border-line bg-surface p-5" />
        </div>

        {/* Bottom 3 Cards Skeleton */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="h-72 rounded-2xl border border-line bg-surface p-5" />
          <div className="h-72 rounded-2xl border border-line bg-surface p-5" />
          <div className="h-72 rounded-2xl border border-line bg-surface p-5" />
        </div>
      </div>
    </div>
  );
}
