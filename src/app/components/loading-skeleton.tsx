/**
 * Reusable loading skeleton patterns for consistent UI.
 */
import { Skeleton } from "./ui/skeleton";
import { Card, CardContent, CardHeader } from "./ui/card";

/** Stats grid skeleton — 4 cards */
export function StatsGridSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className={`grid gap-4 sm:grid-cols-2 lg:grid-cols-${count}`}>
      {Array.from({ length: count }).map((_, i) => (
        <Card key={i}>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-4 rounded" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-8 w-16 mb-1.5" />
            <Skeleton className="h-3 w-32" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

/** Chart skeleton */
export function ChartSkeleton({ height = "h-64" }: { height?: string }) {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-3 w-56 mt-1" />
      </CardHeader>
      <CardContent>
        <div className={`${height} flex items-end gap-2 px-4`}>
          {Array.from({ length: 12 }).map((_, i) => (
            <Skeleton
              key={i}
              className="flex-1 rounded-t"
              style={{ height: `${20 + Math.random() * 60}%` }}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

/** Table/list skeleton */
export function ListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <Card key={i}>
          <CardContent className="flex items-center gap-3 p-3">
            <Skeleton className="h-11 w-11 rounded-lg shrink-0" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-48" />
            </div>
            <Skeleton className="h-6 w-16 rounded-full" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

/** Dashboard page skeleton */
export function DashboardSkeleton() {
  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Skeleton className="h-7 w-40 mb-2" />
          <Skeleton className="h-4 w-64" />
        </div>
        <Skeleton className="h-6 w-20 rounded-full" />
      </div>
      <Card>
        <CardContent className="flex items-center gap-6 p-5">
          <Skeleton className="h-12 w-12 rounded-xl" />
          <div className="flex-1">
            <Skeleton className="h-5 w-48 mb-2" />
            <Skeleton className="h-3 w-32" />
          </div>
        </CardContent>
      </Card>
      <StatsGridSkeleton />
      <ChartSkeleton />
    </div>
  );
}

/** Reports page skeleton */
export function ReportsSkeleton() {
  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <Skeleton className="h-7 w-56 mb-2" />
        <Skeleton className="h-4 w-72" />
      </div>
      <StatsGridSkeleton />
      <div className="grid gap-6 lg:grid-cols-2">
        <ChartSkeleton />
        <ChartSkeleton />
      </div>
      <ChartSkeleton height="h-48" />
    </div>
  );
}

/** Queue page skeleton */
export function QueueSkeleton() {
  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Skeleton className="h-7 w-32 mb-2" />
          <Skeleton className="h-4 w-48" />
        </div>
        <Skeleton className="h-6 w-20 rounded-full" />
      </div>
      <Card>
        <CardContent className="flex items-center gap-2 p-3">
          <Skeleton className="h-9 w-48 rounded-lg" />
          <Skeleton className="h-9 w-44 rounded-lg" />
          <div className="flex-1" />
          <Skeleton className="h-8 w-28 rounded-lg" />
        </CardContent>
      </Card>
      <div className="flex gap-2">
        <Skeleton className="h-10 w-36 rounded-lg" />
        <Skeleton className="h-10 w-36 rounded-lg" />
      </div>
      <ListSkeleton rows={4} />
    </div>
  );
}
