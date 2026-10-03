export type Tone = "success" | "warning" | "danger" | "info" | "neutral";

/** Texto + fundo + borda de cada tom, com contraste AA nos dois temas. */
export const TONE_CLASSES: Record<Tone, string> = {
  success: "border-byla-success/40 bg-byla-success-bg text-byla-success",
  warning: "border-byla-warning/40 bg-byla-warning-bg text-byla-warning",
  danger: "border-byla-danger/40 bg-byla-danger-bg text-byla-danger",
  info: "border-byla-info/40 bg-byla-info-bg text-byla-info",
  neutral: "border-byla-neutral/30 bg-byla-neutral-bg text-byla-neutral",
};
