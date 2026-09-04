import { BarChart3, Code2, UserRound } from "lucide-react";
import { Link, useLocation } from "wouter";

const items = [
  { href: "/dashboard", label: "Dashboard", icon: BarChart3 },
  { href: "/developer", label: "Developer", icon: Code2 },
  { href: "/profile", label: "Profil", icon: UserRound },
];

export function MobileNav() {
  const [location] = useLocation();

  return (
    <nav
      aria-label="Mobile Navigation"
      className="fixed inset-x-3 bottom-3 z-30 grid grid-cols-3 rounded-2xl border border-border/70 bg-card/95 p-1.5 shadow-2xl shadow-black/30 backdrop-blur-md md:hidden"
    >
      {items.map(({ href, label, icon: Icon }) => {
        const active = location === href;
        return (
          <Link
            key={href}
            href={href}
            className={`flex min-h-12 flex-col items-center justify-center gap-1 rounded-xl text-[11px] font-medium transition-colors ${
              active ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-muted/70 hover:text-foreground"
            }`}
          >
            <Icon className="h-4 w-4" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}