'use client';

import { useState, type ReactNode } from 'react';
import { ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface Column<T> {
  key: string;
  header: string;
  sortable?: boolean;
  width?: string;
  align?: 'left' | 'center' | 'right';
  render: (row: T, index: number) => ReactNode;
}

interface TableProps<T> {
  data: T[];
  columns: Column<T>[];
  onSort?: (key: string, direction: 'asc' | 'desc') => void;
  onRowClick?: (row: T) => void;
  emptyMessage?: string;
  className?: string;
  compact?: boolean;
}

export function Table<T>({
  data,
  columns,
  onSort,
  onRowClick,
  emptyMessage = 'No data available',
  className,
  compact = false,
}: TableProps<T>) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');

  const handleSort = (key: string) => {
    const newDirection = sortKey === key && sortDirection === 'desc' ? 'asc' : 'desc';
    setSortKey(key);
    setSortDirection(newDirection);
    onSort?.(key, newDirection);
  };

  return (
    <div className={cn('overflow-x-auto', className)}>
      <table className="w-full">
        <thead>
          <tr className="border-b border-surface-border">
            {columns.map((col) => (
              <th
                key={col.key}
                className={cn(
                  'text-xs font-medium text-gray-400 uppercase tracking-wider',
                  compact ? 'px-3 py-2' : 'px-4 py-3',
                  col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : 'text-left',
                  col.sortable && 'cursor-pointer select-none hover:text-gray-200 transition-colors'
                )}
                style={{ width: col.width }}
                onClick={() => col.sortable && handleSort(col.key)}
              >
                <span className="inline-flex items-center gap-1">
                  {col.header}
                  {col.sortable && (
                    <span className="text-gray-600">
                      {sortKey === col.key ? (
                        sortDirection === 'asc' ? (
                          <ChevronUp size={14} />
                        ) : (
                          <ChevronDown size={14} />
                        )
                      ) : (
                        <ChevronsUpDown size={14} />
                      )}
                    </span>
                  )}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.length === 0 ? (
            <tr>
              <td
                colSpan={columns.length}
                className="text-center text-gray-500 py-12"
              >
                {emptyMessage}
              </td>
            </tr>
          ) : (
            data.map((row, index) => (
              <tr
                key={index}
                className={cn(
                  'border-b border-surface-border/50 transition-colors',
                  onRowClick && 'cursor-pointer hover:bg-surface-elevated'
                )}
                onClick={() => onRowClick?.(row)}
              >
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={cn(
                      compact ? 'px-3 py-2' : 'px-4 py-3',
                      col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : 'text-left'
                    )}
                  >
                    {col.render(row, index)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

interface PaginationProps {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}

export function Pagination({ currentPage, totalPages, onPageChange }: PaginationProps) {
  if (totalPages <= 1) return null;

  const pages = [];
  const start = Math.max(1, currentPage - 2);
  const end = Math.min(totalPages, currentPage + 2);

  for (let i = start; i <= end; i++) {
    pages.push(i);
  }

  return (
    <div className="flex items-center justify-center gap-1 mt-4">
      <button
        onClick={() => onPageChange(currentPage - 1)}
        disabled={currentPage <= 1}
        className="px-3 py-1.5 text-sm rounded-lg text-gray-400 hover:text-white hover:bg-surface-elevated disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
      >
        Prev
      </button>
      {start > 1 && (
        <>
          <button
            onClick={() => onPageChange(1)}
            className="px-3 py-1.5 text-sm rounded-lg text-gray-400 hover:text-white hover:bg-surface-elevated transition-colors"
          >
            1
          </button>
          {start > 2 && <span className="px-2 text-gray-600">...</span>}
        </>
      )}
      {pages.map((page) => (
        <button
          key={page}
          onClick={() => onPageChange(page)}
          className={cn(
            'px-3 py-1.5 text-sm rounded-lg transition-colors',
            page === currentPage
              ? 'bg-xmr-500 text-white'
              : 'text-gray-400 hover:text-white hover:bg-surface-elevated'
          )}
        >
          {page}
        </button>
      ))}
      {end < totalPages && (
        <>
          {end < totalPages - 1 && <span className="px-2 text-gray-600">...</span>}
          <button
            onClick={() => onPageChange(totalPages)}
            className="px-3 py-1.5 text-sm rounded-lg text-gray-400 hover:text-white hover:bg-surface-elevated transition-colors"
          >
            {totalPages}
          </button>
        </>
      )}
      <button
        onClick={() => onPageChange(currentPage + 1)}
        disabled={currentPage >= totalPages}
        className="px-3 py-1.5 text-sm rounded-lg text-gray-400 hover:text-white hover:bg-surface-elevated disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
      >
        Next
      </button>
    </div>
  );
}

export default Table;
