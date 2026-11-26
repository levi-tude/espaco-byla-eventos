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
        A meia custa metade da inteira da mesma sessão e não se soma a outras promoções, como
        Casadinha ou Pacote família.
      </p>
      <ul className="mt-4 list-disc space-y-2 pl-5 text-base leading-7 text-foreground">
        <li>
          Estudantes, <span className="text-byla-muted">com a CIE oficial</span>
        </li>
        <li>
          Pessoas com deficiência{" "}
          <span className="text-byla-muted">e 1 acompanhante, quando necessário</span>
        </li>
        <li>
          Jovens de 15 a 29 anos de baixa renda,{" "}
          <span className="text-byla-muted">com ID Jovem (CadÚnico)</span>
        </li>
        <li>
          Pessoas com 60 anos ou mais,{" "}
          <span className="text-byla-muted">com RG ou documento oficial com foto</span>
        </li>
        <li>
          Professores e profissionais da educação,{" "}
          <span className="text-byla-muted">com contracheque ou identidade funcional + RG</span>
          <span className="mt-1 block text-sm leading-6 text-byla-muted">
            Magistério e profissionais de escolas de todos os níveis, da rede pública ou privada, na
            ativa ou aposentados. Lei BA 14.765/2024 e Lei Salvador 9.763/2023.
          </span>
        </li>
      </ul>
      <div className="mt-5 rounded-xl border border-byla-border bg-byla-overlay px-4 py-3">
        <p className="text-sm font-semibold uppercase tracking-wide text-byla-accent-text">
          Documento obrigatório na entrada
        </p>
        <p className="mt-1 text-base leading-7 text-foreground">
          Leve o comprovante do direito e um documento oficial com foto.
        </p>
      </div>
      <div className="mt-3 rounded-xl bg-byla-warning-bg px-4 py-3 text-foreground">
        <p className="text-sm font-semibold uppercase tracking-wide text-byla-warning">
          Sem o comprovante
        </p>
        <p className="mt-1 text-base leading-7">
          A entrada só é liberada se você pagar a diferença da inteira no local. Sem o pagamento,
          não entra e não há reembolso.
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
