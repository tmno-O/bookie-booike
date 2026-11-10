import { IBM_Plex_Sans_Thai } from "next/font/google";
import AdminLogin from "./admin-login";

const plex = IBM_Plex_Sans_Thai({ subsets: ["thai", "latin"], weight: ["400", "600"] });

export default function AdminLoginPage() {
  return <div className={plex.className}><AdminLogin /></div>;
}
