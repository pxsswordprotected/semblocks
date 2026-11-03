import { randomUUID } from "node:crypto";

type InstanceGlobal = typeof globalThis & {
  __aresearchServerInstanceId?: string;
};

export function getServerInstanceId(): string {
  const g = globalThis as InstanceGlobal;
  g.__aresearchServerInstanceId ??= randomUUID();
  return g.__aresearchServerInstanceId;
}
