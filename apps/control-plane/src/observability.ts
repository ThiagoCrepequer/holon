export type LogValue = boolean | number | string | undefined;

export interface StructuredLogger {
  emit(event: string, fields: Readonly<Record<string, LogValue>>): void;
}

export const consoleLogger: StructuredLogger = {
  emit(event, fields) {
    console.log(JSON.stringify({ event, ...fields }));
  },
};

export function errorKind(error: unknown): string {
  return error instanceof Error && error.name.length > 0
    ? error.name
    : "UnknownError";
}
