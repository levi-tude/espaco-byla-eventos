import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="border-t border-byla-border bg-byla-bg">
      <div className="mx-auto flex w-full max-w-6xl justify-center px-6 py-6 text-xs text-byla-muted">
        <Link
          className="font-medium underline-offset-2 transition hover:text-foreground hover:underline"
          href="/privacidade"
        >
          Política de Privacidade
        </Link>
      </div>
    </footer>
  );
}
