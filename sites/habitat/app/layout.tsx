import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import ThemeToggle from '@/components/ThemeToggle';
import LightKamel from '@/components/LightKamel';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Habitat Numérique | LightKamel',
  description: 'Un espace personnel pour cultiver tes idées. LightKamel est ton guide.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="fr" suppressHydrationWarning>
      <body className={`${inter.className} bg-[var(--ground)] text-[var(--ink)]`}>
        <div className="enveloppe" style={{ width: 'min(78ch, calc(100vw - 40px))', margin: '0 auto' }}>
          <header className="pt-6 pb-4">
            <div className="grecque" style={{ marginBottom: '14px' }}></div>
            <div className="barre flex justify-between items-center gap-4 py-4">
              <div className="marque font-display text-2xl letter-spacing-wider font-bold">
                <span className="text-gold">Light</span>Kamel
              </div>
              <ThemeToggle />
            </div>
          </header>
          <main className="min-h-screen">{children}</main>
          <footer className="border-t border-[var(--rule)] pt-7 pb-14 text-[var(--ink-soft)] text-sm">
            <div className="grecque" style={{ marginBottom: '14px' }}></div>
            <div>Habitat Numérique — Guidé par LightKamel, assoiffé de succès.</div>
          </footer>
        </div>
        <LightKamel />
      </body>
    </html>
  );
}
