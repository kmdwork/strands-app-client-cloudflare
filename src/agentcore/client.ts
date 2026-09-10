import { BedrockAgentCoreClient } from "@aws-sdk/client-bedrock-agentcore";

export function createAgentCoreClient(env: Env): BedrockAgentCoreClient {
  return new BedrockAgentCoreClient({
    region: env.AWS_REGION,
    credentials: {
      accessKeyId: env.AWS_ACCESS_KEY_ID,
      secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
    },
  });
}
