import { BrandMark } from "@/components/brand/BrandMark";
import { cx } from "@/components/ui/cx";

type CoverImageProps = {
  src: string | null;
  /** Vazio quando o nome do evento já aparece ao lado (imagem decorativa). */
  alt?: string;
  /** Primeira dobra: carrega na hora, com prioridade. */
  priority?: boolean;
  className?: string;
};

/** Capa sempre 16:9; sem capa, mostra a marca do Byla em vez de um bloco vazio. */
export function CoverImage({ src, alt = "", priority = false, className }: CoverImageProps) {
  if (!src) {
    return (
      <div
        aria-hidden
        className={cx(
          "flex aspect-video w-full items-center justify-center bg-gradient-to-br from-byla-navy via-[#0b2552] to-black",
          className,
        )}
      >
        <BrandMark className="object-contain opacity-80" forceDark size={56} />
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      alt={alt}
      className={cx("aspect-video w-full bg-byla-overlay object-cover", className)}
      decoding="async"
      fetchPriority={priority ? "high" : undefined}
      height={1080}
      loading={priority ? "eager" : "lazy"}
      src={src}
      width={1920}
    />
  );
}
