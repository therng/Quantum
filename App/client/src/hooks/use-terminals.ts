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

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, "") ?? "";
const READ_API_KEY = (import.meta.env.VITE_MT5_READ_API_KEY as string | undefined)?.trim() ?? "";

type FetchJsonResult<T> =
  | { kind: "ok"; data: T }
  | { kind: "unavailable"; reason: "status" | "non-json" }
  | { kind: "error"; status: number; message: string };

function resolveUrl(path: string) {
  if (!API_BASE_URL) return path;
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  return `${API_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

function isCrossOrigin(url: string) {
  if (typeof window === "undefined") return false;

  try {
    return new URL(url, window.location.origin).origin !== window.location.origin;
  } catch {
    return false;
  }
}

function getFetchOptions(url: string, includeReadApiKey = false): RequestInit {
  const headers: HeadersInit = includeReadApiKey && READ_API_KEY ? { "X-API-Key": READ_API_KEY } : {};

  return {
    headers,
    credentials: isCrossOrigin(url) ? "omit" : "include",
  };
}

async function fetchJson<T>(
  path: string,
  parser: { parse: (data: unknown) => T },
  options?: {
    includeReadApiKey?: boolean;
    unavailableStatuses?: number[];
  },
): Promise<FetchJsonResult<T>> {
  const url = resolveUrl(path);
  const res = await fetch(url, getFetchOptions(url, options?.includeReadApiKey));

  if (options?.unavailableStatuses?.includes(res.status)) {
    return { kind: "unavailable", reason: "status" };
  }

  if (!res.ok) {
    return {
      kind: "error",
      status: res.status,
      message: `${res.status} ${res.statusText || "Request failed"}`,
    };
  }

  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return { kind: "unavailable", reason: "non-json" };
  }

  const data = await res.json();
  return { kind: "ok", data: parser.parse(data) };
}

async function fetchGrowthPercent(id: string): Promise<number | null> {
  const growthPath = withQuery(buildUrl(api.mt5.growth.path, { id }), {
    period: "week",
    value_source: "equity",
    trade_window: "week",
    limit: 180,
  });

  const result = await fetchJson(growthPath, api.mt5.growth.responses[200], {
    includeReadApiKey: true,
    unavailableStatuses: [401, 403, 404],
  });

  if (result.kind !== "ok") return null;
  return result.data.latest_growth_pct ?? null;
}

async function mapOverviewTerminal(terminal: Mt5OverviewResponse[number]): Promise<Terminal> {
  const growthPercent = await fetchGrowthPercent(terminal.terminal_id);

  return {
    id: terminal.terminal_id,
    login: terminal.login,
    server: terminal.server,
    active: terminal.terminal_active,
    algoActive: terminal.algo_active,
    uptimeHours: null,
    balance: Number(terminal.balance ?? 0),
    equity: Number(terminal.equity ?? 0),
    growthPercent: growthPercent ?? 0,
    lastHeartbeat: new Date(terminal.received_at * 1000),
  };
}

async function mapLatestTerminal(record: Mt5LatestResponse): Promise<Terminal> {
  const growthPercent = await fetchGrowthPercent(record.payload.terminal_id);

  return {
    id: record.payload.terminal_id,
    login: record.payload.login,
    server: record.payload.server,
    active: record.payload.terminal_active,
    algoActive: record.payload.algo_active,
    uptimeHours: null,
    balance: Number(record.payload.balance ?? 0),
    equity: Number(record.payload.equity ?? 0),
    growthPercent: growthPercent ?? 0,
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
      const localResult = await fetchJson(api.terminals.list.path, api.terminals.list.responses[200], {
        unavailableStatuses: [404],
      });

      if (localResult.kind === "ok") {
        return localResult.data;
      }

      if (localResult.kind === "error") {
        throw new Error("Failed to fetch terminals");
      }

      const mt5Result = await fetchJson(api.mt5.overview.path, api.mt5.overview.responses[200], {
        includeReadApiKey: true,
        unavailableStatuses: [401, 403, 404],
      });

      if (mt5Result.kind === "unavailable") {
        return [];
      }

      if (mt5Result.kind === "error") {
        throw new Error("Failed to fetch terminals");
      }

      return Promise.all(mt5Result.data.map(mapOverviewTerminal));
    },
    refetchInterval: 15000,
  });
}

export function useTerminal(id: string) {
  return useQuery<TerminalResponse | null>({
    queryKey: [api.terminals.get.path, id],
    queryFn: async () => {
      if (!id) return null;

      const localResult = await fetchJson(buildUrl(api.terminals.get.path, { id }), api.terminals.get.responses[200], {
        unavailableStatuses: [404],
      });

      if (localResult.kind === "ok") {
        return localResult.data;
      }

      if (localResult.kind === "error") {
        throw new Error("Failed to fetch terminal details");
      }

      const mt5Result = await fetchJson(buildUrl(api.mt5.latest.path, { id }), api.mt5.latest.responses[200], {
        includeReadApiKey: true,
        unavailableStatuses: [401, 403, 404],
      });

      if (mt5Result.kind === "unavailable") {
        return null;
      }

      if (mt5Result.kind === "error") {
        throw new Error("Failed to fetch terminal details");
      }

      return mapLatestTerminal(mt5Result.data);
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

      const localResult = await fetchJson(buildUrl(api.terminals.curve.path, { id }), api.terminals.curve.responses[200], {
        unavailableStatuses: [404],
      });

      if (localResult.kind === "ok") {
        return localResult.data;
      }

      if (localResult.kind === "error") {
        throw new Error("Failed to fetch curve data");
      }

      const mt5Path = withQuery(buildUrl(api.mt5.curve.path, { id }), {
        period: "month",
        limit: 500,
      });
      const mt5Result = await fetchJson(mt5Path, api.mt5.curve.responses[200], {
        includeReadApiKey: true,
        unavailableStatuses: [401, 403, 404],
      });

      if (mt5Result.kind === "unavailable") {
        return [];
      }

      if (mt5Result.kind === "error") {
        throw new Error("Failed to fetch curve data");
      }

      return mapCurvePoints(mt5Result.data);
    },
    enabled: !!id,
    refetchInterval: 30000,
  });
}

export function useBackendHealth() {
  return useQuery<HealthResponse | null>({
    queryKey: [api.runtime.health.path],
    queryFn: async () => {
      const result = await fetchJson(api.runtime.health.path, api.runtime.health.responses[200], {
        unavailableStatuses: [404],
      });

      if (result.kind === "unavailable") {
        return null;
      }

      if (result.kind === "error") {
        throw new Error("Failed to fetch backend health");
      }

      return result.data;
    },
    refetchInterval: 30000,
  });
}

export function useSystemRealtime() {
  return useQuery<SystemRealtimeResponse | null>({
    queryKey: [api.runtime.systemRealtime.path],
    queryFn: async () => {
      const result = await fetchJson(api.runtime.systemRealtime.path, api.runtime.systemRealtime.responses[200], {
        includeReadApiKey: true,
        unavailableStatuses: [401, 403, 404, 503],
      });

      if (result.kind === "unavailable") {
        return null;
      }

      if (result.kind === "error") {
        throw new Error("Failed to fetch system metrics");
      }

      return result.data;
    },
    refetchInterval: 30000,
  });
}

export function useTerminalGrowth(id: string) {
  return useQuery<GrowthResponse | null>({
    queryKey: [api.mt5.growth.path, id],
    queryFn: async () => {
      if (!id) return null;

      const result = await fetchJson(
        withQuery(buildUrl(api.mt5.growth.path, { id }), {
          period: "week",
          value_source: "equity",
          trade_window: "week",
          limit: 180,
        }),
        api.mt5.growth.responses[200],
        {
          includeReadApiKey: true,
          unavailableStatuses: [401, 403, 404],
        },
      );

      if (result.kind === "unavailable") {
        return null;
      }

      if (result.kind === "error") {
        throw new Error("Failed to fetch growth data");
      }

      return result.data;
    },
    enabled: !!id,
    refetchInterval: 30000,
  });
}
