import type { StaffLoginStatus } from "@/lib/auth/staff-gate";

export type LoginArea = "equipe" | "organizador";

type AreaConfig = {
  login: string;
  verify: string;
  home: string;
  deviceCookie: string;
  cookiePath: string;
};

/** Cada área tem a sua entrada, a sua tela do código e o seu cookie de aparelho lembrado. */
export const AREAS = {
  equipe: {
    login: "/equipe/login",
    verify: "/equipe/verificar",
    home: "/equipe",
    deviceCookie: "byla_equipe_aparelho",
    cookiePath: "/equipe",
  },
  organizador: {
    login: "/organizador/entrar",
    verify: "/organizador/verificar",
    home: "/organizador",
    deviceCookie: "byla_org_aparelho",
    cookiePath: "/organizador",
  },
} as const satisfies Record<LoginArea, AreaConfig>;

export function isLoginArea(value: unknown): value is LoginArea {
  return value === "equipe" || value === "organizador";
}

export function areaForPath(pathname: string): LoginArea | null {
  for (const area of ["equipe", "organizador"] as const) {
    const home = AREAS[area].home;
    if (pathname === home || pathname.startsWith(`${home}/`)) return area;
  }
  return null;
}

/** Conta de outro tipo (ou tipo desconhecido) conta como "fora" nesta área. */
export function toAreaStatus(status: unknown, kind: unknown, area: LoginArea): StaffLoginStatus {
  if (kind !== area) return "fora";
  return status === "pendente" || status === "verificado" ? status : "fora";
}

/** Para onde mandar quem abre uma página da área; null = pode abrir. */
export function areaRedirectFor(
  area: LoginArea,
  pathname: string,
  status: StaffLoginStatus,
): string | null {
  const { login, verify, home } = AREAS[area];
  if (pathname === login) {
    if (status === "verificado") return home;
    if (status === "pendente") return verify;
    return null;
  }
  if (pathname === verify) {
    if (status === "verificado") return home;
    if (status === "fora") return login;
    return null;
  }
  if (status === "fora") return login;
  if (status === "pendente") return verify;
  return null;
}
