import { SQSClient } from "@aws-sdk/client-sqs";
import { env } from "./env";

/** The FIFO queue URL; only valid when QUEUE_DRIVER=sqs. */
export function sqsQueueUrl() {
  const url = env().SQS_QUEUE_URL;
  if (!url) throw new Error("SQS_QUEUE_URL is not configured");
  return url;
}

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
