import "@fontsource-variable/vazirmatn";
import "./globals.css";
import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "راه‌انداز · ایجنت استقرار",
  description: "راه‌انداز: لینک مخزن را بدهید؛ تحلیل، نقشه و هزینه، دیپلوی بعد از تأیید، و رفع خودکار خطا روی لیارا.",
  icons: { icon: "/icon.svg" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f4ef" },
    { media: "(prefers-color-scheme: dark)", color: "#0f1215" },
  ],
};

// Applies a saved theme before paint (no flash).
const themeScript = `try{var t=localStorage.getItem("rz-theme");if(t)document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fa" dir="rtl" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
