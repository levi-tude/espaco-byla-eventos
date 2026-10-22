export type PasswordResetEmailContent = {
  subject: string;
  html: string;
  text: string;
};

/** Corpo do e-mail do link de nova senha. Sem nome de fornecedor. */
export function buildPasswordResetEmail({ link }: { link: string }): PasswordResetEmailContent {
  if (!/^https:\/\//.test(link) || link.length > 500) {
    throw new Error("Link de nova senha inválido.");
  }
  const subject = "Link para nova senha - ACDH Eventos";
  const text = [
    "ACDH Eventos",
    "",
    "Você pediu um link para criar uma senha nova.",
    "Abra este link (vale por 24 horas e só uma vez):",
    link,
    "",
    "Se não foi você, ignore este e-mail. Sua senha atual continua valendo.",
  ].join("\n");
  const html = `<!DOCTYPE html><html lang="pt-BR"><body style="font-family:sans-serif;line-height:1.5;color:#111">
<p><strong>ACDH Eventos</strong></p>
<p>Você pediu um link para criar uma senha nova.</p>
<p><a href="${link}">Criar senha nova</a></p>
<p style="color:#555;font-size:14px">Este link vale por 24 horas e só pode ser usado uma vez.</p>
<p style="color:#555;font-size:14px">Se não foi você, ignore este e-mail. Sua senha atual continua valendo.</p>
</body></html>`;
  return { subject, html, text };
}
