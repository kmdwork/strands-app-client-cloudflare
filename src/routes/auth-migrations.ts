import { getMigrations } from "better-auth/db/migration";
import { Hono } from "hono";
import { auth } from "../auth/auth";
import type { AppEnv } from "../auth/types";

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

export const authMigrationRoutes = new Hono<AppEnv>();

authMigrationRoutes.post("/", async (c) => {
  const hostname = new URL(c.req.url).hostname;
  if (
    String(c.env.ENVIRONMENT) !== "development" ||
    !LOCAL_HOSTNAMES.has(hostname)
  ) {
    return c.json({ error: "Not found" }, 404);
  }

  try {
    const { toBeCreated, toBeAdded, runMigrations } = await getMigrations(
      auth.options,
    );

    if (toBeCreated.length === 0 && toBeAdded.length === 0) {
      return c.json({ message: "No migrations needed" });
    }

    await runMigrations();

    return c.json({
      message: "Migrations completed successfully",
      created: toBeCreated.map(({ table }) => table),
      added: toBeAdded.map(({ table }) => table),
    });
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "auth_migration_failed",
        errorName: error instanceof Error ? error.name : "UnknownError",
      }),
    );

    return c.json(
      {
        error:
          error instanceof Error ? error.message : "Authentication migration failed",
      },
      500,
    );
  }
});
