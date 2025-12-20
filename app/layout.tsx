import type { Metadata } from "next";
import "./globals.css";
import { ThemeProvider } from "./components/ThemeProvider";
import { SessionProvider } from "./components/SessionProvider";
import { ToastProvider } from "./components/ToastProvider";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { CronInitializer } from "./components/CronInitializer";

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
        <CronInitializer />
        <ErrorBoundary>
          <SessionProvider>
            <ThemeProvider>
              <ToastProvider>
                {children}
              </ToastProvider>
            </ThemeProvider>
          </SessionProvider>
        </ErrorBoundary>
      </body>
    </html>
  );
}
