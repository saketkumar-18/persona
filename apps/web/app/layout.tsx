import type { Metadata, Viewport } from 'next';
import './globals.css';
import { ThemeProvider } from '../components/theme-provider';
import ServiceWorkerRegister from '../components/service-worker-register';

export const metadata: Metadata = {
  title: 'GhostLink — Anonymous, ephemeral connections',
  description:
    'Meet people nearby or anywhere without accounts. Temporary sessions, encrypted chats, no history.',
  applicationName: 'GhostLink',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'GhostLink',
  },
  icons: {
    icon: '/icons/icon-192.png',
    apple: '/icons/icon-192.png',
  },
  other: {
    'mobile-web-app-capable': 'yes',
  },
};

export const viewport: Viewport = {
  themeColor: '#1a1035',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <ThemeProvider>
          {children}
          <ServiceWorkerRegister />
        </ThemeProvider>
      </body>
    </html>
  );
}
