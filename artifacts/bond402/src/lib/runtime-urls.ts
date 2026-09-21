function appBaseUrl(): URL {
  const configuredBase = import.meta.env.BASE_URL || "/";
  return new URL(configuredBase, window.location.origin);
}

/**
 * Resolve the public MCP route from the same browser-visible base path as the
 * app. This keeps preview, mounted and published URLs consistent without
 * exposing an internal API-server address.
 */
export function getMcpEndpoint(): string {
  const base = appBaseUrl();
  return new URL("mcp", base).toString();
}