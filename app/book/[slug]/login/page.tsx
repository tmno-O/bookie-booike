import { IBM_Plex_Sans_Thai } from "next/font/google";
import LoginScreen from "./login-screen";

const plex = IBM_Plex_Sans_Thai({ subsets: ["thai", "latin"], weight: ["400", "600"] });

export default async function LoginPage({ params }: { params: Promise<{ slug: string }> }) {
  return <div className={plex.className}><LoginScreen slug={(await params).slug} /></div>;
}
