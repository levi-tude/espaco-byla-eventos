import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import {
  areaForPath,
  areaRedirectFor,
  toAreaStatus,
  type LoginArea,
} from "@/lib/auth/area";
import type { StaffLoginStatus } from "@/lib/auth/staff-gate";
import { buildContentSecurityPolicy, createNonce } from "@/lib/security/csp";
import type { Database } from "@/types/database";

const CANONICAL_ORIGIN = "https://acdheventos.com.br";

/** Só estes hosts saem do ar. O destino é fixo: não dá para redirecionar para outro site. */
const REDIRECT_HOSTS = new Set(["ingressos.espacobyla.online", "www.acdheventos.com.br"]);

function requestHostname(request: NextRequest): string {
  const header = request.headers.get("host")?.trim();
  const raw = header ? header : request.nextUrl.host;
  return raw.replace(/:\d+$/, "").toLowerCase();
}

/** Webhook e cron recebem POST e não seguem redirect. */
function skipsHostRedirect(pathname: string): boolean {
  return pathname === "/api/payments/webhook" || pathname.startsWith("/api/cron/");
}

function legacyHostRedirect(request: NextRequest): NextResponse | null {
  if (!REDIRECT_HOSTS.has(requestHostname(request))) return null;
  if (skipsHostRedirect(request.nextUrl.pathname)) return null;
  const destination = `${CANONICAL_ORIGIN}${request.nextUrl.pathname}${request.nextUrl.search}`;
  return NextResponse.redirect(destination, 301);
}

export async function proxy(request: NextRequest) {
  const moved = legacyHostRedirect(request);
  if (moved) return moved;

  const nonce = createNonce();
  const csp = buildContentSecurityPolicy({
    nonce,
    isDev: process.env.NODE_ENV === "development",
    upgradeInsecureRequests: request.nextUrl.protocol === "https:",
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
  });

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-pathname", request.nextUrl.pathname);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const area = areaForPath(request.nextUrl.pathname);
  const response = area
    ? await protectArea(request, requestHeaders, area)
    : NextResponse.next({ request: { headers: requestHeaders } });

  response.headers.set("Content-Security-Policy", csp);
  return response;
}

async function protectArea(request: NextRequest, requestHeaders: Headers, area: LoginArea) {
  let response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => {
            request.cookies.set(name, value);
          });

          response = NextResponse.next({
            request: {
              headers: requestHeaders,
            },
          });

          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // "pendente" = senha certa, falta o código do e-mail. Conta de outra área ou erro em
  // qualquer consulta conta como "fora".
  let status: StaffLoginStatus = "fora";
  if (user) {
    const [state, kind] = await Promise.all([
      supabase.rpc("login_session_state"),
      supabase.rpc("my_account_kind"),
    ]);
    if (!state.error && !kind.error && Array.isArray(state.data)) {
      status = toAreaStatus(state.data[0]?.status, kind.data, area);
    }
  }

  const target = areaRedirectFor(area, request.nextUrl.pathname, status);
  return target ? redirectWithCookies(request, response, target) : response;
}

function redirectWithCookies(
  request: NextRequest,
  response: NextResponse,
  pathname: string,
) {
  const redirectResponse = NextResponse.redirect(new URL(pathname, request.url));

  response.cookies.getAll().forEach((cookie) => {
    redirectResponse.cookies.set(cookie);
  });

  return redirectResponse;
}

// Sem exceção para prefetch: um cabeçalho enviado pelo cliente não pode pular
// a checagem de login da área da equipe.
export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico|txt|xml)$).*)",
  ],
};
