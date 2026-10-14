import { areaRedirectFor } from "@/lib/auth/area";

export type StaffLoginStatus = "fora" | "pendente" | "verificado";

export const STAFF_LOGIN_PATH = "/equipe/login";
export const STAFF_VERIFY_PATH = "/equipe/verificar";
export const STAFF_HOME_PATH = "/equipe";

export function toStaffLoginStatus(value: unknown): StaffLoginStatus {
  return value === "pendente" || value === "verificado" ? value : "fora";
}

/** Para onde mandar quem abre uma página da equipe; null = pode abrir. */
export function staffRedirectFor(pathname: string, status: StaffLoginStatus): string | null {
  return areaRedirectFor("equipe", pathname, status);
}
