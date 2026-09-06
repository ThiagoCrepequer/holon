import { useSyncExternalStore } from "react";

export const subscribe = () => () => undefined;
export const getClientSnapshot = () => true;
export const getServerSnapshot = () => false;

export function useHydrated(): boolean {
  return useSyncExternalStore(subscribe, getClientSnapshot, getServerSnapshot);
}
