import { LOGIN_CODE_TTL_MINUTES, SIGNUP_CODE_TTL_MINUTES } from "@/lib/auth/login-code";

export type LoginCodeEmailContent = {
  subject: string;
  html: string;
  text: string;
};

export type LoginCodePurpose = "equipe" | "organizador" | "cadastro" | "troca_pix";

type PurposeCopy = {
  subject: string;
  title: string;
  usage: string;
  textIntro: string;
  minutes: number;
  warning: string;
};

const LOGIN_WARNING =
  "Se não foi você que tentou entrar, não passe este código para ninguém: troque sua senha e avise a equipe do Espaço Byla.";

const COPY: Record<LoginCodePurpose, PurposeCopy> = {
  equipe: {
    subject: "Seu código de acesso - Espaço Byla Eventos",
    title: "Seu código de acesso",
    usage: "Use este código para entrar no painel da equipe:",
    textIntro: "Seu código de acesso ao painel da equipe do Espaço Byla Eventos:",
    minutes: LOGIN_CODE_TTL_MINUTES,
    warning: LOGIN_WARNING,
  },
  organizador: {
    subject: "Seu código de acesso - Espaço Byla Eventos",
    title: "Seu código de acesso",
    usage: "Use este código para entrar na área do organizador:",
    textIntro: "Seu código de acesso à área do organizador do Espaço Byla Eventos:",
    minutes: LOGIN_CODE_TTL_MINUTES,
    warning: LOGIN_WARNING,
  },
  cadastro: {
    subject: "Seu código do Espaço Byla Eventos",
    title: "Confirme seu e-mail",
    usage: "Use este código para confirmar o seu e-mail no cadastro de organizador:",
    textIntro: "Confirme seu e-mail no cadastro de organizador do Espaço Byla Eventos. Seu código:",
    minutes: SIGNUP_CODE_TTL_MINUTES,
    warning:
      "Se não foi você que pediu este código, não passe ele para ninguém e ignore este e-mail: nenhuma conta será criada sem ele.",
  },
  troca_pix: {
    subject: "Código para trocar a chave PIX - Espaço Byla Eventos",
    title: "Troca da chave PIX",
    usage: "Use este código para pedir a troca da chave PIX dos seus repasses:",
    textIntro: "Código para pedir a troca da chave PIX dos seus repasses no Espaço Byla Eventos:",
    minutes: LOGIN_CODE_TTL_MINUTES,
    warning:
      "Se não foi você que pediu, não passe este código para ninguém: troque sua senha e avise a equipe do Espaço Byla. A chave atual continua valendo.",
  },
};

/** O código vai só no corpo (pré-visualizações de notificação mostram o assunto). */
export function buildLoginCodeEmail({
  code,
  purpose,
}: {
  code: string;
  purpose: LoginCodePurpose;
}): LoginCodeEmailContent {
  if (!/^[0-9]{6}$/.test(code)) throw new Error("Código de acesso inválido.");
  if (!Object.hasOwn(COPY, purpose)) throw new Error("Finalidade do código inválida.");

  const { subject, title, usage, textIntro, minutes, warning } = COPY[purpose];
  const validity = `Ele vale por ${minutes} minutos e só funciona uma vez.`;

  const html = `<!doctype html>
<html lang="pt-BR">
  <body style="margin:0;padding:0;background:#f4f5f7;font-family:Arial,Helvetica,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:24px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:12px;overflow:hidden;">
            <tr>
              <td style="background:#111111;padding:20px 24px;color:#ffffff;font-size:18px;font-weight:bold;">Espaço Byla Eventos</td>
            </tr>
            <tr>
              <td style="padding:28px 24px 8px;">
                <h1 style="margin:0 0 12px;font-size:22px;line-height:28px;color:#111111;">${title}</h1>
                <p style="margin:0 0 16px;font-size:15px;line-height:22px;color:#333333;">${usage}</p>
                <p style="margin:0 0 16px;font-size:34px;line-height:40px;font-weight:bold;letter-spacing:8px;color:#111111;">${code}</p>
                <p style="margin:0 0 12px;font-size:15px;line-height:22px;color:#333333;">${validity}</p>
              </td>
            </tr>
            <tr>
              <td style="padding:8px 24px 28px;">
                <p style="margin:0;font-size:13px;line-height:18px;color:#888888;">${warning}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  const text = [textIntro, "", code, "", validity, "", warning].join("\n");

  return { subject, html, text };
}
