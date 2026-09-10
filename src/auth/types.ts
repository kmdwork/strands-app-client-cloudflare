import type { auth } from "./auth";

export type AuthSession = typeof auth.$Infer.Session;

export type AppEnv = {
  Bindings: Env;
  Variables: {
    authSession: AuthSession;
  };
};
