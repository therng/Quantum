import type { Express } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import { api } from "@shared/routes";
import { db } from "./db";
import { terminals, heartbeats } from "@shared/schema";
import { eq } from "drizzle-orm";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // Seed DB if empty
  await seedDatabase();

  app.get(api.terminals.list.path, async (req, res) => {
    try {
      const allTerminals = await storage.getTerminals();
      res.json(allTerminals);
    } catch (err) {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get(api.terminals.get.path, async (req, res) => {
    try {
      const terminal = await storage.getTerminal(req.params.id);
      if (!terminal) {
        return res.status(404).json({ message: 'Terminal not found' });
      }
      res.json(terminal);
    } catch (err) {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get(api.terminals.curve.path, async (req, res) => {
    try {
      const terminal = await storage.getTerminal(req.params.id);
      if (!terminal) {
        return res.status(404).json({ message: 'Terminal not found' });
      }
      const curve = await storage.getTerminalCurve(req.params.id);
      res.json(curve);
    } catch (err) {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  return httpServer;
}

async function seedDatabase() {
  try {
    const existing = await storage.getTerminals();
    if (existing.length === 0) {
      const now = new Date();
      
      const t1Id = "term-alpha-001";
      await db.insert(terminals).values({
        id: t1Id,
        login: 1004501,
        server: "Broker-Live-1",
        active: true,
        algoActive: true,
        uptimeHours: 340,
        balance: 10000,
        equity: 10500,
        growthPercent: 5.0,
        lastHeartbeat: now
      });

      const t2Id = "term-beta-002";
      await db.insert(terminals).values({
        id: t2Id,
        login: 2008922,
        server: "Broker-Live-2",
        active: true,
        algoActive: false,
        uptimeHours: 120,
        balance: 5000,
        equity: 4900,
        growthPercent: -2.0,
        lastHeartbeat: now
      });
      
      const t3Id = "term-gamma-003";
      await db.insert(terminals).values({
        id: t3Id,
        login: 3001234,
        server: "Broker-Live-1",
        active: false,
        algoActive: false,
        uptimeHours: 12,
        balance: 25000,
        equity: 28000,
        growthPercent: 12.0,
        lastHeartbeat: new Date(now.getTime() - 86400000)
      });

      // Generate some dummy curve points for t1Id
      for (let i = 0; i < 30; i++) {
        const t = new Date(now.getTime() - (30 - i) * 86400000);
        await db.insert(heartbeats).values({
          terminalId: t1Id,
          timestamp: t,
          balance: 10000,
          equity: 10000 + (Math.random() * 1000 - 200) + (i * 20),
        });
        
        await db.insert(heartbeats).values({
          terminalId: t2Id,
          timestamp: t,
          balance: 5000,
          equity: 5000 - (Math.random() * 500) + (i * 5),
        });
        
        await db.insert(heartbeats).values({
          terminalId: t3Id,
          timestamp: t,
          balance: 25000,
          equity: 25000 + (Math.random() * 2000) + (i * 100),
        });
      }
    }
  } catch (err) {
    console.error("Failed to seed database:", err);
  }
}
