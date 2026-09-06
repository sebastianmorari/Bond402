import { Link } from "wouter";

export function PublicFooter() {
  return (
    <footer className="border-t border-border/40 bg-card/30 px-4 py-7 text-sm text-muted-foreground sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 sm:flex-row">
        <p>Bond402 &copy; {new Date().getFullYear()}. Trust-Infrastruktur für zuverlässige APIs.</p>
        <nav aria-label="Rechtliche Informationen" className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
          <Link href="/impressum" className="font-medium text-primary transition-colors hover:text-primary/80 hover:underline">
            Impressum
          </Link>
          <Link href="/datenschutz" className="font-medium text-primary transition-colors hover:text-primary/80 hover:underline">
            Datenschutz
          </Link>
          <Link href="/api-docs" className="font-medium text-primary transition-colors hover:text-primary/80 hover:underline">
            API-Doku
          </Link>
          <Link href="/catalog" className="font-medium text-primary transition-colors hover:text-primary/80 hover:underline">
            Öffentlicher Katalog
          </Link>
          <Link href="/status" className="font-medium text-primary transition-colors hover:text-primary/80 hover:underline">
            Status
          </Link>
        </nav>
      </div>
    </footer>
  );
}