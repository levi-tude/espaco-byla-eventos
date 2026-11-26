import Link from "next/link";

import { MEIA_ENTRADA_TERMS_HREF } from "@/lib/legal/terms";

const linkClass = "font-medium text-byla-link underline underline-offset-2";

/** Bloco genérico de regras da meia-entrada na página pública do evento. */
export function MeiaEntradaInfo() {
  return (
    <section
      aria-labelledby="meia-entrada-titulo"
      className="mt-8 rounded-2xl border border-byla-border bg-byla-surface p-5 sm:p-6"
    >
      <h2 className="text-lg font-semibold text-foreground" id="meia-entrada-titulo">
        Meia-entrada
      </h2>
      <p className="mt-3 text-base leading-7 text-byla-muted">
        A meia é metade da inteira e não se soma a outras promoções.
      </p>
      <p className="mt-4 text-base font-semibold text-foreground">Têm direito:</p>
      <ul className="mt-2 list-disc space-y-2 pl-5 text-base leading-7 text-foreground">
        <li>
          Estudantes do ensino fundamental, médio ou superior,{" "}
          <span className="text-byla-muted">com a CIE ou com a carteira de estudante oficial da Bahia</span>
        </li>
        <li>
          Pessoas com deficiência{" "}
          <span className="text-byla-muted">e 1 acompanhante, quando necessário</span>
        </li>
        <li>
          Pessoas com 60 anos ou mais, <span className="text-byla-muted">com RG</span>
        </li>
        <li>
          Professores e profissionais da educação, de escola pública ou privada, na ativa ou
          aposentados,{" "}
          <span className="text-byla-muted">com contracheque ou crachá funcional + RG</span>
        </li>
      </ul>
      <p className="mt-4 text-base leading-7 text-foreground">
        Regras para crianças, quando houver, estão na descrição de cada evento.
      </p>
      <div className="mt-5 rounded-xl border border-byla-border bg-byla-overlay px-4 py-3">
        <p className="text-sm font-semibold uppercase tracking-wide text-byla-accent-text">
          Na entrada
        </p>
        <p className="mt-1 text-base leading-7 text-foreground">
          Leve o comprovante e um documento com foto.
        </p>
      </div>
      <div className="mt-3 rounded-xl bg-byla-warning-bg px-4 py-3 text-foreground">
        <p className="text-sm font-semibold uppercase tracking-wide text-byla-warning">
          Sem comprovante
        </p>
        <p className="mt-1 text-base leading-7">
          Você paga a diferença da inteira no local. Se não pagar, não entra e não há reembolso.
        </p>
      </div>
      <p className="mt-5 text-base">
        <Link className={linkClass} href={MEIA_ENTRADA_TERMS_HREF}>
          Ver regras completas nos Termos de compra
        </Link>
      </p>
    </section>
  );
}
