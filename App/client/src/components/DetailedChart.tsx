import { useMemo } from "react";
import { format } from "date-fns";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Legend
} from "recharts";
import type { CurvePoint } from "@shared/schema";

interface DetailedChartProps {
  data: CurvePoint[];
}

export function DetailedChart({ data }: DetailedChartProps) {
  const chartData = useMemo(() => {
    // Ensure data is sorted by timestamp and map strings to Date objects for recharts
    return [...data].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()).map(d => ({
      ...d,
      time: new Date(d.timestamp).getTime(),
    }));
  }, [data]);

  if (!chartData || chartData.length === 0) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center text-muted-foreground bg-card/30 rounded-xl border border-white/5">
        <svg className="w-12 h-12 mb-4 opacity-20" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
        </svg>
        <p className="font-medium text-sm">Insufficient data</p>
        <p className="text-xs opacity-60 mt-1">Waiting for heartbeats...</p>
      </div>
    );
  }

  const equityColor = "hsl(142, 71%, 45%)"; // Emerald 500
  const balanceColor = "hsl(217, 91%, 60%)"; // Blue 500

  // Custom Tooltip
  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-card border border-white/10 shadow-2xl p-4 rounded-xl backdrop-blur-xl">
          <p className="text-muted-foreground text-xs font-mono mb-3">
            {format(new Date(label), "MMM d, yyyy HH:mm:ss")}
          </p>
          {payload.map((entry: any, index: number) => (
            <div key={index} className="flex items-center justify-between gap-6 mb-1">
              <span className="text-sm font-medium text-foreground/80 capitalize flex items-center gap-2">
                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: entry.color }} />
                {entry.name}
              </span>
              <span className="text-sm font-mono font-bold" style={{ color: entry.color }}>
                ${Number(entry.value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>
          ))}
        </div>
      );
    }
    return null;
  };

  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={chartData} margin={{ top: 10, right: 0, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="colorEquity" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={equityColor} stopOpacity={0.3} />
            <stop offset="95%" stopColor={equityColor} stopOpacity={0} />
          </linearGradient>
          <linearGradient id="colorBalance" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={balanceColor} stopOpacity={0.3} />
            <stop offset="95%" stopColor={balanceColor} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
        <XAxis 
          dataKey="time" 
          type="number"
          scale="time"
          domain={['dataMin', 'dataMax']}
          tickFormatter={(unixTime) => format(new Date(unixTime), "HH:mm")}
          stroke="hsl(var(--muted-foreground))"
          fontSize={12}
          tickMargin={12}
          axisLine={false}
          tickLine={false}
          minTickGap={60}
        />
        <YAxis 
          domain={['auto', 'auto']}
          tickFormatter={(value) => `$${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
          stroke="hsl(var(--muted-foreground))"
          fontSize={12}
          tickMargin={12}
          axisLine={false}
          tickLine={false}
          width={80}
        />
        <Tooltip content={<CustomTooltip />} cursor={{ stroke: 'hsl(var(--muted))', strokeWidth: 1, strokeDasharray: '4 4' }} />
        <Legend 
          verticalAlign="top" 
          height={36} 
          iconType="circle"
          wrapperStyle={{ fontSize: '13px', fontWeight: 500 }}
        />
        <Area
          type="monotone"
          dataKey="balance"
          name="Balance"
          stroke={balanceColor}
          strokeWidth={2}
          fillOpacity={1}
          fill="url(#colorBalance)"
          isAnimationActive={true}
        />
        <Area
          type="monotone"
          dataKey="equity"
          name="Equity"
          stroke={equityColor}
          strokeWidth={2}
          fillOpacity={1}
          fill="url(#colorEquity)"
          isAnimationActive={true}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
