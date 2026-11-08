/** Nombres de host que cuentan como «esta misma máquina». */
const LOCAL = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

export const isLocalHost = (hostname: string): boolean => LOCAL.has(hostname.toLowerCase());
