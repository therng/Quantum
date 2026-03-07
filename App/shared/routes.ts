import { z } from 'zod';
import { terminals } from './schema';

export const errorSchemas = {
  notFound: z.object({
    message: z.string(),
  }),
  internal: z.object({
    message: z.string(),
  }),
};

// ============================================
// API CONTRACT
// ============================================
export const api = {
  runtime: {
    health: {
      method: 'GET' as const,
      path: '/health' as const,
      responses: {
        200: z.object({
          ok: z.boolean(),
          uptime_sec: z.number(),
          tracked_terminals: z.number(),
          total_history_points: z.number(),
          max_ts_drift_sec: z.number(),
          history_retention_sec: z.number(),
          history_max_points_per_terminal: z.number(),
        }),
      },
    },
    systemRealtime: {
      method: 'GET' as const,
      path: '/monitor/system/realtime' as const,
      responses: {
        200: z.object({
          collected_at: z.number(),
          host: z.string(),
          os: z.string(),
          is_windows: z.boolean(),
          cpu_percent: z.number(),
          memory_percent: z.number(),
          backend_pid: z.number(),
          refresh_interval_sec: z.number(),
        }),
      },
    },
  },
  mt5: {
    overview: {
      method: 'GET' as const,
      path: '/mt5/heartbeat/overview' as const,
      responses: {
        200: z.array(z.object({
          terminal_id: z.string(),
          received_at: z.number(),
          login: z.number(),
          server: z.string(),
          terminal_active: z.boolean(),
          algo_active: z.boolean(),
          balance: z.number().nullable().optional(),
          equity: z.number().nullable().optional(),
        })),
      },
    },
    latest: {
      method: 'GET' as const,
      path: '/mt5/heartbeat/latest/:id' as const,
      responses: {
        200: z.object({
          received_at: z.number(),
          payload: z.object({
            login: z.number(),
            server: z.string(),
            terminal_id: z.string(),
            terminal_active: z.boolean(),
            algo_active: z.boolean(),
            balance: z.number().nullable().optional(),
            equity: z.number().nullable().optional(),
          }),
        }),
      },
    },
    curve: {
      method: 'GET' as const,
      path: '/mt5/heartbeat/curve/:id' as const,
      responses: {
        200: z.array(z.object({
          received_at: z.number(),
          ts: z.number(),
          balance: z.number().nullable().optional(),
          equity: z.number().nullable().optional(),
        })),
      },
    },
    growth: {
      method: 'GET' as const,
      path: '/mt5/heartbeat/growth/:id' as const,
      responses: {
        200: z.object({
          terminal_id: z.string(),
          period: z.enum(['day', 'week', 'month', 'all']),
          value_source: z.enum(['equity', 'balance']),
          trade_window: z.enum(['day', 'week', 'month']),
          from_ts: z.number(),
          to_ts: z.number(),
          baseline_value: z.number().nullable().optional(),
          latest_value: z.number().nullable().optional(),
          latest_growth_pct: z.number().nullable().optional(),
          points: z.array(z.object({
            received_at: z.number(),
            ts: z.number(),
            value: z.number().nullable().optional(),
            growth_pct: z.number().nullable().optional(),
            trades: z.number().nullable().optional(),
            trades_long: z.number().nullable().optional(),
            trades_short: z.number().nullable().optional(),
          })),
        }),
      },
    },
  },
  terminals: {
    list: {
      method: 'GET' as const,
      path: '/api/terminals' as const,
      responses: {
        200: z.array(z.custom<typeof terminals.$inferSelect>()),
      },
    },
    get: {
      method: 'GET' as const,
      path: '/api/terminals/:id' as const,
      responses: {
        200: z.custom<typeof terminals.$inferSelect>(),
        404: errorSchemas.notFound,
      },
    },
    curve: {
      method: 'GET' as const,
      path: '/api/terminals/:id/curve' as const,
      responses: {
        200: z.array(z.object({
          timestamp: z.string(),
          equity: z.number(),
          balance: z.number(),
        })),
        404: errorSchemas.notFound,
      },
    },
  },
};

// ============================================
// URL BUILDER HELPER
// ============================================
export function buildUrl(path: string, params?: Record<string, string | number>): string {
  let url = path;
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (url.includes(`:${key}`)) {
        url = url.replace(`:${key}`, String(value));
      }
    });
  }
  return url;
}

export function withQuery(path: string, query?: Record<string, string | number | boolean | undefined>): string {
  if (!query) return path;

  const search = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value === undefined) return;
    search.set(key, String(value));
  });

  const queryString = search.toString();
  if (!queryString) return path;
  return `${path}?${queryString}`;
}

export type TerminalResponse = z.infer<typeof api.terminals.get.responses[200]>;
export type TerminalsListResponse = z.infer<typeof api.terminals.list.responses[200]>;
export type CurveResponse = z.infer<typeof api.terminals.curve.responses[200]>;
export type HealthResponse = z.infer<typeof api.runtime.health.responses[200]>;
export type SystemRealtimeResponse = z.infer<typeof api.runtime.systemRealtime.responses[200]>;
export type Mt5OverviewResponse = z.infer<typeof api.mt5.overview.responses[200]>;
export type Mt5LatestResponse = z.infer<typeof api.mt5.latest.responses[200]>;
export type Mt5CurveResponse = z.infer<typeof api.mt5.curve.responses[200]>;
export type GrowthResponse = z.infer<typeof api.mt5.growth.responses[200]>;
