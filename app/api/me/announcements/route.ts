import { customerSession } from "@/lib/auth/customer-session";
import { json, route } from "@/lib/http";
import { customerAnnouncements } from "@/server/services/announcements";

export const GET = route(async (request) => json(await customerAnnouncements(await customerSession(request))));
