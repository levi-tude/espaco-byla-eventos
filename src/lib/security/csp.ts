const MERCADO_PAGO_HOSTS = [
  "https://*.mercadopago.com",
  "https://*.mercadopago.com.br",
  "https://*.mercadolibre.com",
  "https://*.mercadolivre.com",
  "https://*.mercadolivre.com.br",
  "https://*.mlstatic.com",
];

export type CspOptions = {
  nonce: string;
  isDev: boolean;
  upgradeInsecureRequests: boolean;
  supabaseUrl?: string;
};

export function createNonce(): string {
  return btoa(crypto.randomUUID());
}

/**
 * Scripts só com nonce ('strict-dynamic' libera o que eles carregam, como o SDK
 * do Mercado Pago). Estilos inline ficam liberados porque o Brick os injeta.
 */
export function buildContentSecurityPolicy({
  nonce,
  isDev,
  upgradeInsecureRequests,
  supabaseUrl,
}: CspOptions): string {
  const mp = MERCADO_PAGO_HOSTS.join(" ");
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    `font-src 'self' data: ${mp}`,
    `connect-src 'self' ${supabaseUrl ?? ""} ${mp}${isDev ? " ws: wss:" : ""}`,
    `frame-src 'self' ${mp}`,
    "worker-src 'self' blob:",
    "media-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ];
  if (upgradeInsecureRequests) directives.push("upgrade-insecure-requests");
  return directives.map((directive) => directive.replace(/\s+/g, " ").trim()).join("; ");
}
