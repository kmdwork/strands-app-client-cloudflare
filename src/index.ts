import { Hono } from "hono";
import { auth } from "./auth/auth";
import type { AppEnv } from "./auth/types";
import { authMigrationRoutes } from "./routes/auth-migrations";
import { chatRoutes } from "./routes/chat";

const app = new Hono<AppEnv>();

app.use("*", async (c, next) => {
  c.header("X-Request-Id", crypto.randomUUID());
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Referrer-Policy", "no-referrer");
  await next();
});

app.get("/api/health", (c) =>
  c.json({
    status: "ok",
    service: "strands-kamada-hono",
    environment: c.env.ENVIRONMENT,
  }),
);

app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw));

app.route("/internal/auth/migrate", authMigrationRoutes);
app.route("/api/chat", chatRoutes);

app.notFound((c) => c.json({ error: "Not found" }, 404));

app.onError((error, c) => {
  console.error(
    JSON.stringify({
      event: "request_failed",
      method: c.req.method,
      path: c.req.path,
      errorName: error.name,
    }),
  );

  return c.json({ error: "Internal server error" }, 500);
});

export default app;
