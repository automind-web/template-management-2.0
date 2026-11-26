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

/** Оформление компании (акцент, шрифт) из «Настройки системы → Компания». */
export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const brand = await loadPublicBranding();
  const style = {
    "--am-accent": brand.accent,
    ...(brand.fontFamily ? { "--am-font": `${brand.fontFamily}, ui-sans-serif, system-ui, sans-serif` } : {}),
  } as CSSProperties;
  return (
    <html lang={companyConfig.locale} style={style}>
      <body className="min-h-dvh text-[15px] antialiased">{children}</body>
    </html>
  );
}
