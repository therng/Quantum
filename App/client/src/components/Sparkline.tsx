import { useMemo } from "react";
import { Line, LineChart, ResponsiveContainer, YAxis } from "recharts";
import type { CurvePoint } from "@shared/schema";

interface SparklineProps {
  data: CurvePoint[];
  dataKey?: "equity" | "balance";
  color?: string;
  height?: number;
}

export function Sparkline({ 
  data, 
  dataKey = "equity", 
  color = "hsl(142, 71%, 45%)", // Default Emerald 500
  height = 60 
}: SparklineProps) {
  
  // Downsample data if too large for a tiny sparkline to ensure good performance
  const chartData = useMemo(() => {
    if (!data || data.length === 0) return [];
    if (data.length <= 50) return data;
    
    const step = Math.ceil(data.length / 50);
    return data.filter((_, i) => i % step === 0);
  }, [data]);

  if (!chartData || chartData.length === 0) {
    return (
      <div 
        className="w-full flex items-center justify-center text-muted-foreground/30 text-xs font-mono" 
        style={{ height }}
      >
        No curve data
      </div>
    );
  }

  // Calculate min/max to add a little padding to the chart bounds
  const minVal = Math.min(...chartData.map(d => d[dataKey]));
  const maxVal = Math.max(...chartData.map(d => d[dataKey]));
  const padding = (maxVal - minVal) * 0.1;

  return (
    <div className="w-full" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData}>
          <YAxis 
            domain={[minVal - padding, maxVal + padding]} 
            hide 
          />
          <Line
            type="monotone"
            dataKey={dataKey}
            stroke={color}
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
