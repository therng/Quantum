import { Activity, Clock, MonitorPlay, Server, Signal, Wallet } from "lucide-react";
import type { KeyboardEvent } from "react";
import type { Terminal } from "@shared/schema";
import { useTerminalCurve } from "@/hooks/use-terminals";
import { Sparkline } from "./Sparkline";

interface TerminalCardProps {
  terminal: Terminal;
  onClick: (id: string) => void;
}

export function TerminalCard({ terminal, onClick }: TerminalCardProps) {
  const { data: curveData, isLoading } = useTerminalCurve(terminal.id);

  const growthPercent = Number(terminal.growthPercent ?? 0);
  const equity = Number(terminal.equity ?? 0);
  const balance = Number(terminal.balance ?? 0);
  const uptime = Number(terminal.uptimeHours ?? 0);

  const isProfitable = growthPercent >= 0;
  const growthColor = isProfitable ? "text-emerald-300" : "text-rose-300";
  const sparklineColor = isProfitable ? "hsl(142, 70%, 55%)" : "hsl(350, 85%, 60%)";

  const heartbeatDate = terminal.lastHeartbeat ? new Date(String(terminal.lastHeartbeat)) : null;
  const heartbeatLabel = heartbeatDate && !Number.isNaN(heartbeatDate.getTime())
    ? heartbeatDate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : "N/A";

  const handleClick = () => onClick(terminal.id);
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onClick(terminal.id);
    }
  };

  return (
    <div
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      role="button"
      tabIndex={0}
      className="group relative flex h-full flex-col overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-b from-card/90 via-card/80 to-card/70 cursor-pointer transition-all duration-300 hover:-translate-y-1 hover:border-primary/40 hover:shadow-2xl hover:shadow-sky-500/10"
    >
      <div className={`pointer-events-none absolute -top-24 -right-20 h-44 w-44 rounded-full blur-3xl opacity-20 transition-opacity duration-500 group-hover:opacity-35 ${
        terminal.active ? "bg-emerald-500/40" : "bg-rose-500/40"
      }`} />

      <div className="relative z-10 p-5 pb-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground/80 mb-1">Terminal</p>
            <h3 className="font-mono text-2xl font-semibold tracking-tight text-foreground group-hover:text-sky-200 transition-colors">
              {terminal.login}
            </h3>
            <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
              <Server className="w-3.5 h-3.5" />
              {terminal.server}
            </p>
          </div>

          <div className="flex flex-col items-end gap-2">
            <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider border ${
              terminal.active
                ? "bg-emerald-500/10 border-emerald-400/30 text-emerald-200"
                : "bg-rose-500/10 border-rose-400/30 text-rose-200"
            }`}>
              <Signal className="w-3 h-3" />
              {terminal.active ? "Online" : "Offline"}
            </span>
            <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider border ${
              terminal.algoActive
                ? "bg-violet-500/10 border-violet-400/30 text-violet-200"
                : "bg-muted border-white/10 text-muted-foreground"
            }`}>
              <MonitorPlay className="w-3 h-3" />
              {terminal.algoActive ? "Algo Live" : "Algo Idle"}
            </span>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3">
          <div className="rounded-xl border border-white/10 bg-background/40 p-3">
            <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-1">Growth</p>
            <p className={`font-mono text-xl font-semibold ${growthColor}`}>
              {isProfitable ? "+" : ""}
              {growthPercent.toFixed(2)}%
            </p>
          </div>
          <div className="rounded-xl border border-white/10 bg-background/40 p-3">
            <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-1">Equity</p>
            <p className="font-mono text-lg font-semibold text-foreground">
              ${equity.toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </p>
          </div>
        </div>
      </div>

      <div className="relative z-10 mt-auto px-5 pb-4">
        <div className="h-[72px] overflow-hidden rounded-xl border border-white/10 bg-background/30">
          {isLoading ? (
            <div className="w-full h-full flex items-center justify-center">
              <div className="w-4/5 h-1 bg-muted/40 rounded-full overflow-hidden">
                <div className="h-full w-1/3 bg-primary/40 animate-[slide_1.4s_ease-in-out_infinite]" />
              </div>
            </div>
          ) : (
            <div className="translate-y-1 group-hover:translate-y-0 transition-transform duration-300">
              <Sparkline data={curveData || []} color={sparklineColor} height={70} />
            </div>
          )}
        </div>

        <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <Wallet className="w-3.5 h-3.5" />
            Balance ${balance.toLocaleString(undefined, { maximumFractionDigits: 0 })}
          </span>
          <span className="inline-flex items-center gap-1">
            <Clock className="w-3.5 h-3.5" />
            {uptime}h
          </span>
        </div>
        <div className="mt-1 flex items-center justify-between text-[11px] text-muted-foreground/80">
          <span className="inline-flex items-center gap-1">
            <Activity className="w-3.5 h-3.5" />
            Last heartbeat
          </span>
          <span className="font-mono">{heartbeatLabel}</span>
        </div>
      </div>
    </div>
  );
}
