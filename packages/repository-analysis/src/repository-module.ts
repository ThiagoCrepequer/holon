import { parse, type ParserPlugin } from "@babel/parser";

/** Parse verified snapshot text only; failure supplies no structural proof. */
export function parseRepositoryModule(source: string, path: string) {
  const plugins: ParserPlugin[] = [];
  if (/\.(?:[cm]?ts|tsx)$/iu.test(path)) plugins.push("typescript");
  if (/\.[jt]sx$/iu.test(path)) plugins.push("jsx");
  try {
    return parse(source, {
      sourceType: "module",
      plugins,
      attachComment: false,
    });
  } catch {
    return undefined;
  }
}
