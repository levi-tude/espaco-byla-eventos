import Link from "next/link";
import type { ReactNode } from "react";

import { LegalContact, LegalSection as Section } from "@/components/legal/LegalSection";
import { formatMoney, serviceFeeForPriceAtRate } from "@/lib/domain/service-fee";
import { ORGANIZER_TERMS_UPDATED_LABEL } from "@/lib/legal/organizer-terms";
import { COMPANY } from "@/lib/legal/privacy";
import { TERMS_PATH, TERMS_SERVICE_FEE } from "@/lib/legal/terms";

const linkClass = "font-medium text-byla-link underline underline-offset-2";

/** Exemplo do item 6: um ingresso de R$ 50,00 com a taxa dos Termos de compra. */
const EXAMPLE_TICKET_CENTS = 5000;

function B({ children }: { children: ReactNode }) {
  return <strong className="text-foreground">{children}</strong>;
}

/** Abre em outra aba: no cadastro, sair da página perderia o que já foi preenchido. */
function TextLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link className={linkClass} href={href} rel="noopener" target="_blank">
      {children}
    </Link>
  );
}

/**
 * Texto completo dos Termos do organizador (página pública e passo "Termos" do cadastro).
 * Renderizar no servidor: o e-mail de contato vem de variável de ambiente sem `NEXT_PUBLIC_`.
 */
export function OrganizerTermsText() {
  const contact = <LegalContact />;
  const exampleCardFee = serviceFeeForPriceAtRate(
    EXAMPLE_TICKET_CENTS,
    TERMS_SERVICE_FEE.cardRateBps,
    TERMS_SERVICE_FEE.minCents,
  );
  const examplePixFee = serviceFeeForPriceAtRate(
    EXAMPLE_TICKET_CENTS,
    TERMS_SERVICE_FEE.pixRateBps,
    TERMS_SERVICE_FEE.minCents,
  );

  return (
    <div>
      <p className="text-sm font-semibold text-byla-accent-text">
        Atualizados em {ORGANIZER_TERMS_UPDATED_LABEL}
      </p>
      <p className="mt-4 text-base leading-relaxed text-byla-muted">
        Estes termos valem para quem cria e vende ingressos de eventos próprios pelo site de
        ingressos da {COMPANY.brand} (&ldquo;organizador&rdquo;). Ao marcar &ldquo;Li e
        aceito&rdquo; no cadastro, você concorda com eles e com a{" "}
        <TextLink href="/privacidade">Política de Privacidade</TextLink>. O uso do espaço físico
        (aluguel, datas, horários, equipamentos, limpeza, segurança) segue acordo próprio com a{" "}
        {COMPANY.brand}; estes termos tratam só da venda de ingressos pelo site.
      </p>

      <Section title="1. Quem somos">
        <p>
          {COMPANY.brand} — {COMPANY.legalName}, CNPJ {COMPANY.cnpj}, {COMPANY.address}. Contato:{" "}
          {contact}.
        </p>
      </Section>

      <Section title="2. Sua conta">
        <ul className="list-disc space-y-2 pl-5">
          <li>
            A conta é criada só por convite da {COMPANY.brand}. Ela é pessoal: não compartilhe a
            senha nem o acesso ao seu e-mail.
          </li>
          <li>
            A verificação em duas etapas é obrigatória: ao entrar num aparelho novo, enviamos um
            código ao seu e-mail. Só marque &ldquo;Lembrar este aparelho&rdquo; em aparelho seu. Se
            perder o acesso ao e-mail, fale com a {COMPANY.brand}.
          </li>
          <li>
            No cadastro, confirmamos o seu e-mail com um código. Use um e-mail que você acessa: é por
            ele que avisamos sobre aprovações, pedidos e repasses.
          </li>
          <li>
            Mantenha seus dados e sua chave PIX corretos. Trocar a chave PIX precisa da confirmação
            da {COMPANY.brand} antes do próximo repasse. A troca da chave PIX pode levar até 1 dia
            para ser confirmada.
          </li>
          <li>
            Seu nome público aparece como &ldquo;Produção: &lt;nome público&gt;&rdquo; na página do
            evento e no e-mail do ingresso dos compradores.
          </li>
          <li>
            Você responde pelo que for feito na sua conta. Se suspeitar de uso indevido, avise na
            hora.
          </li>
        </ul>
      </Section>

      <Section title="3. Como o evento vai ao ar">
        <ul className="list-disc space-y-2 pl-5">
          <li>
            Você cria o evento como rascunho e envia para aprovação. O evento só aparece no site e
            vende depois que a {COMPANY.brand} aprova.
          </li>
          <li>
            A {COMPANY.brand} pode recusar um evento, informando o motivo, e pode tirar do ar um
            evento que descumpra estes termos ou a lei.
          </li>
          <li>
            Depois de aprovado, algumas mudanças (nome, local, preço de sessão já vendida, redução
            de lugares, troca de horário, cancelamento de sessão) dependem de nova confirmação da{" "}
            {COMPANY.brand}, porque afetam quem já comprou.
          </li>
        </ul>
      </Section>

      <Section title="4. Eventos que não aceitamos">
        <p>
          Eventos ilegais ou que incentivem crime; discriminação ou discurso de ódio; conteúdo
          sexual explícito; jogos de azar, rifas ou sorteios sem autorização; esquemas de pirâmide
          ou &ldquo;investimento&rdquo;; venda de produtos proibidos; eventos que coloquem pessoas
          em risco; eventos que usem marca, nome ou obra de terceiros sem autorização; e eventos
          com informação enganosa sobre atrações, datas ou preços.
        </p>
      </Section>

      <Section title="5. Ingressos e regras para quem compra">
        <ul className="list-disc space-y-2 pl-5">
          <li>
            Os ingressos seguem os <TextLink href={TERMS_PATH}>Termos de compra</TextLink> do site,
            que valem para todos os eventos: compra, entrada, meia-entrada, troca de horário,
            cancelamento, desistência e reembolso. Você não pode prometer ao comprador regras
            diferentes.
          </li>
          <li>A meia-entrada segue a lei e custa metade da inteira da mesma sessão.</li>
          <li>
            A lotação de cada sessão não pode passar do limite combinado com a {COMPANY.brand}.
          </li>
          <li>
            A venda, o pagamento e os reembolsos são feitos pela {COMPANY.brand}, em nome de quem o
            comprador paga.
          </li>
          <li>
            <B>Cortesias</B> (ingressos gratuitos) são emitidas só pela equipe da {COMPANY.brand}.
            Se precisar, peça pelo WhatsApp informando a sessão, a quantidade e o nome e e-mail de
            cada convidado. Cortesias não entram na conta da sua parte.
          </li>
        </ul>
      </Section>

      <Section title="6. Dinheiro: o que você recebe">
        <ul className="list-disc space-y-2 pl-5">
          <li>
            Todo pagamento cai na conta da {COMPANY.brand} no banco responsável pelo pagamento. A{" "}
            {COMPANY.brand} <B>não cobra comissão</B> sobre as suas vendas.
          </li>
          <li>
            O site pode cobrar do comprador uma <B>taxa de serviço de 10%, com 4% de desconto no
            total para pagamento via Pix</B>, que paga a manutenção do site. Ela é paga pelo
            comprador e <B>não sai da sua parte</B>.
          </li>
          <li>
            O banco responsável pelo pagamento cobra uma <B>tarifa em cada pagamento</B> (PIX ou
            cartão). Essa tarifa <B>sai da taxa de serviço e não da sua parte</B>. Por exemplo: num
            pagamento no cartão de {formatMoney(EXAMPLE_TICKET_CENTS + exampleCardFee)} (ou{" "}
            {formatMoney(EXAMPLE_TICKET_CENTS + examplePixFee)} no Pix), sendo{" "}
            {formatMoney(EXAMPLE_TICKET_CENTS)} de ingresso e a taxa de serviço correspondente, você
            recebe os {formatMoney(EXAMPLE_TICKET_CENTS)}. Como referência, a tarifa do PIX fica em
            torno de 0,99% e a do cartão de crédito em torno de 3,98% a 4,98%, conforme o prazo em
            que o banco libera o dinheiro. No cartão, o parcelamento pode acrescentar juros. Quando
            esses juros reduzem o valor que o banco repassa, eles entram na tarifa e também saem da
            taxa de serviço. Esses percentuais são definidos pelo banco e podem mudar.
          </li>
          <li>
            <B>Sua parte</B> = valor dos ingressos vendidos − estornos − contestações no cartão.
          </li>
          <li>
            No painel do evento você acompanha: vendido, estornos, contestações, sua parte e a
            situação do repasse.
          </li>
        </ul>
      </Section>

      <Section title="7. Repasse">
        <ul className="list-disc space-y-2 pl-5">
          <li>
            A {COMPANY.brand} paga sua parte por PIX, na chave cadastrada,{" "}
            <B>em até 5 dias úteis</B> contados do dia seguinte à última sessão do evento. Dias
            úteis: segunda a sexta, exceto feriados nacionais, o Dois de Julho, os feriados
            municipais de Salvador e a segunda e a terça de Carnaval (dias sem expediente
            bancário). O painel do evento mostra a data-limite já calculada.
          </li>
          <li>
            Ao registrar o pagamento, a {COMPANY.brand} envia um e-mail com valor e data. O
            registro não pode ser apagado.
          </li>
          <li>
            O titular da chave PIX deve ser você (CPF) ou a sua empresa (CNPJ). Pedimos o nome e o
            CPF ou CNPJ do titular no cadastro para conferir isso e para a nossa contabilidade. Se a
            lei exigir, você emite nota fiscal ou recibo do valor recebido.
          </li>
          <li>
            O repasse não espera a conferência da tarifa do banco: ela não muda a sua parte.
          </li>
        </ul>
      </Section>

      <Section title="8. Estornos, contestações e cancelamentos">
        <ul className="list-disc space-y-2 pl-5">
          <li>
            Pedidos de reembolso dos compradores são analisados e feitos pela {COMPANY.brand},
            conforme os <TextLink href={TERMS_PATH}>Termos de compra</TextLink> (por exemplo:
            desistência em até 7 dias da compra e pelo menos 48 horas antes da sessão; troca de
            horário; sessão cancelada; pagamento sem lugar).
          </li>
          <li>
            Você pode pedir o estorno de um pedido do seu evento pelo painel. A {COMPANY.brand}{" "}
            decide e faz o estorno, que devolve 100% ao comprador, incluindo a taxa de serviço.
          </li>
          <li>
            Todo estorno e toda contestação no cartão diminuem a sua parte no valor dos ingressos.
            A tarifa daquele pagamento não é descontada da sua parte: se o banco não devolver a
            tarifa, a ACDH Eventos arca com ela.
          </li>
          <li>
            <B>Estorno ou contestação depois do repasse:</B> o valor é descontado do seu próximo
            repasse. Se em 30 dias não houver repasse que cubra esse valor, você devolve o valor
            por PIX à {COMPANY.brand} em até 10 dias depois do aviso. Enquanto houver devolução
            atrasada, você não consegue enviar evento novo para aprovação.
          </li>
          <li>
            Para cancelar uma sessão ou o evento depois de vender, peça pelo painel. Todos os
            compradores recebem 100% de volta, e não há repasse sobre pedidos estornados.
          </li>
        </ul>
      </Section>

      <Section title="9. Dados dos compradores (LGPD)">
        <ul className="list-disc space-y-2 pl-5">
          <li>
            Você vê nome e e-mail de quem comprou ingressos dos seus eventos, e a situação dos
            pedidos, <B>só para operar o evento</B> (por exemplo, conferir a lista de entrada ou
            avisar sobre uma mudança no evento).
          </li>
          <li>
            É proibido: usar esses dados para propaganda ou para outros eventos sem autorização da
            pessoa; vender, emprestar ou publicar os dados; copiar os dados para listas ou planilhas
            além do necessário para o evento.
          </li>
          <li>Guarde com segurança qualquer cópia e apague em até 90 dias depois do evento.</li>
          <li>
            Se houver vazamento ou acesso indevido, avise a {COMPANY.brand} em até 24 horas.
          </li>
          <li>
            A {COMPANY.brand} é a responsável pelos dados perante os compradores; você atua
            seguindo estas instruções. A {COMPANY.brand} pode suspender o acesso se houver uso
            indevido.
          </li>
        </ul>
      </Section>

      <Section title="10. Portaria">
        <ul className="list-disc space-y-2 pl-5">
          <li>
            Você pode conferir os ingressos dos seus eventos pelo leitor de QR Code do site, com a
            sua conta (ela é pessoal; não há contas extras de portaria). Se precisar de ajuda na
            entrada, combine com a {COMPANY.brand}. Cada QR Code vale uma entrada; o site recusa
            ingressos de outro evento, de outra sessão ou de sessão cancelada.
          </li>
          <li>
            Na entrada, confira o documento de quem usa meia-entrada, conforme os Termos de compra.
          </li>
          <li>Respeite a lotação e as regras de segurança da {COMPANY.brand}.</li>
        </ul>
      </Section>

      <Section title="11. Suas responsabilidades">
        <p>
          Realizar o evento como anunciado; conseguir as autorizações e licenças necessárias (por
          exemplo, direitos autorais de música e classificação etária); informar corretamente
          atrações, datas, horários e restrições; responder pelo conteúdo do evento e pelos seus
          impostos sobre o que receber.
        </p>
      </Section>

      <Section title={`12. Responsabilidades da ${COMPANY.brand}`}>
        <p>
          Manter o site de venda funcionando; receber os pagamentos; enviar os ingressos aos
          compradores; fazer os reembolsos devidos; pagar a sua parte no prazo; dar suporte pelo
          contato acima.
        </p>
      </Section>

      <Section title="13. Excluir um evento">
        <p>
          Sem vendas, você exclui pelo painel. Com vendas, peça a exclusão: as vendas pausam e a{" "}
          {COMPANY.brand} decide; se aceitar, todos os compradores são reembolsados.
        </p>
      </Section>

      <Section title="14. Suspensão e encerramento">
        <ul className="list-disc space-y-2 pl-5">
          <li>
            Você pode encerrar sua conta a qualquer momento, pedindo à {COMPANY.brand}. Eventos
            com vendas precisam acontecer ou ser cancelados com reembolso antes do encerramento.
          </li>
          <li>
            A {COMPANY.brand} pode suspender ou encerrar a conta se você descumprir estes termos ou
            a lei, ou em caso de suspeita de fraude, com aviso e motivo.
          </li>
          <li>
            Valores devidos de eventos já realizados são pagos depois de descontados estornos e
            contestações pendentes.
          </li>
        </ul>
      </Section>

      <Section title="15. Mudanças nestes termos">
        <p>
          Se os termos mudarem, avisaremos no painel e pediremos um novo aceite no próximo acesso.
          Cada evento segue a versão aceita quando ele foi enviado para aprovação.
        </p>
      </Section>

      <Section title="16. Foro">
        <p>Fica eleito o foro de Salvador – BA.</p>
      </Section>
    </div>
  );
}
