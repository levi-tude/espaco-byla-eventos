import type { Metadata } from "next";
import Link from "next/link";

import { SiteHeader } from "@/components/brand/SiteHeader";
import { LegalContact, LegalSection as Section } from "@/components/legal/LegalSection";
import { BackLink } from "@/components/ui/BackLink";
import { MAX_PEOPLE_PER_ORDER, RESERVATION_MINUTES } from "@/lib/domain/availability";
import { formatMoney } from "@/lib/domain/service-fee";
import { SESSION_SALES_CLOSE_MINUTES } from "@/lib/domain/sessions";
import { COMPANY } from "@/lib/legal/privacy";
import {
  REFUND_PROCESSING_DAYS,
  SCHEDULE_CHANGE_REFUND_MIN_HOURS_BEFORE,
  TERMS_SERVICE_FEE,
  TERMS_UPDATED_LABEL,
  WITHDRAWAL_DAYS,
  WITHDRAWAL_MIN_HOURS_BEFORE,
} from "@/lib/legal/terms";

export const metadata: Metadata = {
  title: "Termos de compra · Espaço Byla Eventos",
  description:
    "Regras de compra, entrada, cancelamento e reembolso dos ingressos do Espaço Byla.",
};

const linkClass = "font-medium text-byla-link underline underline-offset-2";

/** Regra de transferência em seção própria: pode mudar sem tocar no restante dos termos. */
function TicketTransferSection() {
  return (
    <Section title="Transferência do ingresso">
      <ul className="list-disc space-y-2 pl-5">
        <li>
          O ingresso não é nominal: entra quem apresentar o QR Code primeiro.
        </li>
        <li>
          Se você não puder ir, pode passar o ingresso para outra pessoa. Não
          compartilhe o link do pedido nem o QR Code com quem não vai ao evento.
        </li>
      </ul>
    </Section>
  );
}

export default function TermsPage() {
  const contact = <LegalContact />;
  const feePercent = TERMS_SERVICE_FEE.rateBps / 100;
  const feeMin = formatMoney(TERMS_SERVICE_FEE.minCents);

  return (
    <main className="relative flex min-h-full flex-1 flex-col">
      <SiteHeader />
      <article className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
        <p className="text-sm font-semibold text-byla-accent-text">
          Atualizados em {TERMS_UPDATED_LABEL}
        </p>
        <h1 className="mt-1 font-display text-4xl tracking-wide text-foreground sm:text-5xl">
          Termos de compra
        </h1>
        <p className="mt-4 text-base leading-relaxed text-byla-muted">
          Estas são as regras para comprar ingressos dos eventos do {COMPANY.brand}{" "}
          por este site. Ao marcar &ldquo;Li e aceito&rdquo; na compra, você concorda
          com estes termos e com a{" "}
          <Link className={linkClass} href="/privacidade">
            Política de Privacidade
          </Link>
          . Nada aqui tira os direitos garantidos pelo Código de Defesa do
          Consumidor.
        </p>

        <Section title="Quem vende">
          <p>
            {COMPANY.brand} — {COMPANY.legalName}, CNPJ {COMPANY.cnpj},{" "}
            {COMPANY.address}.
          </p>
        </Section>

        <Section title="Compra e pagamento">
          <ul className="list-disc space-y-2 pl-5">
            <li>
              Na página do evento, você escolhe a sessão e os ingressos. Cada
              compra vale para <strong className="text-foreground">uma sessão</strong>{" "}
              e para até {MAX_PEOPLE_PER_ORDER} pessoas.
            </li>
            <li>
              O pagamento é feito aqui mesmo, por PIX ou cartão de crédito, no
              formulário seguro do banco responsável pelo pagamento. Não é
              preciso criar conta.
            </li>
            <li>
              Ao continuar para o pagamento, os lugares ficam reservados por{" "}
              {RESERVATION_MINUTES} minutos. Se você gerar um PIX, a reserva vale
              até o vencimento do código. Sem pagamento nesse prazo, o pedido
              expira e os lugares voltam à venda. Se o cartão for recusado, dá
              para tentar de novo enquanto a reserva valer.
            </li>
            <li>
              A compra só é confirmada quando o banco confirma o pagamento. Aí os
              ingressos chegam no seu e-mail e ficam disponíveis na página do
              pedido.
            </li>
            <li>
              As vendas de cada sessão encerram {SESSION_SALES_CLOSE_MINUTES}{" "}
              minutos depois do horário de início, ou antes, se os ingressos
              acabarem ou a equipe encerrar as vendas.
            </li>
            <li>
              <strong className="text-foreground">Pagou e os lugares acabaram?</strong>{" "}
              Pode acontecer, por exemplo, com um PIX pago depois do prazo com a
              sessão lotada. Você não perde o dinheiro: a equipe fala com você e
              garante o lugar, se houver, ou devolve 100% do valor pago.
            </li>
          </ul>
        </Section>

        <Section title="Taxa de serviço">
          <ul className="list-disc space-y-2 pl-5">
            <li>
              O site pode cobrar uma taxa de serviço de {feePercent}% do preço de
              cada item escolhido (por exemplo, cada Inteira ou cada Casadinha),
              com mínimo de {feeMin} por item. Ela cobre os custos da venda pela
              internet: pagamento, emissão e envio dos ingressos e conferência na
              entrada.
            </li>
            <li>
              A taxa aparece ao lado do preço desde a escolha dos ingressos e no
              resumo, antes de você pagar. Se ela não aparecer, não é cobrada.
            </li>
            <li>
              A taxa é <strong className="text-foreground">devolvida junto</strong>{" "}
              em todo reembolso previsto nestes termos.
            </li>
            <li>Ingressos de cortesia não têm taxa.</li>
          </ul>
        </Section>

        <Section title="Ingressos e entrada">
          <ul className="list-disc space-y-2 pl-5">
            <li>
              Cada pessoa tem o seu ingresso, com um QR Code próprio (uma
              Casadinha gera 2 ingressos; um Pacote família, 4). Cada QR Code vale
              para uma entrada, só na sessão escolhida.
            </li>
            <li>
              Mostre o QR Code no celular ou impresso. Depois de lido na entrada,
              ele não vale de novo.
            </li>
            <li>
              Ingressos de outra sessão ou de sessão cancelada não são aceitos.
            </li>
            <li>
              Regras específicas de cada evento, como classificação etária,
              ficam na página do evento.
            </li>
          </ul>
        </Section>

        <TicketTransferSection />

        <Section title="Meia-entrada">
          <ul className="list-disc space-y-2 pl-5">
            <li>
              Têm direito, conforme a lei: estudantes, pessoas com deficiência (e
              o acompanhante, quando necessário), jovens de 15 a 29 anos de baixa
              renda inscritos no CadÚnico e pessoas com 60 anos ou mais.
            </li>
            <li>
              Na entrada, quem usar ingresso de meia-entrada deve apresentar o
              documento que comprova o direito (por exemplo, carteira de
              estudante, ID Jovem ou cartão do benefício), junto com um documento
              oficial com foto.
            </li>
            <li>
              Sem o comprovante, a entrada só é liberada mediante o pagamento da
              diferença para o valor da inteira, no local. Se a diferença não for
              paga, a entrada não é liberada e não há reembolso.
            </li>
            <li>
              A oferta de meia-entrada segue a lei (Lei nº 12.933/2013 e Decreto
              nº 8.537/2015). Quando os ingressos de meia-entrada de uma sessão
              acabam, a página de compra avisa.
            </li>
            <li>
              A meia-entrada custa metade da inteira da mesma sessão e não se soma
              a outras promoções, como Casadinha ou Pacote família.
            </li>
          </ul>
        </Section>

        <Section title="Sessões, troca de horário e cancelamento">
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <strong className="text-foreground">Troca de data ou horário:</strong>{" "}
              avisamos por e-mail e seus ingressos continuam valendo para o novo
              horário, sem você precisar fazer nada. Se não puder ir no novo
              horário, você pode pedir o reembolso de 100% (com a taxa) até{" "}
              {SCHEDULE_CHANGE_REFUND_MIN_HOURS_BEFORE} horas antes do novo
              horário, pelo contato abaixo.
            </li>
            <li>
              <strong className="text-foreground">Sessão cancelada:</strong>{" "}
              avisamos por e-mail, os ingressos deixam de valer e a equipe devolve
              100% do valor pago (ingressos e taxa), sem você precisar pedir.
            </li>
            <li>
              Se o evento inteiro for cancelado, vale a mesma regra para todas as
              sessões.
            </li>
          </ul>
        </Section>

        <Section title="Desistência e reembolsos">
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <strong className="text-foreground">Desistência:</strong> você pode
              desistir da compra em até {WITHDRAWAL_DAYS} dias corridos depois de
              comprar, desde que o pedido de desistência seja feito com pelo
              menos {WITHDRAWAL_MIN_HOURS_BEFORE} horas de antecedência do início
              da sessão. O reembolso é de 100% do valor pago, incluindo a taxa
              de serviço.
            </li>
            <li>
              Para pedir, escreva para {contact} informando o número do pedido e o
              e-mail usado na compra. O reembolso vale para o pedido inteiro.
            </li>
            <li>
              Pedidos com algum ingresso já usado na entrada não podem ser
              reembolsados.
            </li>
            <li>
              Fora dos casos destes termos (desistência no prazo, troca de data ou
              horário, sessão cancelada ou pagamento sem lugar), não há garantia
              de reembolso. Você pode pedir pelo contato e a equipe analisa caso a
              caso.
            </li>
            <li>
              Fazemos o reembolso em até {REFUND_PROCESSING_DAYS} dias corridos
              depois de aceito o pedido, e você recebe um e-mail de confirmação. O
              valor volta pelo mesmo meio de pagamento: no PIX, para a conta que
              pagou; no cartão, como crédito na fatura, que pode aparecer em uma
              ou duas faturas, conforme o banco do cartão.
            </li>
          </ul>
        </Section>

        <Section title="Contestação no cartão">
          <p>
            Antes de contestar uma compra com o banco do seu cartão, fale com a
            gente: nos casos destes termos, o reembolso é mais rápido por aqui. Se
            houver contestação, o {COMPANY.brand} poderá apresentar ao banco os
            registros da compra, do envio e do uso dos ingressos na entrada.
          </p>
        </Section>

        <Section title="Contato">
          <p>
            Dúvidas, pedidos de reembolso ou problemas com a compra: escreva para{" "}
            {contact}. Responderemos em até 5 dias.
          </p>
        </Section>

        <Section title="Mudanças nestes termos">
          <p>
            Se estes termos mudarem, a nova versão será publicada nesta página,
            com a data de atualização no topo. Cada compra segue a versão aceita
            no momento do pedido.
          </p>
        </Section>

        <p className="mt-10">
          <BackLink href="/">Voltar para os eventos</BackLink>
        </p>
      </article>
    </main>
  );
}
