import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'MailFriend',
  description: 'Your friend for understanding everything in your inbox. Pull email correspondence with a sender or company and ask questions of it.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
