import {
  ChangeMessageVisibilityCommand, DeleteMessageCommand, ReceiveMessageCommand, type Message,
} from "@aws-sdk/client-sqs";
import { z } from "zod";
import { id } from "@/contracts/common";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { sqs, sqsQueueUrl } from "@/lib/sqs";

const visibilityTimeout = 60;
const messageBody = z.strictObject({ requestId: id });

export async function receiveBookingMessage(signal?: AbortSignal) {
  const response = await sqs().send(new ReceiveMessageCommand({
    QueueUrl: sqsQueueUrl(),
    MaxNumberOfMessages: 1,
    WaitTimeSeconds: 20,
    VisibilityTimeout: visibilityTimeout,
    MessageSystemAttributeNames: ["ApproximateReceiveCount", "MessageGroupId", "SequenceNumber"],
  }), { abortSignal: signal });
  return response.Messages?.[0];
}

export async function consumeBookingMessage(message: Message) {
  const { ReceiptHandle, Body } = message;
  if (!ReceiptHandle) throw new Error("SQS message has no receipt handle");
  const queueUrl = sqsQueueUrl();
  const acknowledge = () => sqs().send(new DeleteMessageCommand({
    QueueUrl: queueUrl, ReceiptHandle,
  }), { abortSignal: AbortSignal.timeout(8_000) });

  const payload = messageBody.safeParse(parseBody(Body));
  if (!payload.success) {
    console.error("Discarding malformed booking message", message.MessageId);
    await acknowledge();
    return;
  }

  const { requestId } = payload.data;
  const heartbeat = setInterval(() => {
    void sqs().send(new ChangeMessageVisibilityCommand({
      QueueUrl: queueUrl, ReceiptHandle, VisibilityTimeout: visibilityTimeout,
    }), { abortSignal: AbortSignal.timeout(8_000) }).catch(() => {
      console.error("Booking visibility extension failed", requestId);
    });
  }, 20_000);

  try {
    try {
      const [request] = await db().begin(async (tx) => {
        await tx`set local statement_timeout = '45s'`;
        return tx<{ id: string | null }[]>`select id from process_booking_request(${requestId})`;
      });
      if (!request?.id) console.error("Booking message has no matching request", requestId);
    } catch (error) {
      const receives = Number(message.Attributes?.ApproximateReceiveCount ?? 1);
      if (receives < env().BOOKING_MAX_RECEIVES) throw error;
      const [request] = await db()`select status, result_code from reject_booking_request(${requestId}, 'SYSTEM_ERROR')`;
      console.error("Booking exhausted processing retries", requestId, request?.status, request?.resultCode);
    }
  } finally {
    clearInterval(heartbeat);
  }
  await acknowledge();
}

function parseBody(body?: string): unknown {
  try {
    return JSON.parse(body ?? "");
  } catch {
    return null;
  }
}
