/** Query na tela do código quando o primeiro envio falhou. */
export const LOGIN_CODE_NOTICE_QUERY = "aviso";
export const LOGIN_CODE_NOTICE_VALUE = "envio";

export function loginVerifyPathWithNotice(verifyPath: string, notice?: string): string {
  if (!notice) return verifyPath;
  const url = new URL(verifyPath, "https://local.test");
  url.searchParams.set(LOGIN_CODE_NOTICE_QUERY, LOGIN_CODE_NOTICE_VALUE);
  return `${url.pathname}${url.search}`;
}

export function loginCodeNoticeFromSearch(
  searchParams: { [key: string]: string | string[] | undefined },
  message: string,
): string | undefined {
  const raw = searchParams[LOGIN_CODE_NOTICE_QUERY];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value === LOGIN_CODE_NOTICE_VALUE ? message : undefined;
}
