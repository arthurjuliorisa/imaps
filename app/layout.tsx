import type { Metadata } from "next";
import "./globals.css";
import { ThemeProvider } from "./components/ThemeProvider";
import { SessionProvider } from "./components/SessionProvider";
import { ToastProvider } from "./components/ToastProvider";
import { ErrorBoundary } from "./components/ErrorBoundary";

// Server-side initialization: Initialize cron service on app startup
// This runs once per server startup, not per request
async function initAppServices() {
  try {
    if (typeof window === 'undefined') {
      // Only run on server-side
      const { initializeCronService } = await import('@/lib/services/cron.service');
      await initializeCronService();
    }
  } catch (error) {
    // Silently continue - cron initialization is not critical for app load
    console.error('[App] Failed to initialize cron service:', error instanceof Error ? error.message : error);
  }
}

// Call initialization on module load
initAppServices().catch(err => {
  console.error('[App] Error during service initialization:', err);
});

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
