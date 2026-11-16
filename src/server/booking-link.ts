import QRCode from "qrcode";

export async function bookingLinks(origin: string, slug: string, liffId: string | null) {
  const webUrl = new URL(`/book/${encodeURIComponent(slug)}`, origin).href;
  const url = liffId ? `https://liff.line.me/${liffId}` : null;
  const [webQrSvg, qrSvg] = await Promise.all([
    QRCode.toString(webUrl, { type: "svg" }),
    url ? QRCode.toString(url, { type: "svg" }) : null,
  ]);
  return { slug, webUrl, webQrSvg, url, qrSvg };
}
