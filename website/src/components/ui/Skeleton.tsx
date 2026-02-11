'use client';

import { cn } from '@/lib/utils';

interface SkeletonProps {
  className?: string;
  width?: string | number;
  height?: string | number;
  rounded?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
}

export function Skeleton({ className, width, height, rounded = 'lg' }: SkeletonProps) {
  const roundedClass = {
    sm: 'rounded-sm',
    md: 'rounded-md',
    lg: 'rounded-lg',
    xl: 'rounded-xl',
    full: 'rounded-full',
  };

  return (
    <div
      className={cn('shimmer', roundedClass[rounded], className)}
      style={{ width, height }}
    />
  );
}

export function SkeletonCard() {
  return (
    <div className="rounded-xl border border-surface-border bg-surface-card p-5">
      <div className="flex items-center justify-between mb-4">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-4 w-12" />
      </div>
      <Skeleton className="h-8 w-32 mb-2" />
      <Skeleton className="h-3 w-20" />
    </div>
  );
}

export function SkeletonTable({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="rounded-xl border border-surface-border bg-surface-card overflow-hidden">
      <div className="border-b border-surface-border p-4 flex gap-4">
        {Array.from({ length: cols }).map((_, i) => (
          <Skeleton key={i} className="h-4 flex-1" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, ri) => (
        <div key={ri} className="border-b border-surface-border/50 p-4 flex gap-4">
          {Array.from({ length: cols }).map((_, ci) => (
            <Skeleton key={ci} className="h-4 flex-1" />
          ))}
        </div>
      ))}
    </div>
  );
}

export function SkeletonChart() {
  return (
    <div className="rounded-xl border border-surface-border bg-surface-card p-5">
      <div className="flex items-center justify-between mb-6">
        <Skeleton className="h-5 w-32" />
        <div className="flex gap-2">
          <Skeleton className="h-7 w-12" />
          <Skeleton className="h-7 w-12" />
          <Skeleton className="h-7 w-12" />
        </div>
      </div>
      <Skeleton className="h-48 w-full" rounded="xl" />
    </div>
  );
}

export default Skeleton;
