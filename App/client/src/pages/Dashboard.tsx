import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { useBackendHealth, useSystemRealtime, useTerminals } from "@/hooks/use-terminals";
import { TerminalCard } from "@/components/TerminalCard";
import { TerminalDetailModal } from "@/components/TerminalDetailModal";
import { AlertTriangle, Bot, Cpu, Search, Server, Timer } from "lucide-react";
import type { Terminal } from "@shared/schema";

type StatusFilter = "all" | "active" | "offline" | "algo";
type SortBy = "recent" | "equity" | "growth" | "login";

export default function Dashboard() {
  const { data: terminals, isLoading, error, refetch } = useTerminals();
  const { data: health } = useBackendHealth();
  const { data: systemRealtime } = useSystemRealtime();
  const [selectedTerminalId, setSelectedTerminalId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sortBy, setSortBy] = useState<SortBy>("recent");

  const filteredTerminals = useMemo(() => {
    const termList = [...(terminals || [])];
    const searchQuery = search.trim().toLowerCase();

    const applyFilter = (terminal: Terminal) => {
      if (statusFilter === "active") return !!terminal.active;
      if (statusFilter === "offline") return !terminal.active;
      if (statusFilter === "algo") return !!terminal.algoActive;
      return true;
    };

    const applySearch = (terminal: Terminal) => {
      if (!searchQuery) return true;
      const loginText = String(terminal.login ?? "");
      const serverText = String(terminal.server ?? "").toLowerCase();
      const idText = String(terminal.id ?? "").toLowerCase();
      return loginText.includes(searchQuery) || serverText.includes(searchQuery) || idText.includes(searchQuery);
    };

    const toTimestamp = (value: unknown) => {
      if (!value) return 0;
      const parsed = new Date(String(value)).getTime();
      return Number.isFinite(parsed) ? parsed : 0;
    };

    const toNumber = (value: unknown) => {
      const parsed = Number(value ?? 0);
      return Number.isFinite(parsed) ? parsed : 0;
    };

    return termList
      .filter((terminal) => applyFilter(terminal) && applySearch(terminal))
      .sort((a, b) => {
        if (sortBy === "equity") return toNumber(b.equity) - toNumber(a.equity);
        if (sortBy === "growth") return toNumber(b.growthPercent) - toNumber(a.growthPercent);
        if (sortBy === "login") return toNumber(a.login) - toNumber(b.login);
        return toTimestamp(b.lastHeartbeat) - toTimestamp(a.lastHeartbeat);
      });
  }, [terminals, search, statusFilter, sortBy]);

  const stats = useMemo(() => {
    const list = terminals || [];
    const total = list.length;
    const online = list.filter((terminal) => terminal.active).length;
    const algoLive = list.filter((terminal) => terminal.algoActive).length;
    const totalEquity = list.reduce((acc, terminal) => acc + Number(terminal.equity ?? 0), 0);

    return { total, online, algoLive, totalEquity };
  }, [terminals]);

  return (
    <div className="min-h-screen flex flex-col gap-6 p-4 sm:p-6 lg:p-10 max-w-[1440px] mx-auto w-full">
      <header className="relative overflow-hidden rounded-3xl border border-white/10 bg-card/60 backdrop-blur-xl px-6 py-7 sm:px-8 sm:py-8 shadow-[0_20px_60px_-40px_rgba(59,130,246,0.55)]">
        <div className="pointer-events-none absolute -top-14 -right-14 h-40 w-40 rounded-full bg-sky-500/20 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-20 -left-10 h-44 w-44 rounded-full bg-indigo-500/15 blur-3xl" />
        <p className="text-xs uppercase tracking-[0.22em] text-sky-300/90 font-semibold">MT5 Intelligence Hub</p>
        <h1 className="mt-3 text-3xl sm:text-4xl font-semibold text-gradient">Realtime Terminal Command Center</h1>
        <p className="mt-3 text-sm sm:text-base text-muted-foreground max-w-2xl">
          Enhanced layout with adaptive filters, smoother transitions, and optional MT5 endpoint widgets when available.
        </p>
      </header>

      <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="metric-card">
          <p className="metric-card__label">Tracked Terminals</p>
          <p className="metric-card__value">{stats.total}</p>
          <p className="metric-card__hint">Live inventory from endpoint feed</p>
        </div>
        <div className="metric-card">
          <p className="metric-card__label">Online Now</p>
          <p className="metric-card__value text-emerald-300">{stats.online}</p>
          <p className="metric-card__hint">{stats.total > 0 ? Math.round((stats.online / stats.total) * 100) : 0}% availability</p>
        </div>
        <div className="metric-card">
          <p className="metric-card__label">Algo Active</p>
          <p className="metric-card__value text-violet-300">{stats.algoLive}</p>
          <p className="metric-card__hint">Automated strategies currently running</p>
        </div>
        <div className="metric-card">
          <p className="metric-card__label">Portfolio Equity</p>
          <p className="metric-card__value">${stats.totalEquity.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
          <p className="metric-card__hint">Aggregated from visible accounts</p>
        </div>
      </section>

      {(health || systemRealtime) && (
        <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {health && (
            <div className="glass-panel rounded-2xl p-5 flex items-start gap-4">
              <div className="rounded-xl bg-primary/10 p-3">
                <Timer className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground font-medium">Backend Health</p>
                <p className="text-lg font-semibold mt-1">Uptime {Math.floor(health.uptime_sec / 3600)}h</p>
                <p className="text-sm text-muted-foreground mt-1">
                  {health.tracked_terminals} terminals · {health.total_history_points} history points
                </p>
              </div>
            </div>
          )}
          {systemRealtime && (
            <div className="glass-panel rounded-2xl p-5 flex items-start gap-4">
              <div className="rounded-xl bg-sky-500/10 p-3">
                <Cpu className="w-5 h-5 text-sky-300" />
              </div>
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground font-medium">System Realtime</p>
                <p className="text-lg font-semibold mt-1">{systemRealtime.host}</p>
                <p className="text-sm text-muted-foreground mt-1">
                  CPU {systemRealtime.cpu_percent.toFixed(1)}% · Memory {systemRealtime.memory_percent.toFixed(1)}%
                </p>
              </div>
            </div>
          )}
        </section>
      )}

      <section className="glass-panel rounded-2xl p-4 sm:p-5 flex flex-col gap-4">
        <div className="flex flex-col lg:flex-row lg:items-center gap-3">
          <label className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by login, server, or terminal id"
              className="w-full rounded-xl border border-white/10 bg-background/70 pl-10 pr-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/60 outline-none focus:border-primary/40 transition-colors"
            />
          </label>
          <select
            value={sortBy}
            onChange={(event) => setSortBy(event.target.value as SortBy)}
            className="rounded-xl border border-white/10 bg-background/70 px-3 py-2.5 text-sm text-foreground outline-none focus:border-primary/40 transition-colors"
          >
            <option value="recent">Sort: Latest heartbeat</option>
            <option value="equity">Sort: Highest equity</option>
            <option value="growth">Sort: Highest growth</option>
            <option value="login">Sort: Login ascending</option>
          </select>
        </div>

        <div className="flex flex-wrap gap-2">
          {(["all", "active", "offline", "algo"] as StatusFilter[]).map((filter) => (
            <button
              key={filter}
              onClick={() => setStatusFilter(filter)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium uppercase tracking-wider transition-colors ${
                statusFilter === filter
                  ? "bg-primary text-primary-foreground"
                  : "bg-background/60 text-muted-foreground hover:text-foreground hover:bg-background"
              }`}
            >
              {filter}
            </button>
          ))}
        </div>
      </section>

      <main className="flex-1 flex flex-col">
        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 sm:gap-5">
            {Array.from({ length: 8 }).map((_, index) => (
              <div key={index} className="h-56 rounded-3xl border border-white/10 bg-card/60 animate-pulse" />
            ))}
          </div>
        ) : error ? (
          <div className="flex-1 flex flex-col items-center justify-center py-20 bg-destructive/5 rounded-3xl border border-destructive/20">
            <AlertTriangle className="w-16 h-16 text-destructive mb-4" />
            <h3 className="text-xl font-bold mb-2">Connection Failed</h3>
            <p className="text-muted-foreground mb-6 text-center max-w-md">
              Unable to retrieve terminal data from the server. Check network integrity.
            </p>
            <button
              onClick={() => refetch()}
              className="px-6 py-3 bg-destructive text-destructive-foreground rounded-xl font-semibold shadow-lg shadow-destructive/20 hover:bg-destructive/90 transition-all hover:-translate-y-0.5 active:translate-y-0"
            >
              Retry Connection
            </button>
          </div>
        ) : !terminals || terminals.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center py-20 bg-card/30 rounded-3xl border border-dashed border-white/10">
            <Server className="w-16 h-16 text-muted-foreground/30 mb-4" />
            <h3 className="text-xl font-bold mb-2 text-muted-foreground">No Terminals Active</h3>
            <p className="text-muted-foreground/60 text-center max-w-md">
              There are currently no trading terminals registered in the system.
            </p>
          </div>
        ) : filteredTerminals.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center py-20 bg-card/30 rounded-3xl border border-dashed border-white/10">
            <Bot className="w-16 h-16 text-muted-foreground/30 mb-4" />
            <h3 className="text-xl font-bold mb-2 text-muted-foreground">No Match Found</h3>
            <p className="text-muted-foreground/60 text-center max-w-md">
              Try adjusting your filters or search query to see more terminals.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 sm:gap-6">
            {filteredTerminals.map((terminal, index) => (
              <motion.div
                key={terminal.id}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.03, duration: 0.3, ease: "easeOut" }}
              >
                <TerminalCard
                  terminal={terminal}
                  onClick={setSelectedTerminalId}
                />
              </motion.div>
            ))}
          </div>
        )}
      </main>

      <TerminalDetailModal
        id={selectedTerminalId}
        onClose={() => setSelectedTerminalId(null)}
      />
    </div>
  );
}
