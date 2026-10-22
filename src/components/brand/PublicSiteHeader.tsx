import { SiteHeader } from "@/components/brand/SiteHeader";
import { organizerAreaPublicHref } from "@/lib/organizer/public-nav";

/** Cabeçalho do site público com botão da área (quando a chave está ligada). */
export async function PublicSiteHeader({ onMedia = false }: { onMedia?: boolean }) {
  const organizerHref = await organizerAreaPublicHref();
  return <SiteHeader onMedia={onMedia} organizerHref={organizerHref} />;
}
