import { useQuery } from "@tanstack/react-query";
import {
  api,
  buildUrl,
  withQuery,
  type CurveResponse,
  type GrowthResponse,
  type HealthResponse,
  type Mt5CurveResponse,
  type Mt5LatestResponse,
  type Mt5OverviewResponse,
  type SystemRealtimeResponse,
  type TerminalResponse,
  type TerminalsListResponse,
} from "@shared/routes";
import type { Terminal } from "@shared/schema";

// ============================================
// REST HOOKS
// ============================================

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, "") ?? "";
const READ_API_KEY = (import.meta.env.VITE_MT5_READ_API_KEY as string | undefined)?.trim() ?? "";

function resolveUrl(path: string) {
  if (!API_BASE_URL) return path;
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  return `${API_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

function readHeaders(): HeadersInit {
  if (!READ_API_KEY) return {};
  return { "X-API-Key": READ_API_KEY };
}

function mapOverviewTerminal(terminal: Mt5OverviewResponse[number]): Terminal {
  return {
    id: terminal.terminal_id,
    login: terminal.login,
    server: terminal.server,
    active: terminal.terminal_active,
    algoActive: terminal.algo_active,
    uptimeHours: 0,
    balance: Number(terminal.balance ?? 0),
    equity: Number(terminal.equity ?? 0),
    growthPercent: 0,
    lastHeartbeat: new Date(terminal.received_at * 1000),
  };
}

function mapLatestTerminal(record: Mt5LatestResponse): Terminal {
  return {
    id: record.payload.terminal_id,
    login: record.payload.login,
    server: record.payload.server,
    active: record.payload.terminal_active,
    algoActive: record.payload.algo_active,
    uptimeHours: 0,
    balance: Number(record.payload.balance ?? 0),
    equity: Number(record.payload.equity ?? 0),
    growthPercent: 0,
    lastHeartbeat: new Date(record.received_at * 1000),
  };
}

function mapCurvePoints(points: Mt5CurveResponse): CurveResponse {
  return points.map((point) => ({
    timestamp: new Date(point.ts * 1000).toISOString(),
    equity: Number(point.equity ?? 0),
    balance: Number(point.balance ?? 0),
  }));
}

export function useTerminals() {
  return useQuery<TerminalsListResponse>({
    queryKey: [api.terminals.list.path],
    queryFn: async () => {
      const localRes = await fetch(resolveUrl(api.terminals.list.path), { credentials: "include" });
      if (localRes.ok) {
        const data = await localRes.json();
        return api.terminals.list.responses[200].parse(data);
      }

      if (localRes.status !== 404) {
        throw new Error("Failed to fetch terminals");
      }

      const mt5Res = await fetch(resolveUrl(api.mt5.overview.path), {
        credentials: "include",
        headers: readHeaders(),
      });
      if (mt5Res.status === 401 || mt5Res.status === 403 || mt5Res.status === 404) {
        return [];
      }
      if (!mt5Res.ok) throw new Error("Failed to fetch terminals");

      const data = await mt5Res.json();
      const parsed = api.mt5.overview.responses[200].parse(data);
      return parsed.map(mapOverviewTerminal);
    },
    // Refetch somewhat frequently for a live dashboard feel
    refetchInterval: 15000, 
  });
}

export function useTerminal(id: string) {
  return useQuery<TerminalResponse | null>({
    queryKey: [api.terminals.get.path, id],
    queryFn: async () => {
      if (!id) return null;
      const localUrl = buildUrl(api.terminals.get.path, { id });
      const localRes = await fetch(resolveUrl(localUrl), { credentials: "include" });

      if (localRes.ok) {
        const data = await localRes.json();
        return api.terminals.get.responses[200].parse(data);
      }

      if (localRes.status !== 404) throw new Error("Failed to fetch terminal details");

      const mt5Url = buildUrl(api.mt5.latest.path, { id });
      const mt5Res = await fetch(resolveUrl(mt5Url), {
        credentials: "include",
        headers: readHeaders(),
      });
      if (mt5Res.status === 401 || mt5Res.status === 403 || mt5Res.status === 404) return null;
      if (!mt5Res.ok) throw new Error("Failed to fetch terminal details");

      const mt5Data = await mt5Res.json();
      const parsed = api.mt5.latest.responses[200].parse(mt5Data);
      return mapLatestTerminal(parsed);
    },
    enabled: !!id,
    refetchInterval: 15000,
  });
}

export function useTerminalCurve(id: string) {
  return useQuery<CurveResponse>({
    queryKey: [api.terminals.curve.path, id],
    queryFn: async () => {
      if (!id) return [];
      const localUrl = buildUrl(api.terminals.curve.path, { id });
      const localRes = await fetch(resolveUrl(localUrl), { credentials: "include" });

      if (localRes.ok) {
        const data = await localRes.json();
        return api.terminals.curve.responses[200].parse(data);
      }

      if (localRes.status !== 404) throw new Error("Failed to fetch curve data");

      const mt5Path = withQuery(buildUrl(api.mt5.curve.path, { id }), {
        period: "month",
        limit: 500,
      });
      const mt5Res = await fetch(resolveUrl(mt5Path), {
        credentials: "include",
        headers: readHeaders(),
      });
      if (mt5Res.status === 401 || mt5Res.status === 403 || mt5Res.status === 404) return [];
      if (!mt5Res.ok) throw new Error("Failed to fetch curve data");

      const mt5Data = await mt5Res.json();
      const parsed = api.mt5.curve.responses[200].parse(mt5Data);
      return mapCurvePoints(parsed);
    },
    enabled: !!id,
    refetchInterval: 30000,
  });
}

export function useBackendHealth() {
  return useQuery<HealthResponse | null>({
    queryKey: [api.runtime.health.path],
    queryFn: async () => {
      const res = await fetch(resolveUrl(api.runtime.health.path), { credentials: "include" });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error("Failed to fetch backend health");
      const data = await res.json();
      return api.runtime.health.responses[200].parse(data);
    },
    refetchInterval: 30000,
  });
}

export function useSystemRealtime() {
  return useQuery<SystemRealtimeResponse | null>({
    queryKey: [api.runtime.systemRealtime.path],
    queryFn: async () => {
      const res = await fetch(resolveUrl(api.runtime.systemRealtime.path), {
        credentials: "include",
        headers: readHeaders(),
      });
      if (res.status === 401 || res.status === 403 || res.status === 404 || res.status === 503) {
        return null;
      }
      if (!res.ok) throw new Error("Failed to fetch system metrics");
      const data = await res.json();
      return api.runtime.systemRealtime.responses[200].parse(data);
    },
    refetchInterval: 30000,
  });
}

export function useTerminalGrowth(id: string) {
  return useQuery<GrowthResponse | null>({
    queryKey: [api.mt5.growth.path, id],
    queryFn: async () => {
      if (!id) return null;

      const basePath = buildUrl(api.mt5.growth.path, { id });
      const url = withQuery(basePath, {
        period: "week",
        value_source: "equity",
        trade_window: "week",
        limit: 180,
      });

      const res = await fetch(resolveUrl(url), {
        credentials: "include",
        headers: readHeaders(),
      });

      if (res.status === 401 || res.status === 403 || res.status === 404) return null;
      if (!res.ok) throw new Error("Failed to fetch growth data");

      const data = await res.json();
      return api.mt5.growth.responses[200].parse(data);
    },
    enabled: !!id,
    refetchInterval: 30000,
  });
}
