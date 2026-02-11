'use client';

import { forwardRef, type SelectHTMLAttributes } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Option {
  value: string;
  label: string;
  disabled?: boolean;
}

interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  label?: string;
  error?: string;
  options: Option[];
  placeholder?: string;
  selectSize?: 'sm' | 'md' | 'lg';
}

const sizeClasses = {
  sm: 'h-8 text-xs pl-3 pr-8',
  md: 'h-11 text-sm pl-4 pr-10',
  lg: 'h-12 text-base pl-4 pr-10',
};

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, label, error, options, placeholder, selectSize = 'md', id, ...props }, ref) => {
    const selectId = id || label?.toLowerCase().replace(/\s+/g, '-');

    return (
      <div className="flex flex-col gap-1.5 w-full">
        {label && (
          <label htmlFor={selectId} className="text-sm font-medium text-gray-300">
            {label}
          </label>
        )}
        <div className="relative">
          <select
            ref={ref}
            id={selectId}
            className={cn(
              'w-full rounded-lg bg-surface-elevated border border-surface-border',
              'text-white appearance-none cursor-pointer',
              'transition-all duration-200',
              'focus:border-xmr-500/50 focus:ring-1 focus:ring-xmr-500/20 focus:outline-none',
              'disabled:opacity-50 disabled:cursor-not-allowed',
              sizeClasses[selectSize],
              error && 'border-red-500/50',
              className
            )}
            {...props}
          >
            {placeholder && (
              <option value="" disabled>
                {placeholder}
              </option>
            )}
            {options.map((opt) => (
              <option key={opt.value} value={opt.value} disabled={opt.disabled}>
                {opt.label}
              </option>
            ))}
          </select>
          <ChevronDown
            size={16}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none"
          />
        </div>
        {error && <p className="text-xs text-red-400">{error}</p>}
      </div>
    );
  }
);

Select.displayName = 'Select';
export default Select;
