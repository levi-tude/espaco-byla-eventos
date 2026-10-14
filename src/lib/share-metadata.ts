import type { Metadata } from "next";

export const SITE_NAME = "Espaço Byla Eventos";
export const SITE_DESCRIPTION = "Ingressos para os eventos do Espaço Byla";

export const SHARE_IMAGE = {
  url: "/brand/og-espaco-byla.png",
  width: 1200,
  height: 630,
  alt: "Logo do Espaço Byla",
};

type ShareImage = { url: string; width?: number; height?: number; alt: string };

/**
 * Prévia de links (WhatsApp, Instagram etc.). O `openGraph` de uma página substitui
 * o do layout inteiro, então nome do site e imagem padrão vão sempre juntos.
 */
export function shareMetadata({
  title,
  description,
  path,
  image = SHARE_IMAGE,
}: {
  title: string;
  description: string;
  path?: string;
  image?: ShareImage;
}): Pick<Metadata, "openGraph" | "twitter"> {
  return {
    openGraph: {
      type: "website",
      locale: "pt_BR",
      siteName: SITE_NAME,
      title,
      description,
      ...(path ? { url: path } : {}),
      images: [image],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [image.url],
    },
  };
}
