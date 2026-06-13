import type { Metadata } from "next";
import { Cairo } from "next/font/google";
import "./globals.css";
import { AppProviders } from "@/providers/app-providers";

const cairo = Cairo({
  subsets: ["arabic", "latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-cairo",
  display: "swap",
});

export const metadata: Metadata = {
  title: "KDR — لوحة تحكم مطاعم كفر الدوار",
  description: "لوحة داخلية احترافية لإدارة المطاعم والطلبات والمستخدمين.",
  icons: {
    icon: "/icon.png",
  },
};

const themeScript = `(function(){try{var t=localStorage.getItem('kdr-theme');if(!t){t=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}if(t==='dark'){document.documentElement.classList.add('dark');document.documentElement.style.colorScheme='dark';}}catch(e){}})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ar-EG" dir="rtl" className={cairo.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="font-sans" suppressHydrationWarning>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
