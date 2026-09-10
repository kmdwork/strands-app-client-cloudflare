import { env } from "cloudflare:workers";
import { betterAuth } from "better-auth";

export const auth = betterAuth({
  appName: "Strands Kamada",

  database: env.AUTH_DB,
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,

  trustedOrigins: [env.BETTER_AUTH_URL],

  emailAndPassword: {
    enabled: true,
    disableSignUp: true,
    minPasswordLength: 8,
    maxPasswordLength: 128,
    requireEmailVerification: false,
  },

  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
  },
});

export default auth;
