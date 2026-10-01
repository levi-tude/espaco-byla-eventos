const PUBLIC_TOKEN_PATTERN = /^[A-Za-z0-9_-]{1,100}$/;

/** Formato do token público do pedido (link `/pedidos/<token>`). */
export function isPublicTokenFormat(value: unknown): value is string {
  return typeof value === "string" && PUBLIC_TOKEN_PATTERN.test(value);
}

export function resumeCheckoutPath(eventSlug: string, publicToken: string): string {
  return `/eventos/${encodeURIComponent(eventSlug)}/checkout?retomar=${encodeURIComponent(publicToken)}`;
}
