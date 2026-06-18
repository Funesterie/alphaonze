const SENSITIVE_PARAM_RE = /(?:^|[\s?&#;])(?:token|access[_-]?token|auth|authorization|signature|sig|key|api[_-]?key|jwt|secret)=\S*/gi;
const GENERIC_DOWNLOAD_NAME_RE = /^(?:download|file|resource|media|blob|asset)$/i;

function decodeName(value: string) {
  try {
    return decodeURIComponent(value.replace(/\+/g, " "));
  } catch {
    return value;
  }
}

function trimUrlParts(value: string) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const parsed = new URL(raw, "https://a11.local.invalid");
    const pathName = parsed.pathname.replace(/\\/g, "/");
    const leaf = pathName.split("/").filter(Boolean).pop() || "";
    return leaf || raw.split(/[?#]/)[0];
  } catch {
    return raw.split(/[?#]/)[0];
  }
}

export function sanitizeMediaDisplayName(value: unknown, fallback = "reference") {
  const safeFallback = fallback === undefined || fallback === null ? "reference" : String(fallback).trim();
  const raw = String(value || "").trim();
  if (!raw) return safeFallback;

  const withoutQuery = trimUrlParts(raw);
  const leaf = withoutQuery.replace(/\\/g, "/").split("/").filter(Boolean).pop() || withoutQuery;
  const decoded = decodeName(leaf)
    .replace(SENSITIVE_PARAM_RE, " ")
    .replace(/[<>:"|?*]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^-+|-+$/g, "");

  if (!decoded || GENERIC_DOWNLOAD_NAME_RE.test(decoded)) return safeFallback;
  return decoded.length > 96 ? `${decoded.slice(0, 93).trim()}...` : decoded;
}

export function sanitizeMediaDisplayNameFromUrl(value: unknown, fallback = "reference") {
  return sanitizeMediaDisplayName(value, fallback);
}
