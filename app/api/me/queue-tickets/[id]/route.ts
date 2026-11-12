import { id } from "@/contracts/common";
import { customerSession } from "@/lib/auth/customer-session";
import { input, json, route } from "@/lib/http";
import { getQueueTicket } from "@/server/services/queue-ticket";

export const GET = route<{ id: string }>(async (request, params) =>
  json(await getQueueTicket(await customerSession(request), input(id, params.id))));
