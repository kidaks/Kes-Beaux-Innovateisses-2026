import { and, eq, gt } from "drizzle-orm";
import type { NextFunction, Request, Response } from "express";
import {
  db,
  monitoringSessions,
  monitoringUsers,
} from "@workspace/db";
import { hashSessionToken, readCookie } from "../lib/security";

export type AppRole = "guest" | "operator" | "admin";

export interface AuthUser {
  id: number;
  username: string;
  role: AppRole;
}

export async function loadAuthSession(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  res.locals.user = null;
  const token = readCookie(req.headers.cookie, "kb_session");
  if (!token) {
    next();
    return;
  }

  const tokenHash = hashSessionToken(token);
  const [session] = await db
    .select()
    .from(monitoringSessions)
    .where(
      and(
        eq(monitoringSessions.tokenHash, tokenHash),
        gt(monitoringSessions.expiresAt, new Date()),
      ),
    )
    .limit(1);

  if (!session) {
    next();
    return;
  }

  const [user] = await db
    .select({
      id: monitoringUsers.id,
      username: monitoringUsers.username,
      role: monitoringUsers.role,
    })
    .from(monitoringUsers)
    .where(eq(monitoringUsers.id, session.userId))
    .limit(1);

  if (user && ["guest", "operator", "admin"].includes(user.role)) {
    res.locals.user = { ...user, role: user.role as AppRole } satisfies AuthUser;
  }
  next();
}

export function requireRole(...allowedRoles: AppRole[]) {
  return (_req: Request, res: Response, next: NextFunction): void => {
    const user = res.locals.user as AuthUser | null;
    if (!user) {
      res.status(401).json({ error: "Требуется войти в аккаунт" });
      return;
    }
    if (!allowedRoles.includes(user.role)) {
      res.status(403).json({ error: "Недостаточно прав для этого действия" });
      return;
    }
    next();
  };
}

export function getAuthUser(res: Response): AuthUser | null {
  return (res.locals.user as AuthUser | null) ?? null;
}
