export function sameOriginPathUrl(req: Request, pathname: string): URL {
  const origin = req.headers.get("origin");
  if (origin) return new URL(pathname, origin);

  const forwardedHost = req.headers.get("x-forwarded-host");
  if (forwardedHost) {
    const forwardedProto = req.headers.get("x-forwarded-proto") ?? "https";
    return new URL(pathname, `${forwardedProto}://${forwardedHost}`);
  }

  const host = req.headers.get("host");
  if (host) {
    const current = new URL(req.url);
    return new URL(pathname, `${current.protocol}//${host}`);
  }

  return new URL(pathname, req.url);
}
