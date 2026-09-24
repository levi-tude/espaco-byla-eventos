import type { Metadata } from "next";
import { Bebas_Neue, Open_Sans } from "next/font/google";

import { ThemeProvider } from "@/components/brand/ThemeProvider";
import "./globals.css";

const bylaSans = Open_Sans({
  variable: "--font-byla-sans",
  subsets: ["latin"],
});

const bylaDisplay = Bebas_Neue({
  variable: "--font-byla-display",
  weight: "400",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Espaço Byla Eventos",
  description: "Venda e controle de ingressos para eventos do Espaço Byla",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="pt-BR"
      className={`${bylaSans.variable} ${bylaDisplay.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="flex min-h-full flex-col bg-byla-bg text-foreground">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
