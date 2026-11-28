import type { Metadata, Viewport } from "next";
import type { CSSProperties } from "react";
import { companyConfig } from "@/config/company";
import { loadPublicBranding } from "@/server/settings";
import "./globals.css";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const brand = await loadPublicBranding();
  return {
    title: brand.name,
    description: "Рабочий кабинет задач",
    applicationName: brand.name,
    robots: { index: false, follow: false },
    manifest: "/manifest.webmanifest",
    icons: { icon: "/icon-192.png", apple: "/apple-touch-icon.png" },
    appleWebApp: { capable: true, title: brand.name, statusBarStyle: "default" },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: companyConfig.theme.background,
};

const NAV_SCRIPT = `try{if(localStorage.getItem("am-nav")==="collapsed")document.documentElement.dataset.nav="collapsed"}catch(e){}`;

/** Оформление компании (акцент, шрифт) из «Настройки системы → Компания». */
export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const brand = await loadPublicBranding();
  const style = {
    "--am-accent": brand.accent,
    ...(brand.fontFamily ? { "--am-font": `${brand.fontFamily}, ui-sans-serif, system-ui, sans-serif` } : {}),
  } as CSSProperties;
  return (
    <html lang={companyConfig.locale} style={style} suppressHydrationWarning>
      <head>
        {/* Свёрнутое меню восстанавливается до первой отрисовки, без мигания. */}
        <script dangerouslySetInnerHTML={{ __html: NAV_SCRIPT }} />
      </head>
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
