/** An API path with the share key appended as a query parameter, escaped. */
export function apiUrl(path: string, key: string): string {
  return `${path}${path.includes("?") ? "&" : "?"}key=${encodeURIComponent(key)}`;
}
