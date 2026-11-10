import QRCode from "qrcode";
import { ApiError } from "@/lib/errors";
import { json } from "@/lib/http";
import { staffRoute } from "@/server/staff-route";
import { getVenue } from "@/server/services/venue";

export const GET = staffRoute(async (_request, staff) => {
  const venue = await getVenue(staff);
  if (!venue.liffId) throw new ApiError(409, "LINE_NOT_CONFIGURED", "LINE is not configured");
  const url = `https://liff.line.me/${venue.liffId}`;
  return json({ url, qrSvg: await QRCode.toString(url, { type: "svg" }) });
});
