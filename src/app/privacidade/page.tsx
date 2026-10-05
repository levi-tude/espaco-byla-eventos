import type { Metadata } from "next";

import { SiteHeader } from "@/components/brand/SiteHeader";
import { LegalContact, LegalSection as Section } from "@/components/legal/LegalSection";
import { BackLink } from "@/components/ui/BackLink";
import {
  COMPANY,
  DATA_RETENTION_YEARS,
  PRIVACY_POLICY_UPDATED_LABEL,
} from "@/lib/legal/privacy";

export const metadata: Metadata = {
  title: "Política de Privacidade · Espaço Byla Eventos",
  description:
    "Como o Espaço Byla trata os dados de quem compra ingressos pelo site.",
};

export default function PrivacyPage() {
  const contact = <LegalContact />;

  return (
    <main className="relative flex min-h-full flex-1 flex-col">
      <SiteHeader />
      <article className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
        <p className="text-sm font-semibold text-byla-accent-text">
          Atualizada em {PRIVACY_POLICY_UPDATED_LABEL}
        </p>
        <h1 className="mt-1 font-display text-4xl tracking-wide text-foreground sm:text-5xl">
          Política de Privacidade
        </h1>
        <p className="mt-4 text-base leading-relaxed text-byla-muted">
          Esta página explica, de forma simples, quais dados pessoais o{" "}
          {COMPANY.brand} recebe quando você compra ingressos por este site, para
          que eles são usados e quais são os seus direitos, conforme a Lei Geral
          de Proteção de Dados (LGPD — Lei nº 13.709/2018).
        </p>

        <Section title="Quem é o responsável pelos seus dados">
          <p>
            {COMPANY.brand} — {COMPANY.legalName}, CNPJ {COMPANY.cnpj},{" "}
            {COMPANY.address}. Para qualquer assunto sobre seus dados, fale com
            a gente por {contact}.
          </p>
        </Section>

        <Section title="Quais dados recebemos">
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <strong className="text-foreground">Na compra:</strong> nome,
              e-mail e, se você quiser informar, telefone.
            </li>
            <li>
              <strong className="text-foreground">No pagamento:</strong> CPF e
              dados do cartão ou do PIX são digitados direto no formulário
              seguro do banco responsável pelo pagamento. O número do cartão
              nunca passa pelos nossos servidores, e o CPF é repassado ao banco
              sem ficar guardado conosco.
            </li>
            <li>
              <strong className="text-foreground">Na entrada do evento:</strong>{" "}
              registramos quando cada ingresso foi usado (leitura do QR Code).
            </li>
            <li>
              <strong className="text-foreground">Para segurança:</strong>{" "}
              dados técnicos da conexão, como o endereço IP, usados para
              bloquear robôs e tentativas de fraude. Guardamos apenas uma versão
              embaralhada (irreversível) do IP, apagada em até 1 dia.
            </li>
          </ul>
        </Section>

        <Section title="Para que usamos">
          <ul className="list-disc space-y-2 pl-5">
            <li>Criar seu pedido, processar o pagamento e emitir os ingressos.</li>
            <li>Enviar os ingressos e avisos sobre o seu pedido por e-mail.</li>
            <li>
              Se você começar uma compra e não concluir o pagamento, enviar{" "}
              <strong className="text-foreground">um único lembrete</strong> por
              e-mail sobre ela. Todo lembrete traz o link &ldquo;Não quero
              receber lembretes&rdquo;; depois de confirmar, você não recebe mais
              nenhum.
            </li>
            <li>Conferir os ingressos na entrada do evento.</li>
            <li>Dar suporte, resolver problemas e prevenir fraudes.</li>
            <li>Cumprir obrigações legais, fiscais e contábeis.</li>
          </ul>
          <p>
            Esses usos se baseiam na execução do contrato de compra, no
            cumprimento de obrigação legal e no legítimo interesse de manter o
            site seguro e de lembrar uma compra não concluída (art. 7º da LGPD).{" "}
            <strong className="text-foreground">
              Não vendemos seus dados e não enviamos propaganda.
            </strong>
          </p>
        </Section>

        <Section title="Com quem compartilhamos">
          <p>Somente com os serviços necessários para o site funcionar:</p>
          <ul className="list-disc space-y-2 pl-5">
            <li>o banco responsável por processar o pagamento;</li>
            <li>o serviço que envia os e-mails com os ingressos;</li>
            <li>o serviço que guarda os pedidos e ingressos com segurança;</li>
            <li>o serviço que hospeda o site.</li>
          </ul>
          <p>
            Alguns desses serviços podem guardar dados fora do Brasil, sempre
            com medidas de segurança adequadas. Também podemos compartilhar
            dados quando a lei ou uma autoridade competente exigir.
          </p>
        </Section>

        <Section title="Por quanto tempo guardamos">
          <p>
            Os dados do pedido ficam guardados por até {DATA_RETENTION_YEARS}{" "}
            anos depois do evento, para suporte e para cumprir obrigações fiscais
            e contábeis. Depois disso, são apagados ou anonimizados.
          </p>
        </Section>

        <Section title="Seus direitos">
          <p>A qualquer momento, você pode pedir para:</p>
          <ul className="list-disc space-y-2 pl-5">
            <li>confirmar se temos dados seus e receber uma cópia;</li>
            <li>corrigir dados incompletos ou errados;</li>
            <li>
              apagar ou anonimizar dados, exceto quando a lei exigir que sejam
              guardados;
            </li>
            <li>saber com quem seus dados foram compartilhados.</li>
          </ul>
          <p>
            Basta escrever para {contact}. Responderemos em até 15 dias. Você
            também pode reclamar na Autoridade Nacional de Proteção de Dados
            (ANPD).
          </p>
        </Section>

        <Section title="Cookies e armazenamento no navegador">
          <p>
            Não usamos cookies de propaganda nem de rastreamento. O site guarda
            no seu navegador apenas a preferência de tema (claro ou escuro). O
            formulário de pagamento do banco e a proteção contra robôs podem
            usar recursos próprios para prevenir fraudes.
          </p>
        </Section>

        <Section title="Segurança">
          <p>
            O site usa conexão criptografada (HTTPS), acesso restrito à equipe
            do {COMPANY.brand} e proteções contra robôs e fraudes. O link do seu
            pedido funciona como uma senha de acesso aos ingressos: não o
            compartilhe com quem não deve entrar no evento.
          </p>
        </Section>

        <Section title="Mudanças nesta política">
          <p>
            Se esta política mudar, a nova versão será publicada nesta página,
            com a data de atualização no topo.
          </p>
        </Section>

        <p className="mt-10">
          <BackLink href="/">Voltar para os eventos</BackLink>
        </p>
      </article>
    </main>
  );
}
