import { and, desc, eq, isNull, ne } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  AddStationMeasurementBody,
  AddStationMeasurementParams,
  AddStationMeasurementResponse,
  CreateStationBody,
  CreateStationResponse,
  DeleteStationParams,
  GetAlertsResponse,
  GetDashboardResponse,
  GetMonitoringSettingsResponse,
  GetStationMeasurementsParams,
  GetStationMeasurementsResponse,
  GetStationParams,
  GetStationResponse,
  GetStationsResponse,
  ResetSimulationResponse,
  UpdateAlertBody,
  UpdateAlertParams,
  UpdateAlertResponse,
  UpdateMonitoringSettingsBody,
  UpdateMonitoringSettingsResponse,
  UpdateStationBody,
  UpdateStationParams,
  UpdateStationResponse,
} from "@workspace/api-zod";
import {
  db,
  monitoringAlerts,
  monitoringMeasurements,
  monitoringSettings,
  monitoringStations,
} from "@workspace/db";
import {
  getAuthUser,
  requireRole,
} from "../middlewares/auth-context";
import {
  calculateRisk,
  recordMeasurement,
} from "../lib/monitoring-domain";

const router: IRouter = Router();

router.get("/dashboard", async (_req, res): Promise<void> => {
  const stations = await db
    .select()
    .from(monitoringStations)
    .where(isNull(monitoringStations.archivedAt))
    .orderBy(monitoringStations.name);
  const alerts = await db
    .select()
    .from(monitoringAlerts)
    .where(ne(monitoringAlerts.status, "resolved"));
  const totalRisk = stations.reduce((sum, station) => sum + station.risk, 0);
  const activeStations = stations.filter(
    (station) => station.deviceStatus === "working",
  ).length;
  const lastUpdated = stations.reduce<Date | null>(
    (latest, station) =>
      !latest || station.lastMeasuredAt > latest ? station.lastMeasuredAt : latest,
    null,
  );

  res.json(
    GetDashboardResponse.parse({
      totalStations: stations.length,
      activeStations,
      activeAlerts: alerts.length,
      averageRisk: stations.length ? Math.round(totalRisk / stations.length) : 0,
      lastUpdated,
      systemState:
        stations.some((station) => station.deviceStatus !== "working")
          ? "degraded"
          : "online",
      highRiskStations: stations.filter((station) => station.risk >= 60),
    }),
  );
});

router.get("/stations", async (_req, res): Promise<void> => {
  const stations = await db
    .select()
    .from(monitoringStations)
    .where(isNull(monitoringStations.archivedAt))
    .orderBy(monitoringStations.name);
  res.json(GetStationsResponse.parse(stations));
});

router.post(
  "/stations",
  requireRole("admin"),
  async (req, res): Promise<void> => {
    const parsed = CreateStationBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const [created] = await db
      .insert(monitoringStations)
      .values({
        ...parsed.data,
        deviceStatus: parsed.data.deviceStatus ?? "working",
        scenario: parsed.data.scenario ?? "normal",
      })
      .returning();

    const recorded = await recordMeasurement(created.id, {
      temperature: 18,
      humidity: 62,
      smoke: 12,
    });
    res.status(201).json(
      CreateStationResponse.parse(recorded?.station ?? created),
    );
  },
);

router.get("/stations/:id", async (req, res): Promise<void> => {
  const params = GetStationParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [station] = await db
    .select()
    .from(monitoringStations)
    .where(
      and(
        eq(monitoringStations.id, params.data.id),
        isNull(monitoringStations.archivedAt),
      ),
    )
    .limit(1);
  if (!station) {
    res.status(404).json({ error: "Станция не найдена" });
    return;
  }
  res.json(GetStationResponse.parse(station));
});

router.patch(
  "/stations/:id",
  requireRole("admin"),
  async (req, res): Promise<void> => {
    const params = UpdateStationParams.safeParse(req.params);
    const parsed = UpdateStationBody.safeParse(req.body);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const [updated] = await db
      .update(monitoringStations)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(
        and(
          eq(monitoringStations.id, params.data.id),
          isNull(monitoringStations.archivedAt),
        ),
      )
      .returning();
    if (!updated) {
      res.status(404).json({ error: "Станция не найдена" });
      return;
    }
    res.json(UpdateStationResponse.parse(updated));
  },
);

router.delete(
  "/stations/:id",
  requireRole("admin"),
  async (req, res): Promise<void> => {
    const params = DeleteStationParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const [archived] = await db
      .update(monitoringStations)
      .set({
        archivedAt: new Date(),
        deviceStatus: "offline",
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(monitoringStations.id, params.data.id),
          isNull(monitoringStations.archivedAt),
        ),
      )
      .returning({ id: monitoringStations.id });
    if (!archived) {
      res.status(404).json({ error: "Станция не найдена" });
      return;
    }
    res.sendStatus(204);
  },
);

router.get("/stations/:id/measurements", async (req, res): Promise<void> => {
  const params = GetStationMeasurementsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [station] = await db
    .select({ id: monitoringStations.id })
    .from(monitoringStations)
    .where(
      and(
        eq(monitoringStations.id, params.data.id),
        isNull(monitoringStations.archivedAt),
      ),
    )
    .limit(1);
  if (!station) {
    res.status(404).json({ error: "Станция не найдена" });
    return;
  }

  const history = await db
    .select()
    .from(monitoringMeasurements)
    .where(eq(monitoringMeasurements.stationId, params.data.id))
    .orderBy(desc(monitoringMeasurements.recordedAt))
    .limit(100);
  res.json(GetStationMeasurementsResponse.parse(history.reverse()));
});

router.post(
  "/stations/:id/measurements",
  requireRole("operator", "admin"),
  async (req, res): Promise<void> => {
    const params = AddStationMeasurementParams.safeParse(req.params);
    const parsed = AddStationMeasurementBody.safeParse(req.body);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const result = await recordMeasurement(params.data.id, parsed.data);
    if (!result) {
      res.status(404).json({ error: "Станция не найдена" });
      return;
    }
    res.status(201).json(AddStationMeasurementResponse.parse(result.measurement));
  },
);

router.get("/alerts", async (_req, res): Promise<void> => {
  const rows = await db
    .select({
      id: monitoringAlerts.id,
      stationId: monitoringAlerts.stationId,
      stationName: monitoringStations.name,
      severity: monitoringAlerts.severity,
      risk: monitoringAlerts.risk,
      reason: monitoringAlerts.reason,
      createdAt: monitoringAlerts.createdAt,
      status: monitoringAlerts.status,
      published: monitoringAlerts.published,
    })
    .from(monitoringAlerts)
    .innerJoin(
      monitoringStations,
      eq(monitoringAlerts.stationId, monitoringStations.id),
    )
    .where(eq(monitoringAlerts.published, true))
    .orderBy(desc(monitoringAlerts.createdAt));
  res.json(GetAlertsResponse.parse(rows));
});

router.patch(
  "/alerts/:id",
  requireRole("operator", "admin"),
  async (req, res): Promise<void> => {
    const params = UpdateAlertParams.safeParse(req.params);
    const parsed = UpdateAlertBody.safeParse(req.body);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const user = getAuthUser(res);
    const [updated] = await db
      .update(monitoringAlerts)
      .set({
        status: parsed.data.status,
        handledByUserId:
          parsed.data.status === "new" ? null : (user?.id ?? null),
      })
      .where(eq(monitoringAlerts.id, params.data.id))
      .returning();
    if (!updated) {
      res.status(404).json({ error: "Предупреждение не найдено" });
      return;
    }
    const [station] = await db
      .select({ name: monitoringStations.name })
      .from(monitoringStations)
      .where(eq(monitoringStations.id, updated.stationId))
      .limit(1);
    res.json(
      UpdateAlertResponse.parse({
        ...updated,
        stationName: station?.name ?? "Архивная станция",
      }),
    );
  },
);

router.get("/settings", async (_req, res): Promise<void> => {
  const [settings] = await db.select().from(monitoringSettings).limit(1);
  if (!settings) {
    res.status(503).json({ error: "Настройки ещё не созданы" });
    return;
  }
  res.json(GetMonitoringSettingsResponse.parse(settings));
});

router.patch(
  "/settings",
  requireRole("admin"),
  async (req, res): Promise<void> => {
    const parsed = UpdateMonitoringSettingsBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const [settings] = await db
      .insert(monitoringSettings)
      .values({ id: 1, alertThreshold: parsed.data.alertThreshold })
      .onConflictDoUpdate({
        target: monitoringSettings.id,
        set: { alertThreshold: parsed.data.alertThreshold, updatedAt: new Date() },
      })
      .returning();
    res.json(UpdateMonitoringSettingsResponse.parse(settings));
  },
);

router.post(
  "/simulation/reset",
  requireRole("operator", "admin"),
  async (_req, res): Promise<void> => {
    const stations = await db
      .select({ id: monitoringStations.id })
      .from(monitoringStations)
      .where(isNull(monitoringStations.archivedAt));

    const resetStations = [];
    for (const station of stations) {
      await db
        .update(monitoringStations)
        .set({ scenario: "normal" })
        .where(eq(monitoringStations.id, station.id));
      const result = await recordMeasurement(station.id, {
        temperature: 18,
        humidity: 62,
        smoke: 12,
      });
      if (result) {
        resetStations.push(result.station);
      }
    }
    res.json(ResetSimulationResponse.parse(resetStations));
  },
);

export default router;
