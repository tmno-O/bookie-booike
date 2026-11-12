import BookingDemo from "../booking-demo";

export default async function BookingDemoPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const mock = process.env.NODE_ENV !== "production" && process.env.LINE_VERIFY_MODE === "mock";
  return <main><BookingDemo slug={slug} mock={mock} /></main>;
}
