import { Plus_Jakarta_Sans } from "next/font/google";

const jakarta = Plus_Jakarta_Sans({ subsets: ["latin"], variable: "--font-plus-jakarta" });

/** Tipografía del diseño OmniTrack solo para el tablero del administrador. */
export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  return <div className={`${jakarta.variable} font-jakarta`}>{children}</div>;
}
