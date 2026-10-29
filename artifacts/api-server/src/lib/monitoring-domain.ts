import { and, desc, eq, isNull, ne } from "drizzle-orm";
import {
  db,
  monitoringAlerts,
  monitoringMeasurements,
  monitoringSettings,
  monitoringStations,
  monitoringUsers,
} from "@workspace/db";
import { hashPassword } from "./security";
import { sendTelegramAlert } from "./telegram-notifications";

export const TEMPERATURE_MIN = -40;
export const TEMPERATURE_MAX = 60;

export type RiskLevel = "low" | "medium" | "high" | "critical";

export function calculateRisk(
  temperature: number,
  humidity: number,
  smoke: number,
): { risk: number; riskLevel: RiskLevel } {
  const normalizedTemperature = Math.min(
    100,
    Math.max(0, ((temperature - 10) / 30) * 100),
  );
  const risk = Math.min(
    100,
    Math.max(
      0,
      Math.round(
        0.35 * normalizedTemperature +
          0.25 * (100 - humidity) +
          0.4 * smoke,
      ),
    ),
  );

  const riskLevel: RiskLevel =
    risk >= 80 ? "critical" : risk >= 60 ? "high" : risk >= 30 ? "medium" : "low";
  return { risk, riskLevel };
}

export function measurementReason(
  temperature: number,
  humidity: number,
  smoke: number,
  risk: number,
): string {
  return `Условная модель риска достигла ${risk}/100: температура ${temperature} °C, влажность ${humidity}%, задымлённость ${smoke}/100.`;
}

export async function recordMeasurement(
  stationId: number,
  values: { temperature: number; humidity: number; smoke: number },
) {
  const [station] = await db
    .select()
    .from(monitoringStations)
    .where(
      and(
        eq(monitoringStations.id, stationId),
        isNull(monitoringStations.archivedAt),
      ),
    )
    .limit(1);

  if (!station) {
    return null;
  }

  const calculated = calculateRisk(
    values.temperature,
    values.humidity,
    values.smoke,
  );
  const recordedAt = new Date();
  const [measurement] = await db
    .insert(monitoringMeasurements)
    .values({
      stationId,
      ...values,
      ...calculated,
      recordedAt,
    })
    .returning();

  await db
    .update(monitoringStations)
    .set({
      ...values,
      ...calculated,
      lastMeasuredAt: recordedAt,
      updatedAt: recordedAt,
    })
    .where(eq(monitoringStations.id, stationId));

  const [settings] = await db.select().from(monitoringSettings).limit(1);
  const alertThreshold = settings?.alertThreshold ?? 60;
  const [activeAlert] = await db
    .select()
    .from(monitoringAlerts)
    .where(
      and(
        eq(monitoringAlerts.stationId, stationId),
        ne(monitoringAlerts.status, "resolved"),
      ),
    )
    .orderBy(desc(monitoringAlerts.createdAt))
    .limit(1);

  if (calculated.risk >= alertThreshold) {
    const reason = measurementReason(
      values.temperature,
      values.humidity,
      values.smoke,
      calculated.risk,
    );
    if (!activeAlert) {
      const [createdAlert] = await db
        .insert(monitoringAlerts)
        .values({
          stationId,
          severity: calculated.riskLevel,
          risk: calculated.risk,
          reason,
          status: "new",
          published: true,
        })
        .returning({ id: monitoringAlerts.id });
      await sendTelegramAlert({
        alertId: createdAlert.id,
        stationName: station.name,
        severity: calculated.riskLevel,
        risk: calculated.risk,
        reason,
        createdAt: recordedAt,
      });
    } else if (activeAlert.severity !== calculated.riskLevel) {
      const levelOrder: Record<RiskLevel, number> = {
        low: 0,
        medium: 1,
        high: 2,
        critical: 3,
      };
      if (
        levelOrder[calculated.riskLevel] > levelOrder[activeAlert.severity as RiskLevel]
      ) {
        const [updatedAlert] = await db
          .update(monitoringAlerts)
          .set({
            severity: calculated.riskLevel,
            risk: calculated.risk,
            reason,
            status: "new",
            createdAt: recordedAt,
          })
          .where(eq(monitoringAlerts.id, activeAlert.id))
          .returning({ id: monitoringAlerts.id });
        await sendTelegramAlert({
          alertId: updatedAlert.id,
          stationName: station.name,
          severity: calculated.riskLevel,
          risk: calculated.risk,
          reason,
          createdAt: recordedAt,
        });
      }
    }
  } else if (activeAlert) {
    await db
      .update(monitoringAlerts)
      .set({ status: "resolved" })
      .where(
        and(
          eq(monitoringAlerts.stationId, stationId),
          ne(monitoringAlerts.status, "resolved"),
        ),
      );
  }

  return { measurement, station: { ...station, ...values, ...calculated, lastMeasuredAt: recordedAt } };
}

const demoAccounts = [
  { username: "guest", password: "guest-demo-2026", role: "guest" },
  { username: "operator", password: "operator-demo-2026", role: "operator" },
  { username: "admin", password: "admin-demo-2026", role: "admin" },
] as const;

const demoStations = [
  {
    name: "Сосновый бор",
    latitude: 56.015,
    longitude: 92.867,
    stationType: "Метеостанция",
    deviceStatus: "working",
    temperature: 19,
    humidity: 58,
    smoke: 14,
  },
  {
    name: "Лесной обход Восточный",
    latitude: 56.151,
    longitude: 101.634,
    stationType: "Датчик дыма",
    deviceStatus: "working",
    temperature: 25,
    humidity: 48,
    smoke: 30,
  },
  {
    name: "Таёжная просека",
    latitude: 62.03,
    longitude: 129.73,
    stationType: "Комплексный датчик",
    deviceStatus: "working",
    temperature: 33,
    humidity: 32,
    smoke: 70,
  },
  {
    name: "Северный кордон",
    latitude: 58.0,
    longitude: 102.66,
    stationType: "Метеостанция",
    deviceStatus: "faulty",
    temperature: 21,
    humidity: 65,
    smoke: 8,
  },
];

export async function initializeMonitoringData(): Promise<void> {
  for (const account of demoAccounts) {
    await db
      .insert(monitoringUsers)
      .values({
        username: account.username,
        passwordHash: hashPassword(account.password),
        role: account.role,
      })
      .onConflictDoNothing({ target: monitoringUsers.username });
  }

  const [settings] = await db.select().from(monitoringSettings).limit(1);
  if (!settings) {
    await db.insert(monitoringSettings).values({ id: 1, alertThreshold: 60 });
  }

  const [existingStation] = await db.select({ id: monitoringStations.id }).from(monitoringStations).limit(1);
  if (existingStation) {
    return;
  }

  for (let index = 0; index < demoStations.length; index += 1) {
    const entry = demoStations[index];
    const calculated = calculateRisk(
      entry.temperature,
      entry.humidity,
      entry.smoke,
    );
    const recordedAt = new Date(Date.now() - (demoStations.length - index) * 90_000);
    const [station] = await db
      .insert(monitoringStations)
      .values({
        name: entry.name,
        latitude: entry.latitude,
        longitude: entry.longitude,
        stationType: entry.stationType,
        deviceStatus: entry.deviceStatus,
        temperature: entry.temperature,
        humidity: entry.humidity,
        smoke: entry.smoke,
        ...calculated,
        lastMeasuredAt: recordedAt,
        scenario: "normal",
      })
      .returning();

    await db.insert(monitoringMeasurements).values({
      stationId: station.id,
      temperature: entry.temperature,
      humidity: entry.humidity,
      smoke: entry.smoke,
      ...calculated,
      recordedAt,
    });

    if (calculated.risk >= 60) {
      await db.insert(monitoringAlerts).values({
        stationId: station.id,
        severity: calculated.riskLevel,
        risk: calculated.risk,
        reason: measurementReason(
          entry.temperature,
          entry.humidity,
          entry.smoke,
          calculated.risk,
        ),
        status: "new",
        published: true,
        createdAt: recordedAt,
      });
    }
  }
}
