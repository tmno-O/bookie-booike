import { id } from "@/contracts/common";
import { contactInput } from "@/contracts/queue";
import { customerSession } from "@/lib/auth/customer-session";
import { requireSameOrigin } from "@/lib/auth/permissions";
import { body, input, json, route } from "@/lib/http";
import { issueQueueTicket } from "@/server/services/queue-ticket";

export const POST = route<{ venueId: string }>(async (request, params) => {
  requireSameOrigin(request);
  const customer = await customerSession(request, input(id, params.venueId));
  const { ticket, created } = await issueQueueTicket(customer, await body(request, contactInput));
  return json(ticket, { status: created ? 201 : 200 });
});
