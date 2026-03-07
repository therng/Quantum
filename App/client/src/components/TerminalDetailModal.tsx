import { 
  Dialog, 
  DialogContent, 
  DialogTitle,
  DialogDescription
} from "@/components/ui/dialog";
import { useTerminal, useTerminalCurve, useTerminalGrowth } from "@/hooks/use-terminals";
import { DetailedChart } from "./DetailedChart";
import { 
  Activity, 
  Clock, 
  DollarSign, 
  Gauge, 
  TrendingUp, 
  Server,
  Zap
} from "lucide-react";
import { format } from "date-fns";

interface TerminalDetailModalProps {
  id: string | null;
  onClose: () => void;
}

export function TerminalDetailModal({ id, onClose }: TerminalDetailModalProps) {
  const { data: terminal, isLoading: isTerminalLoading } = useTerminal(id || "");
  const { data: curve, isLoading: isCurveLoading } = useTerminalCurve(id || "");
  const { data: growth, isLoading: isGrowthLoading } = useTerminalGrowth(id || "");

  const isOpen = !!id;

  if (!isOpen) return null;

  const growthPercent = Number(terminal?.growthPercent ?? 0);
  const isProfitable = growthPercent >= 0;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[900px] bg-background border-white/10 p-0 overflow-hidden shadow-2xl glass-panel">
        
        {isTerminalLoading ? (
          <div className="h-[600px] flex flex-col items-center justify-center space-y-4">
            <div className="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
            <p className="text-muted-foreground font-mono text-sm animate-pulse">Establishing connection...</p>
          </div>
        ) : !terminal ? (
          <div className="h-[400px] flex flex-col items-center justify-center space-y-4 text-center px-6">
            <div className="w-16 h-16 bg-destructive/10 rounded-full flex items-center justify-center mb-2">
              <Zap className="w-8 h-8 text-destructive" />
            </div>
            <DialogTitle className="text-xl">Signal Lost</DialogTitle>
            <DialogDescription className="text-base text-muted-foreground">
              We couldn't retrieve the details for this terminal. It may have been disconnected or removed.
            </DialogDescription>
          </div>
        ) : (
          <div className="flex flex-col h-[85vh] max-h-[800px]">
            {/* Header */}
            <div className="px-8 py-6 border-b border-white/5 bg-card/50 flex flex-col sm:flex-row sm:items-start justify-between gap-4">
              <div>
                <DialogTitle className="flex items-center gap-3 text-2xl mb-1">
                  <span className="font-mono text-primary text-3xl tracking-tight">{terminal.login}</span>
                  <div className={`px-2.5 py-1 rounded-md text-xs font-bold font-mono tracking-wider border flex items-center gap-1.5 ${
                    terminal.algoActive 
                      ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" 
                      : "bg-muted text-muted-foreground border-white/5"
                  }`}>
                    {terminal.algoActive && <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />}
                    {terminal.algoActive ? "ALGO ONLINE" : "ALGO STANDBY"}
                  </div>
                </DialogTitle>
                <DialogDescription className="flex items-center gap-2 text-muted-foreground text-sm font-mono mt-2">
                  <Server className="w-4 h-4" />
                  {terminal.server}
                  <span className="mx-2 opacity-30">•</span>
                  <span className="flex items-center gap-1.5">
                    <div className={`w-2 h-2 rounded-full ${terminal.active ? 'bg-emerald-500' : 'bg-destructive'}`} />
                    {terminal.active ? 'Connected' : 'Offline'}
                  </span>
                </DialogDescription>
              </div>

              <div className="text-left sm:text-right">
                <p className="text-sm text-muted-foreground font-medium mb-1">Total Growth</p>
                <p className={`text-4xl font-mono font-bold tracking-tight ${isProfitable ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {isProfitable ? '+' : ''}{growthPercent.toFixed(2)}%
                </p>
              </div>
            </div>

            {growth && (
              <div className="px-8 py-4 border-b border-white/5 bg-background/20 grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="rounded-xl border border-white/10 bg-card/70 p-3">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Endpoint Growth</p>
                  <p className={`mt-1 text-lg font-mono font-semibold ${(growth.latest_growth_pct ?? 0) >= 0 ? "text-emerald-300" : "text-rose-300"}`}>
                    {(growth.latest_growth_pct ?? 0) >= 0 ? "+" : ""}
                    {(growth.latest_growth_pct ?? 0).toFixed(2)}%
                  </p>
                </div>
                <div className="rounded-xl border border-white/10 bg-card/70 p-3">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Current Value</p>
                  <p className="mt-1 text-lg font-mono font-semibold text-foreground">
                    ${Number(growth.latest_value ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                  </p>
                </div>
                <div className="rounded-xl border border-white/10 bg-card/70 p-3">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Points</p>
                  <p className="mt-1 text-lg font-mono font-semibold text-foreground">{growth.points.length}</p>
                </div>
              </div>
            )}

            {/* Chart Area */}
            <div className="flex-1 p-6 sm:p-8 min-h-[300px] bg-gradient-to-b from-transparent to-card/20 relative">
              {isCurveLoading ? (
                <div className="w-full h-full flex flex-col items-center justify-center">
                  <Activity className="w-8 h-8 text-primary/30 animate-pulse mb-3" />
                  <p className="text-muted-foreground font-mono text-sm">Aggregating ticks...</p>
                </div>
              ) : (
                <DetailedChart data={curve || []} />
              )}
            </div>

            {/* Stats Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-y sm:divide-y-0 divide-white/5 border-t border-white/5 bg-card/80">
              
              <div className="p-6 flex flex-col justify-center">
                <div className="flex items-center gap-2 text-muted-foreground mb-2">
                  <DollarSign className="w-4 h-4" />
                  <span className="text-sm font-medium">Balance</span>
                </div>
                <p className="text-2xl font-mono font-bold text-foreground">
                  ${Number(terminal.balance ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </p>
              </div>

              <div className="p-6 flex flex-col justify-center">
                <div className="flex items-center gap-2 text-muted-foreground mb-2">
                  <TrendingUp className="w-4 h-4" />
                  <span className="text-sm font-medium">Equity</span>
                </div>
                <p className={`text-2xl font-mono font-bold ${Number(terminal.equity ?? 0) < Number(terminal.balance ?? 0) ? 'text-rose-400' : 'text-emerald-400'}`}>
                  ${Number(terminal.equity ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </p>
              </div>

              <div className="p-6 flex flex-col justify-center">
                <div className="flex items-center gap-2 text-muted-foreground mb-2">
                  <Clock className="w-4 h-4" />
                  <span className="text-sm font-medium">Uptime</span>
                </div>
                <p className="text-2xl font-mono font-bold text-foreground">
                  {Number(terminal.uptimeHours ?? 0)} <span className="text-base text-muted-foreground">hrs</span>
                </p>
              </div>

              <div className="p-6 flex flex-col justify-center">
                <div className="flex items-center gap-2 text-muted-foreground mb-2">
                  <Gauge className="w-4 h-4" />
                  <span className="text-sm font-medium">{isGrowthLoading ? "Growth Feed" : "Last Heartbeat"}</span>
                </div>
                <p className="text-lg font-mono font-semibold text-foreground/90 truncate" title={terminal.lastHeartbeat ? format(new Date(terminal.lastHeartbeat), "yyyy-MM-dd HH:mm:ss") : "N/A"}>
                  {isGrowthLoading
                    ? "Syncing..."
                    : terminal.lastHeartbeat
                      ? format(new Date(terminal.lastHeartbeat), "HH:mm:ss")
                      : "N/A"}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {terminal.lastHeartbeat ? format(new Date(terminal.lastHeartbeat), "MMM d, yyyy") : ""}
                </p>
              </div>

            </div>

          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
