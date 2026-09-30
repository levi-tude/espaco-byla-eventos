"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/** `false` na renderização do servidor e na hidratação; `true` depois, no navegador. */
export function useMounted() {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
