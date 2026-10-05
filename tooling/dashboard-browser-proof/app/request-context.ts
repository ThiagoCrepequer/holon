import { createContext } from "react-router";
export const nonceContext = createContext<string>();
export const readsContext = createContext<{ count: number }>();
