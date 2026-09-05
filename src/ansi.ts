/**
 * Minimal ANSI escape-code helpers — zero dependencies.
 */

export const ESC = "\u001b[";
export const RESET = `${ESC}0m`;

/** True when the current terminal is likely to support color. */
export function supportsColor(): boolean {
  if (process.env.NO_COLOR !== undefined) return false;
  if (process.env.CODESHARK_NO_COLOR !== undefined) return false;
  if (process.env.TERM === "dumb") return false;
  if (process.platform === "win32" && !process.env.TERM) return false;
  return true;
}

/** Style `text` with a foreground RGB color: hex("#d96b43", "x"). */
export function hex(hexColor: string, text: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hexColor.trim());
  if (!m) throw new Error(`Invalid hex color: ${hexColor}`);
  const n = parseInt(m[1]!, 16);
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  return `${ESC}38;2;${r};${g};${b}m${text}${RESET}`;
}

/** Style `text` with a background RGB color. */
export function hexBg(hexColor: string, text: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hexColor.trim());
  if (!m) throw new Error(`Invalid hex color: ${hexColor}`);
  const n = parseInt(m[1]!, 16);
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  return `${ESC}48;2;${r};${g};${b}m${text}${RESET}`;
}

export function bold(text: string): string {
  return `${ESC}1m${text}${RESET}`;
}

export function dim(text: string): string {
  return `${ESC}2m${text}${RESET}`;
}

export function underline(text: string): string {
  return `${ESC}4m${text}${RESET}`;
}

/** Remove ANSI escape sequences (useful for tests / piping). */
export function stripAnsi(text: string): string {
  return text.replace(/\u001b\[[0-9;]*m/g, "");
}