export function sanitizeUrlForLogging(value: string): string {
  try {
    const url = new URL(value);
    const query = url.search ? "?[redacted]" : "";
    return `${url.origin}${url.pathname}${query}${url.hash}`;
  } catch {
    return value.replace(/\?.*$/, "?[redacted]");
  }
}
