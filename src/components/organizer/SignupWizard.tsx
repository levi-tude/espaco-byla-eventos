"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, type ReactNode, useEffect, useRef, useState, useTransition } from "react";

import {
  checkInvite,
  completeOrganizerSignup,
  sendInviteEmailCode,
  verifyInviteEmailCode,
} from "@/app/convite/actions";
import { startOrganizerLoginAction } from "@/app/organizador/verificar/actions";
import { useHumanCheck } from "@/components/public/HumanCheck";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { controlClasses, Field, labelClasses } from "@/components/ui/Field";
import { Notice } from "@/components/ui/Notice";
import { AREAS } from "@/lib/auth/area";
import { ORGANIZER_TERMS_PATH } from "@/lib/legal/organizer-terms";
import { inviteTokenFromHash } from "@/lib/organizer/invite-token-format";
import { parseEmail, parseOrganizerProfile, parsePassword } from "@/lib/organizer/validation";
import { createClient } from "@/lib/supabase/client";

export const SIGNUP_STEPS = ["Convite", "Seus dados", "E-mail", "Senha", "Recebimento", "Termos", "Pronto"] as const;

const STEP = { convite: 0, dados: 1, email: 2, senha: 3, recebimento: 4, termos: 5, pronto: 6 } as const;

/** O banco aceita 3 envios por convite: o primeiro e mais 2 "Reenviar código". */
const MAX_CODE_SENDS = 3;
/** Só para o texto; quem confere a validade é o banco. */
const SIGNUP_CODE_MINUTES = 15;

const INVITE_INVALID_MESSAGE = "Este convite não vale mais. Peça um novo ao Espaço Byla.";
const NO_TOKEN_MESSAGE = "Abra de novo o link do convite que você recebeu. Se não funcionar, peça um novo ao Espaço Byla.";
const GENERIC_ERROR = "Não foi possível continuar agora. Tente de novo em alguns minutos.";
const TERMS_REQUIRED_MESSAGE = "Marque que leu e aceita os Termos do organizador e a Política de Privacidade.";
export const PASSWORD_HINT =
  "Mínimo de 12 caracteres, com letras e números. Não use seu nome, seu e-mail, sequências como 123456 nem a mesma senha de outro site.";
export const PASSWORD_MISMATCH_MESSAGE = "As senhas não são iguais.";

/**
 * O token vem depois do `#` (o navegador não manda essa parte ao servidor). Lê uma
 * vez e tira o `#` da barra de endereço, para não ficar no histórico nem em print.
 */
export function takeTokenFromLocation(): { present: boolean; token: string | null } {
  const hash = window.location.hash;
  if (!hash) return { present: false, token: null };
  window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}`);
  return { present: true, token: inviteTokenFromHash(hash) };
}

const PIX_TYPES = [
  { value: "cpf", label: "CPF" },
  { value: "cnpj", label: "CNPJ" },
  { value: "email", label: "E-mail" },
  { value: "telefone", label: "Celular" },
  { value: "aleatoria", label: "Chave aleatória" },
] as const;

const PIX_KEY_INPUT: Record<string, { inputMode: "email" | "tel" | "text"; hint: string }> = {
  email: { inputMode: "email", hint: "O e-mail cadastrado como chave PIX." },
  telefone: { inputMode: "tel", hint: "O celular cadastrado como chave PIX, com DDD." },
  aleatoria: { inputMode: "text", hint: "Copie a chave aleatória do aplicativo do seu banco." },
};

type FormState = {
  fullName: string;
  publicName: string;
  phone: string;
  email: string;
  code: string;
  password: string;
  passwordConfirm: string;
  pixKeyType: string;
  pixKey: string;
  pixHolderName: string;
  pixHolderDocument: string;
  terms: boolean;
};

const EMPTY_FORM: FormState = {
  fullName: "",
  publicName: "",
  phone: "",
  email: "",
  code: "",
  password: "",
  passwordConfirm: "",
  pixKeyType: "",
  pixKey: "",
  pixHolderName: "",
  pixHolderDocument: "",
  terms: false,
};

function usesDocumentAsKey(type: string): boolean {
  return type === "cpf" || type === "cnpj";
}

function profileFrom(form: FormState) {
  return {
    fullName: form.fullName,
    publicName: form.publicName,
    phone: form.phone,
    pixKeyType: form.pixKeyType,
    pixKey: usesDocumentAsKey(form.pixKeyType) ? form.pixHolderDocument : form.pixKey,
    pixHolderName: form.pixHolderName,
    pixHolderDocument: form.pixHolderDocument,
  };
}

export function SignupProgress({ step }: { step: number }) {
  const current = step + 1;
  const total = SIGNUP_STEPS.length;
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-byla-muted">
        Passo {current} de {total} · <span className="text-foreground">{SIGNUP_STEPS[step]}</span>
      </p>
      <div
        aria-label="Progresso do cadastro"
        aria-valuemax={total}
        aria-valuemin={1}
        aria-valuenow={current}
        className="h-2 w-full overflow-hidden rounded-full bg-byla-border"
        role="progressbar"
      >
        <div className="h-full rounded-full bg-byla-action transition-all" style={{ width: `${(current / total) * 100}%` }} />
      </div>
      <ol className="sr-only">
        {SIGNUP_STEPS.map((name, index) => (
          <li aria-current={index === step ? "step" : undefined} key={name}>
            {name}
          </li>
        ))}
      </ol>
    </div>
  );
}

function StepTitle({ children }: { children: ReactNode }) {
  return <h2 className="text-xl font-semibold tracking-tight text-foreground">{children}</h2>;
}

/** `terms`: texto completo dos Termos do organizador, renderizado no servidor pela página. */
export function SignupWizard({ terms }: { terms?: ReactNode }) {
  const router = useRouter();
  const humanCheck = useHumanCheck("org_invite");
  const started = useRef(false);
  const token = useRef<string | null>(null);
  const [step, setStep] = useState<number>(STEP.convite);
  const [blocked, setBlocked] = useState("");
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [sends, setSends] = useState(0);
  const [verifiedEmail, setVerifiedEmail] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [next, setNext] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      const { present, token: found } = takeTokenFromLocation();
      if (!found) {
        setBlocked(present ? INVITE_INVALID_MESSAGE : NO_TOKEN_MESSAGE);
        return;
      }
      token.current = found;
      const result = await checkInvite(found).catch(() => null);
      if (result?.ok) setStep(STEP.dados);
      else setBlocked(result?.error ?? INVITE_INVALID_MESSAGE);
    })();
  }, []);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function goTo(target: number) {
    setError("");
    setInfo("");
    setStep(target);
  }

  function run(task: () => Promise<void>) {
    setError("");
    setInfo("");
    startTransition(async () => {
      try {
        await task();
      } catch {
        setError(GENERIC_ERROR);
      }
    });
  }

  async function sendCode(email: string): Promise<boolean> {
    const humanToken = await humanCheck.takeToken();
    const result = await sendInviteEmailCode(token.current ?? "", email, humanToken ?? "");
    if (!result.ok) {
      setError(result.error);
      return false;
    }
    setSends((value) => value + 1);
    update("code", "");
    return true;
  }

  function submitProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = parseEmail(form.email);
    if (!email.ok) {
      setError(email.error);
      return;
    }
    if (email.value === verifiedEmail) {
      goTo(STEP.senha);
      return;
    }
    run(async () => {
      if (await sendCode(email.value)) goTo(STEP.email);
    });
  }

  function resendCode() {
    const email = parseEmail(form.email);
    if (!email.ok) return;
    run(async () => {
      if (await sendCode(email.value)) setInfo(`Enviamos um código novo para ${email.value}.`);
    });
  }

  function submitCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    run(async () => {
      const result = await verifyInviteEmailCode(token.current ?? "", form.code);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const email = parseEmail(form.email);
      setVerifiedEmail(email.ok ? email.value : null);
      goTo(STEP.senha);
    });
  }

  function submitPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const password = parsePassword(form.password, {
      email: verifiedEmail ?? form.email,
      names: [form.fullName, form.publicName],
    });
    if (!password.ok) {
      setError(password.error);
      return;
    }
    if (form.password !== form.passwordConfirm) {
      setError(PASSWORD_MISMATCH_MESSAGE);
      return;
    }
    goTo(STEP.recebimento);
  }

  function submitPayout(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const profile = parseOrganizerProfile(profileFrom(form));
    if (!profile.ok) {
      setError(profile.error);
      return;
    }
    goTo(STEP.termos);
  }

  function submitTerms(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.terms) {
      setError(TERMS_REQUIRED_MESSAGE);
      return;
    }
    run(async () => {
      const result = await completeOrganizerSignup(token.current ?? "", {
        profile: profileFrom(form),
        password: form.password,
        termsAccepted: true,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const password = form.password;
      setForm((current) => ({ ...current, password: "", passwordConfirm: "" }));
      setNext(await signInAfterSignup(result.data.email, password));
      goTo(STEP.pronto);
    });
  }

  return (
    <div className="space-y-6">
      <SignupProgress step={step} />

      {step === STEP.convite ? (
        blocked ? (
          <Notice title="Convite indisponível" tone="danger">
            {blocked}
          </Notice>
        ) : (
          <p className="text-base text-byla-muted" role="status">
            Conferindo o convite…
          </p>
        )
      ) : null}

      {step === STEP.dados ? (
        <form className="grid gap-4" onSubmit={submitProfile}>
          <StepTitle>Seus dados</StepTitle>
          <Field
            autoComplete="name"
            hint="Para a equipe do Espaço Byla falar com você."
            label="Nome completo"
            maxLength={120}
            minLength={2}
            name="fullName"
            onChange={(event) => update("fullName", event.target.value)}
            required
            value={form.fullName}
          />
          <Field
            autoComplete="organization"
            hint="Aparece como “Produção: nome público” na página do evento e no e-mail do ingresso. Pode ser o nome da produtora ou do coletivo."
            label="Nome público"
            maxLength={80}
            minLength={2}
            name="publicName"
            onChange={(event) => update("publicName", event.target.value)}
            required
            value={form.publicName}
          />
          <Field
            autoComplete="tel"
            hint="Com DDD."
            inputMode="tel"
            label="WhatsApp"
            maxLength={20}
            name="phone"
            onChange={(event) => update("phone", event.target.value)}
            required
            type="tel"
            value={form.phone}
          />
          <Field
            autoCapitalize="none"
            autoComplete="email"
            hint="Vamos mandar um código para confirmar. É o e-mail que você vai usar para entrar."
            inputMode="email"
            label="E-mail"
            maxLength={254}
            name="email"
            onChange={(event) => update("email", event.target.value)}
            required
            spellCheck={false}
            type="email"
            value={form.email}
          />
          {humanCheck.slot}
          {error ? <Notice tone="danger">{error}</Notice> : null}
          <Button fullWidth loading={pending} loadingLabel="Enviando…" size="lg" type="submit">
            Continuar
          </Button>
        </form>
      ) : null}

      {step === STEP.email ? (
        <form className="grid gap-4" onSubmit={submitCode}>
          <StepTitle>Confirme seu e-mail</StepTitle>
          <p className="text-base text-byla-muted">
            Enviamos um código de 6 números para{" "}
            <span className="font-medium text-foreground">{form.email.trim().toLowerCase()}</span>. Ele vale por{" "}
            {SIGNUP_CODE_MINUTES} minutos.
          </p>
          <Field
            autoComplete="one-time-code"
            className="text-center font-mono text-2xl tracking-[0.4em]"
            hint="Não chegou? Confira a caixa de spam."
            inputMode="numeric"
            label="Código"
            maxLength={6}
            name="code"
            onChange={(event) => update("code", event.target.value.replace(/\D/g, "").slice(0, 6))}
            pattern="[0-9]{6}"
            placeholder="000000"
            required
            value={form.code}
          />
          {humanCheck.slot}
          {error ? <Notice tone="danger">{error}</Notice> : null}
          {info && !error ? <Notice tone="success">{info}</Notice> : null}
          <Button fullWidth loading={pending} loadingLabel="Conferindo…" size="lg" type="submit">
            Confirmar e-mail
          </Button>
          {sends < MAX_CODE_SENDS ? (
            <Button disabled={pending} fullWidth onClick={resendCode} variant="secondary">
              Reenviar código
            </Button>
          ) : (
            <p className="text-sm text-byla-muted">Se o código não chegar, peça um novo convite ao Espaço Byla.</p>
          )}
          <Button disabled={pending} fullWidth onClick={() => goTo(STEP.dados)} variant="ghost">
            Trocar e-mail
          </Button>
        </form>
      ) : null}

      {step === STEP.senha ? (
        <form className="grid gap-4" onSubmit={submitPassword}>
          <StepTitle>Crie sua senha</StepTitle>
          <input autoComplete="username" hidden name="username" readOnly type="email" value={form.email.trim().toLowerCase()} />
          <Field
            autoComplete="new-password"
            hint={PASSWORD_HINT}
            label="Senha"
            minLength={12}
            name="password"
            onChange={(event) => update("password", event.target.value)}
            required
            type="password"
            value={form.password}
          />
          <Field
            autoComplete="new-password"
            label="Repita a senha"
            minLength={12}
            name="passwordConfirm"
            onChange={(event) => update("passwordConfirm", event.target.value)}
            required
            type="password"
            value={form.passwordConfirm}
          />
          {error ? <Notice tone="danger">{error}</Notice> : null}
          <Button fullWidth size="lg" type="submit">
            Continuar
          </Button>
          <Button fullWidth onClick={() => goTo(STEP.dados)} variant="ghost">
            Voltar
          </Button>
        </form>
      ) : null}

      {step === STEP.recebimento ? (
        <form className="grid gap-4" onSubmit={submitPayout}>
          <StepTitle>Recebimento</StepTitle>
          <Notice live={false} tone="warning">
            O repasse vai para esta chave. O titular precisa ser você ou a sua empresa. Confira com cuidado.
          </Notice>
          <div className="flex flex-col gap-1.5">
            <label className={labelClasses} htmlFor="pix-key-type">
              Tipo da chave PIX
            </label>
            <select
              className={`${controlClasses} min-h-12`}
              id="pix-key-type"
              name="pixKeyType"
              onChange={(event) => update("pixKeyType", event.target.value)}
              required
              value={form.pixKeyType}
            >
              <option disabled value="">
                Escolha
              </option>
              {PIX_TYPES.map((type) => (
                <option key={type.value} value={type.value}>
                  {type.label}
                </option>
              ))}
            </select>
          </div>
          <Field
            autoComplete="off"
            hint="Como está no banco: você ou a sua empresa."
            label="Nome do titular"
            maxLength={120}
            minLength={2}
            name="pixHolderName"
            onChange={(event) => update("pixHolderName", event.target.value)}
            required
            value={form.pixHolderName}
          />
          <Field
            autoComplete="off"
            hint="Só os números ou com pontos, como preferir."
            inputMode="numeric"
            label="CPF ou CNPJ do titular"
            maxLength={18}
            name="pixHolderDocument"
            onChange={(event) => update("pixHolderDocument", event.target.value)}
            required
            value={form.pixHolderDocument}
          />
          {form.pixKeyType && !usesDocumentAsKey(form.pixKeyType) ? (
            <Field
              autoCapitalize="none"
              autoComplete="off"
              hint={PIX_KEY_INPUT[form.pixKeyType]?.hint}
              inputMode={PIX_KEY_INPUT[form.pixKeyType]?.inputMode ?? "text"}
              label="Chave PIX"
              maxLength={77}
              name="pixKey"
              onChange={(event) => update("pixKey", event.target.value)}
              required
              spellCheck={false}
              value={form.pixKey}
            />
          ) : null}
          {usesDocumentAsKey(form.pixKeyType) ? (
            <p className="text-sm text-byla-muted">A chave PIX é o CPF ou CNPJ do titular informado acima.</p>
          ) : null}
          {error ? <Notice tone="danger">{error}</Notice> : null}
          <Button fullWidth size="lg" type="submit">
            Continuar
          </Button>
          <Button fullWidth onClick={() => goTo(STEP.senha)} variant="ghost">
            Voltar
          </Button>
        </form>
      ) : null}

      {step === STEP.termos ? (
        <form className="grid gap-4" onSubmit={submitTerms}>
          <StepTitle>Termos do organizador</StepTitle>
          <div
            aria-label="Termos do organizador"
            className="max-h-80 overflow-y-auto rounded-xl border border-byla-border bg-byla-bg p-4 text-base leading-relaxed text-foreground"
            role="region"
            tabIndex={0}
          >
            <p>
              Os Termos do organizador explicam como funcionam a aprovação dos eventos, as vendas, os
              estornos e o repasse do dinheiro. Leia com calma antes de criar a conta.
            </p>
            <p className="mt-3">
              <Link
                className="inline-flex min-h-11 items-center font-medium text-byla-link underline underline-offset-2"
                href={ORGANIZER_TERMS_PATH}
                rel="noopener"
                target="_blank"
              >
                {terms ? "Abrir os Termos do organizador em outra aba" : "Ler os Termos do organizador"}
              </Link>
            </p>
            <p>
              <Link
                className="inline-flex min-h-11 items-center font-medium text-byla-link underline underline-offset-2"
                href="/privacidade"
                rel="noopener"
                target="_blank"
              >
                Ler a Política de Privacidade
              </Link>
            </p>
            {terms ? <div className="mt-4 border-t border-byla-border pt-4">{terms}</div> : null}
          </div>
          <Checkbox
            checked={form.terms}
            name="terms"
            onChange={(event) => update("terms", event.target.checked)}
            required
          >
            Li e aceito os Termos do organizador e a Política de Privacidade
          </Checkbox>
          {error ? <Notice tone="danger">{error}</Notice> : null}
          <Button fullWidth loading={pending} loadingLabel="Criando sua conta…" size="lg" type="submit">
            Criar minha conta
          </Button>
          <Button disabled={pending} fullWidth onClick={() => goTo(STEP.recebimento)} variant="ghost">
            Voltar
          </Button>
        </form>
      ) : null}

      {step === STEP.pronto ? (
        <div className="grid gap-4">
          <Notice title="Sua conta está pronta. Crie seu primeiro evento." tone="success">
            A cada acesso em um aparelho novo, enviaremos um código para o seu e-mail.
          </Notice>
          {next ? (
            <Button fullWidth onClick={() => router.replace(next)} size="lg">
              Continuar
            </Button>
          ) : (
            <ButtonLink fullWidth href={AREAS.organizador.login} size="lg">
              Entrar
            </ButtonLink>
          )}
        </div>
      ) : null}
    </div>
  );
}

/** Entra logo depois do cadastro; o servidor manda o código do primeiro acesso. */
async function signInAfterSignup(email: string, password: string): Promise<string | null> {
  try {
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return null;
    const started = await startOrganizerLoginAction().catch(() => null);
    if (started?.ok) return started.data.next;
    await supabase.auth.signOut().catch(() => undefined);
    return null;
  } catch {
    return null;
  }
}
