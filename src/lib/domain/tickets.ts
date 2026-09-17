import { randomUUID } from "crypto";

export function createPublicToken(): string {
  return randomUUID();
}

export function createTicketCode(): string {
  return randomUUID();
}
