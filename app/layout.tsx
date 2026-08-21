import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Prime Technical 9:15–10:00 Scanner',
  description: 'NIFTY 500 Prime Technical intraday capture scanner',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
