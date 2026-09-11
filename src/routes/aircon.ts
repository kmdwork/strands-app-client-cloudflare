import { Hono } from "hono";
import { requireSession } from "../auth/middleware";
import type { AppEnv } from "../auth/types";
import {
  getAirconOverview,
  MAX_AIRCON_ROWS,
} from "../repositories/aircon";

export const airconRoutes = new Hono<AppEnv>();

airconRoutes.use("*", requireSession);

airconRoutes.get("/", async (c) => {
  const overview = await getAirconOverview(c.env.AUTH_DB);
  return c.json({ ...overview, limitPerTable: MAX_AIRCON_ROWS });
});
