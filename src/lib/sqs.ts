import { SQSClient } from "@aws-sdk/client-sqs";
import { env } from "./env";

let client: SQSClient | undefined;

export function sqs() {
  const config = env();
  return client ??= new SQSClient({
    region: config.SQS_REGION,
    endpoint: config.SQS_ENDPOINT,
    ...(config.SQS_ENDPOINT && {
      credentials: { accessKeyId: "elasticmq", secretAccessKey: "elasticmq" },
    }),
  });
}
