import { count, eq } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  GetCurrentUserResponse,
  GetUsersResponse,
  LoginBody,
  LoginResponse,
  UpdateUserRoleBody,
  UpdateUserRoleParams,
  UpdateUserRoleResponse,
} from "@workspace/api-zod";
import {
  db,
  monitoringSessions,
  monitoringUsers,
} from "@workspace/db";
import { getAuthUser, requireRole } from "../middlewares/auth-context";
import {
  createSessionToken,
  hashPassword,
  hashSessionToken,
  readCookie,
  verifyPassword,
} from "../lib/security";

const router: IRouter = Router();
const sessionCookie = "kb_session";
const sessionDurationMs = 8 * 60 * 60 * 1000;
const dummyPasswordHash = hashPassword("constant-timing-placeholder");
const loginAttempts = new Map<string, { count: number; resetAt: number }>();

function publicUser(user: { id: number; username: string; role: string }) {
  return { id: user.id, username: user.username, role: user.role };
}

router.get("/auth/me", (req, res) => {
  const user = getAuthUser(res);
  res.json(
    GetCurrentUserResponse.parse({
      authenticated: Boolean(user),
      user: user ? publicUser(user) : null,
    }),
  );
});

router.post("/auth/login", async (req, res): Promise<void> => {
  const parsed = LoginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const ip = req.ip ?? "unknown";
  const now = Date.now();
  const previousAttempts = loginAttempts.get(ip);
  if (previousAttempts && previousAttempts.resetAt > now && previousAttempts.count >= 10) {
    res.status(429).json({ error: "Слишком много попыток. Подождите 15 минут." });
    return;
  }

  const username = parsed.data.username.trim().toLowerCase();
  const [user] = await db
    .select()
    .from(monitoringUsers)
    .where(eq(monitoringUsers.username, username))
    .limit(1);
  const passwordMatches = verifyPassword(
    parsed.data.password,
    user?.passwordHash ?? dummyPasswordHash,
  );

  if (!user || !passwordMatches) {
    const attempts =
      previousAttempts && previousAttempts.resetAt > now
        ? { count: previousAttempts.count + 1, resetAt: previousAttempts.resetAt }
        : { count: 1, resetAt: now + 15 * 60 * 1000 };
    loginAttempts.set(ip, attempts);
    res.status(401).json({ error: "Неверный логин или пароль" });
    return;
  }

  loginAttempts.delete(ip);
  const token = createSessionToken();
  const expiresAt = new Date(now + sessionDurationMs);
  await db.insert(monitoringSessions).values({
    tokenHash: hashSessionToken(token),
    userId: user.id,
    expiresAt,
  });

  res.cookie(sessionCookie, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: sessionDurationMs,
  });
  res.json(LoginResponse.parse(publicUser(user)));
});

router.post("/auth/logout", async (req, res): Promise<void> => {
  const token = readCookie(req.headers.cookie, sessionCookie);
  if (token) {
    await db
      .delete(monitoringSessions)
      .where(eq(monitoringSessions.tokenHash, hashSessionToken(token)));
  }
  res.clearCookie(sessionCookie, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
  });
  res.sendStatus(204);
});

router.get("/users", requireRole("admin"), async (_req, res): Promise<void> => {
  const users = await db
    .select({
      id: monitoringUsers.id,
      username: monitoringUsers.username,
      role: monitoringUsers.role,
    })
    .from(monitoringUsers)
    .orderBy(monitoringUsers.id);
  res.json(GetUsersResponse.parse(users.map(publicUser)));
});

router.patch(
  "/users/:id",
  requireRole("admin"),
  async (req, res): Promise<void> => {
    const params = UpdateUserRoleParams.safeParse(req.params);
    const body = UpdateUserRoleBody.safeParse(req.body);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    if (!body.success) {
      res.status(400).json({ error: body.error.message });
      return;
    }

    const [target] = await db
      .select()
      .from(monitoringUsers)
      .where(eq(monitoringUsers.id, params.data.id))
      .limit(1);
    if (!target) {
      res.status(404).json({ error: "Пользователь не найден" });
      return;
    }

    if (target.role === "admin" && body.data.role !== "admin") {
      const [{ value: adminCount }] = await db
        .select({ value: count() })
        .from(monitoringUsers)
        .where(eq(monitoringUsers.role, "admin"));
      if (adminCount <= 1) {
        res.status(400).json({ error: "Нельзя убрать роль у последнего администратора" });
        return;
      }
    }

    const [updated] = await db
      .update(monitoringUsers)
      .set({ role: body.data.role })
      .where(eq(monitoringUsers.id, params.data.id))
      .returning({
        id: monitoringUsers.id,
        username: monitoringUsers.username,
        role: monitoringUsers.role,
      });
    res.json(UpdateUserRoleResponse.parse(publicUser(updated)));
  },
);

export default router;
