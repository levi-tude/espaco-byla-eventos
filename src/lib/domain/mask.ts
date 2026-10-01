/** "joana@gmail.com" → "j***@gmail.com". */
export function maskEmail(email: string): string {
  const trimmed = email.trim();
  const at = trimmed.lastIndexOf("@");
  if (at < 1 || at === trimmed.length - 1) return "seu e-mail";
  return `${trimmed[0]}***${trimmed.slice(at)}`;
}
