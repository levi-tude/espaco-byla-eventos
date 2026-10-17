import { controlClasses, Field, labelClasses } from "@/components/ui/Field";
import {
  isPixKeyType,
  PIX_KEY_FIELDS,
  PIX_KEY_MAX,
  PIX_KEY_TYPES,
  PIX_TYPE_LABELS,
  pixKeyIsDocument,
  storedPixKey,
} from "@/lib/organizer/pix-key";

type FieldName = "pixKeyType" | "pixKey" | "pixHolderName" | "pixHolderDocument";

type Props = {
  idPrefix: string;
  pixKeyType: string;
  pixKey: string;
  holderName: string;
  holderDocument: string;
  disabled?: boolean;
  onChange: (field: FieldName, value: string) => void;
};

/** Campos de recebimento do cadastro e da troca de chave. A prévia mostra a chave já normalizada. */
export function PixKeyFields({
  idPrefix,
  pixKeyType,
  pixKey,
  holderName,
  holderDocument,
  disabled = false,
  onChange,
}: Props) {
  const field = isPixKeyType(pixKeyType) ? PIX_KEY_FIELDS[pixKeyType] : null;
  const documentIsKey = pixKeyIsDocument(pixKeyType);
  const stored = storedPixKey(pixKeyType, documentIsKey ? holderDocument : pixKey, holderDocument);

  return (
    <>
      <div className="flex flex-col gap-1.5">
        <label className={labelClasses} htmlFor={`${idPrefix}-tipo`}>
          Tipo da chave PIX
        </label>
        <select
          className={`${controlClasses} min-h-12`}
          disabled={disabled}
          id={`${idPrefix}-tipo`}
          name="pixKeyType"
          onChange={(event) => onChange("pixKeyType", event.target.value)}
          required
          value={pixKeyType}
        >
          <option disabled value="">
            Escolha
          </option>
          {PIX_KEY_TYPES.map((type) => (
            <option key={type} value={type}>
              {PIX_TYPE_LABELS[type]}
            </option>
          ))}
        </select>
      </div>
      <Field
        autoComplete="off"
        disabled={disabled}
        hint="Como está no banco: você ou a sua empresa."
        label="Nome do titular"
        maxLength={120}
        minLength={2}
        name="pixHolderName"
        onChange={(event) => onChange("pixHolderName", event.target.value)}
        required
        value={holderName}
      />
      <Field
        autoCapitalize={pixKeyType === "cnpj" ? "characters" : "none"}
        autoComplete="off"
        disabled={disabled}
        hint="CPF ou CNPJ, com ou sem pontos. CNPJ com letras também vale."
        inputMode={pixKeyType === "cpf" ? "numeric" : "text"}
        label="CPF ou CNPJ do titular"
        maxLength={32}
        name="pixHolderDocument"
        onChange={(event) => onChange("pixHolderDocument", event.target.value)}
        placeholder="000.000.000-00 ou 00.000.000/0000-00"
        required
        spellCheck={false}
        value={holderDocument}
      />
      {pixKeyType && !documentIsKey && field ? (
        <Field
          autoCapitalize={field.autoCapitalize}
          autoComplete="off"
          disabled={disabled}
          hint={field.hint}
          inputMode={field.inputMode === "numeric" ? "text" : field.inputMode}
          label="Chave PIX"
          maxLength={PIX_KEY_MAX}
          name="pixKey"
          onChange={(event) => onChange("pixKey", event.target.value)}
          placeholder={field.placeholder}
          required
          spellCheck={false}
          value={pixKey}
        />
      ) : null}
      {documentIsKey && field ? <p className="text-sm text-byla-muted">{field.hint}</p> : null}
      {stored ? (
        <p className="text-sm text-byla-muted">
          Vamos guardar esta chave: <strong className="break-all text-foreground">{stored}</strong>
        </p>
      ) : null}
    </>
  );
}
