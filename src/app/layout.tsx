import type { Metadata } from 'next';
import { Geist, Geist_Mono, Instrument_Serif } from 'next/font/google';
import './globals.css';

const geist = Geist({ subsets: ['latin'], variable: '--font-sans' });
const geistMono = Geist_Mono({ subsets: ['latin'], variable: '--font-mono' });
const instrumentSerif = Instrument_Serif({
  subsets: ['latin'],
  weight: '400',
  style: 'italic',
  variable: '--font-display',
});

export const metadata: Metadata = {
  title: 'Context — Docs to Markdown',
  description: 'Turn any docs site into one clean Markdown file.',
  openGraph: {
    title: 'Context',
    description: 'Turn any docs site into one clean Markdown file.',
    type: 'website',
  },
  twitter: {
    card: 'summary',
    title: 'Context',
    description: 'Turn any docs site into one clean Markdown file.',
  },
  other: {
    'theme-color': '#09090b',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className={`${geist.variable} ${geistMono.variable} ${instrumentSerif.variable} antialiased`}>
        {children}
      </body>
    </html>
  );
}
