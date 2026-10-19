import type { Metadata, Viewport } from 'next';
import './globals.css';

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;

export const metadata: Metadata = {
  title: 'Workout Manager',
  description: '식단, 운동, 인바디 변화를 한곳에서 기록하는 개인 운동 코치',
  applicationName: 'Workout Manager',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'Workout Manager' },
  robots: { index: false, follow: false },
  openGraph: {
    type: 'website',
    title: 'Workout Manager',
    description: '식단 · 운동 · 신체변화를 한곳에서',
    ...(siteUrl ? { url: siteUrl, images: [{ url: new URL('/og.png', siteUrl).toString(), width: 1200, height: 630, alt: 'Workout Manager' }] } : {}),
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Workout Manager',
    description: '식단 · 운동 · 신체변화를 한곳에서',
    ...(siteUrl ? { images: [new URL('/og.png', siteUrl).toString()] } : {}),
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#171a18',
  colorScheme: 'light',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
