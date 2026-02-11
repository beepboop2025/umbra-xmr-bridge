'use client';

import { AreaChart, Area, ResponsiveContainer } from 'recharts';

interface SparklineChartProps {
  data: number[];
  color?: string;
  height?: number;
  positive?: boolean;
}

export function SparklineChart({
  data,
  color,
  height = 32,
  positive = true,
}: SparklineChartProps) {
  const chartColor = color || (positive ? '#22c55e' : '#ef4444');
  const chartData = data.map((value, index) => ({ index, value }));

  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={chartData} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
          <defs>
            <linearGradient id={`spark-${chartColor.replace('#', '')}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={chartColor} stopOpacity={0.3} />
              <stop offset="100%" stopColor={chartColor} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area
            type="monotone"
            dataKey="value"
            stroke={chartColor}
            strokeWidth={1.5}
            fill={`url(#spark-${chartColor.replace('#', '')})`}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export default SparklineChart;
