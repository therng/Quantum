import { db } from "./db";
import {
  terminals,
  heartbeats,
  type Terminal,
  type Heartbeat,
  type CurvePoint
} from "@shared/schema";
import { eq, desc } from "drizzle-orm";

export interface IStorage {
  getTerminals(): Promise<Terminal[]>;
  getTerminal(id: string): Promise<Terminal | undefined>;
  getTerminalCurve(id: string): Promise<CurvePoint[]>;
}

export class DatabaseStorage implements IStorage {
  async getTerminals(): Promise<Terminal[]> {
    return await db.select().from(terminals).orderBy(desc(terminals.lastHeartbeat));
  }

  async getTerminal(id: string): Promise<Terminal | undefined> {
    const results = await db.select().from(terminals).where(eq(terminals.id, id));
    return results[0];
  }

  async getTerminalCurve(id: string): Promise<CurvePoint[]> {
    const points = await db.select()
      .from(heartbeats)
      .where(eq(heartbeats.terminalId, id))
      .orderBy(heartbeats.timestamp);

    return points.map(p => ({
      timestamp: p.timestamp?.toISOString() ?? new Date().toISOString(),
      equity: p.equity,
      balance: p.balance
    }));
  }
}

export const storage = new DatabaseStorage();
