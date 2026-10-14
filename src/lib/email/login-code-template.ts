import { LOGIN_CODE_TTL_MINUTES } from "@/lib/auth/login-code";

export type LoginCodeEmailContent = {
  subject: string;
  html: string;
  text: string;
};

/** O código vai só no corpo (pré-visualizações de notificação mostram o assunto). */
export function buildLoginCodeEmail({ code }: { code: string }): LoginCodeEmailContent {
  if (!/^[0-9]{6}$/.test(code)) throw new Error("Código de acesso inválido.");

  const subject = "Seu código de acesso - Espaço Byla Eventos";
  const validity = `Ele vale por ${LOGIN_CODE_TTL_MINUTES} minutos e só funciona uma vez.`;
  const warning =
    "Se não foi você que tentou entrar, não passe este código para ninguém: troque sua senha e avise a equipe do Espaço Byla.";

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
                <h1 style="margin:0 0 12px;font-size:22px;line-height:28px;color:#111111;">Seu código de acesso</h1>
                <p style="margin:0 0 16px;font-size:15px;line-height:22px;color:#333333;">Use este código para entrar no painel da equipe:</p>
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

  const text = [
    "Seu código de acesso ao painel da equipe do Espaço Byla Eventos:",
    "",
    code,
    "",
    validity,
    "",
    warning,
  ].join("\n");

  return { subject, html, text };
}
