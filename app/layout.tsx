import type { Metadata, Viewport } from "next";
import type { CSSProperties } from "react";
import { companyConfig } from "@/config/company";
import "./globals.css";

export const metadata: Metadata = {
  title: companyConfig.name,
  description: "Рабочий кабинет задач",
  applicationName: companyConfig.name,
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: companyConfig.theme.accent,
};

const t = companyConfig.theme;
const themeStyle = {
  "--am-background": t.background,
  "--am-surface": t.surface,
  "--am-text": t.text,
  "--am-muted-text": t.mutedText,
  "--am-border": t.border,
  "--am-accent": t.accent,
  "--am-accent-foreground": t.accentForeground,
  "--am-danger": t.danger,
  "--am-success": t.success,
  "--am-warning": t.warning,
  "--am-radius": t.radius,
  "--am-font": t.fontFamily,
} as CSSProperties;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang={companyConfig.locale} style={themeStyle}>
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
