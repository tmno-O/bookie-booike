import WaitingScreen from "./waiting-screen";

// Step 2 of 4 — waiting for booking to open (Figma "02 · รอเวลาเปิดจอง", node 169:394)
export const metadata = { title: "รอเปิดจอง" };

export default async function WaitingPage({ params }: { params: Promise<{ slug: string }> }) {
  return <WaitingScreen slug={(await params).slug} />;
}
