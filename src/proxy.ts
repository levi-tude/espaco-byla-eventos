import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import {
  staffRedirectFor,
  toStaffLoginStatus,
  type StaffLoginStatus,
} from "@/lib/auth/staff-gate";
import { buildContentSecurityPolicy, createNonce } from "@/lib/security/csp";
import type { Database } from "@/types/database";

export async function proxy(request: NextRequest) {
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

  const response = request.nextUrl.pathname.startsWith("/equipe")
    ? await protectStaffArea(request, requestHeaders)
    : NextResponse.next({ request: { headers: requestHeaders } });

  response.headers.set("Content-Security-Policy", csp);
  return response;
}

async function protectStaffArea(request: NextRequest, requestHeaders: Headers) {
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

  // "pendente" = senha certa, falta o código do e-mail. Erro na consulta conta como "fora".
  let status: StaffLoginStatus = "fora";
  if (user) {
    const { data, error } = await supabase.rpc("login_session_state");
    if (!error && Array.isArray(data)) status = toStaffLoginStatus(data[0]?.status);
  }

  const target = staffRedirectFor(request.nextUrl.pathname, status);
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
