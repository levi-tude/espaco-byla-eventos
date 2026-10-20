import { Notice } from "@/components/ui/Notice";

/** Conta fora da área (suspensa, encerrada, da equipe) ou área desligada: nenhum dado. */
export function OrganizerNoAccess({ areaEnabled }: { areaEnabled: boolean }) {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 sm:py-10">
      <Notice live={false} tone="warning">
        {areaEnabled
          ? "Sua conta não tem acesso à área do organizador agora. Fale com a ACDH Eventos."
          : "A área do organizador ainda não está disponível."}
      </Notice>
    </main>
  );
}
