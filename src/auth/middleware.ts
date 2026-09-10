import { createMiddleware } from "hono/factory";
import { auth } from "./auth";
import type { AppEnv } from "./types";

export const requireSession = createMiddleware<AppEnv>(async (c, next) => {
  const session = await auth.api.getSession({
    headers: c.req.raw.headers,
  });

  if (session === null) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  c.set("authSession", session);
  await next();
});
