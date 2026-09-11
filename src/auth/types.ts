import type { auth } from "./auth";
import type { AgentTokenClaims } from "./agent-token";

export type AuthSession = typeof auth.$Infer.Session;

export type AppEnv = {
  Bindings: Env;
  Variables: {
    authSession: AuthSession;
    agentClaims: AgentTokenClaims;
  };
};
