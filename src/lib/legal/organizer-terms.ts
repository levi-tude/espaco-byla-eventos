import { legalVersionLabel } from "./version-label";

/** Data da versão em vigor; muda sempre que o texto dos Termos do organizador mudar. */
export const ORGANIZER_TERMS_VERSION = "2026-10-19";

export const ORGANIZER_TERMS_UPDATED_LABEL = legalVersionLabel(ORGANIZER_TERMS_VERSION);

export const ORGANIZER_TERMS_PATH = "/termos-organizador";

export const ORGANIZER_TERMS_REQUIRED_MESSAGE =
  "Os Termos do organizador foram atualizados. Aceite a nova versão para continuar.";
