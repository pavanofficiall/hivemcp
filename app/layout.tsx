import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'Hive · Application intelligence',
  description:
    'Understand existing applications and expose approved business capabilities to any compatible agent.',
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
