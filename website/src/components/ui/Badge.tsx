'use client';

import { cn } from '@/lib/utils';
import type { OrderStatus } from '@/lib/api-client';

type BadgeVariant = 'default' | 'success' | 'warning' | 'error' | 'info' | 'xmr' | 'ton';

interface BadgeProps {
  children: React.ReactNode;
  variant?: BadgeVariant;
  size?: 'sm' | 'md';
  dot?: boolean;
  pulse?: boolean;
  className?: string;
}

const variantStyles: Record<BadgeVariant, string> = {
  default: 'bg-gray-500/10 text-gray-400 border-gray-500/20',
  success: 'bg-green-500/10 text-green-400 border-green-500/20',
  warning: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
  error: 'bg-red-500/10 text-red-400 border-red-500/20',
  info: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  xmr: 'bg-xmr-500/10 text-xmr-400 border-xmr-500/20',
  ton: 'bg-ton-500/10 text-ton-400 border-ton-500/20',
};

const dotColors: Record<BadgeVariant, string> = {
  default: 'bg-gray-400',
  success: 'bg-green-400',
  warning: 'bg-yellow-400',
  error: 'bg-red-400',
  info: 'bg-blue-400',
  xmr: 'bg-xmr-400',
  ton: 'bg-ton-400',
};

export function Badge({
  children,
  variant = 'default',
  size = 'sm',
  dot = false,
  pulse = false,
  className,
}: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 font-medium border rounded-full',
        size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-3 py-1 text-sm',
        variantStyles[variant],
        className
      )}
    >
      {dot && (
        <span className="relative flex h-2 w-2">
          {pulse && (
            <span
              className={cn(
                'absolute inline-flex h-full w-full rounded-full opacity-75 animate-ping',
                dotColors[variant]
              )}
            />
          )}
          <span
            className={cn('relative inline-flex h-2 w-2 rounded-full', dotColors[variant])}
          />
        </span>
      )}
      {children}
    </span>
  );
}

const statusVariantMap: Record<OrderStatus, BadgeVariant> = {
  pending: 'default',
  awaiting_deposit: 'warning',
  confirming: 'info',
  exchanging: 'info',
  sending: 'info',
  completed: 'success',
  expired: 'error',
  failed: 'error',
  refunded: 'warning',
};

const statusLabels: Record<OrderStatus, string> = {
  pending: 'Pending',
  awaiting_deposit: 'Awaiting Deposit',
  confirming: 'Confirming',
  exchanging: 'Exchanging',
  sending: 'Sending',
  completed: 'Completed',
  expired: 'Expired',
  failed: 'Failed',
  refunded: 'Refunded',
};

export function StatusBadge({ status, size = 'sm' }: { status: OrderStatus; size?: 'sm' | 'md' }) {
  const isActive = ['awaiting_deposit', 'confirming', 'exchanging', 'sending'].includes(status);
  return (
    <Badge
      variant={statusVariantMap[status]}
      size={size}
      dot
      pulse={isActive}
    >
      {statusLabels[status]}
    </Badge>
  );
}

export default Badge;
