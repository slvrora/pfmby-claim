import { Analytics } from '@vercel/analytics/next'
import type { Metadata, Viewport } from 'next'
import { Noto_Sans_Devanagari } from 'next/font/google'
import './globals.css'

const devanagari = Noto_Sans_Devanagari({ subsets: ['devanagari'], weight: ['400', '500', '600'], variable: '--font-devanagari', display: 'swap' })

export const metadata: Metadata = {
  title: 'KisanSahay | PMFBY 72-Hour Claim Preparation',
  description: 'Prepare a flood crop-loss claim draft in your own language. Record your story, capture field photos, and download an illustrative Kisan claim slip. Independent demo, not an official government portal.',
  generator: 'v0.app',
  icons: {
    icon: [
      {
        url: '/icon-light-32x32.png',
        media: '(prefers-color-scheme: light)',
      },
      {
        url: '/icon-dark-32x32.png',
        media: '(prefers-color-scheme: dark)',
      },
      {
        url: '/icon.svg',
        type: 'image/svg+xml',
      },
    ],
    apple: '/apple-icon.png',
  },
}

export const viewport: Viewport = {
  colorScheme: 'light',
  themeColor: '#294b35',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <body className={`${devanagari.variable} antialiased`}>
        {children}
        {process.env.NODE_ENV === 'production' && <Analytics />}
      </body>
    </html>
  )
}
