import type { Metadata } from "next";
import "./globals.css";
import { ThemeProvider } from "./components/ThemeProvider";
import { SessionProvider } from "./components/SessionProvider";

export const metadata: Metadata = {
  title: "iMAPS - Inventory Management & Production System",
  description: "Manufacturing Process, Inventory Stocks, and Customs Report Management System",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <SessionProvider>
          <ThemeProvider>
            {children}
          </ThemeProvider>
        </SessionProvider>
      </body>
    </html>
  );
}
