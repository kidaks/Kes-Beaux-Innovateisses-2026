import { logger } from "./logger";

interface AlertNotification {
  alertId: number;
  stationName: string;
  severity: string;
  risk: number;
  reason: string;
  createdAt: Date;
}

export async function sendTelegramAlert(
  alert: AlertNotification,
): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    return;
  }

  const message = [
    "Демонстрационное предупреждение · Kes Beaux Innovateisses",
    `Станция: ${alert.stationName}`,
    `Уровень: ${alert.severity} · риск ${alert.risk}/100`,
    `Причина: ${alert.reason}`,
    `Время: ${alert.createdAt.toISOString()}`,
    "Учебный прототип — не извещение о реальном пожаре.",
  ].join("\n");

  try {
    const response = await fetch(
      `https://api.telegram.org/bot${token}/sendMessage`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text: message }),
        signal: AbortSignal.timeout(5_000),
      },
    );
    const body = (await response.json()) as { ok?: boolean };
    if (!response.ok || !body.ok) {
      logger.warn(
        { alertId: alert.alertId, statusCode: response.status },
        "Telegram alert delivery failed",
      );
    }
  } catch {
    logger.warn(
      { alertId: alert.alertId },
      "Telegram alert delivery unavailable",
    );
  }
}
