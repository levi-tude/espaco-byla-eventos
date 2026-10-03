import QRCode from "qrcode";

const TICKET_QR_OPTIONS = {
  errorCorrectionLevel: "M",
  margin: 2,
  width: 280,
  color: { dark: "#0a0a0b", light: "#ffffff" },
} as const;

/** QR do ingresso: o conteúdo é o código lido pela portaria no check-in. */
export function ticketQrDataUrl(code: string) {
  return QRCode.toDataURL(code, TICKET_QR_OPTIONS);
}

export function ticketQrPng(code: string) {
  return QRCode.toBuffer(code, { ...TICKET_QR_OPTIONS, type: "png" });
}
