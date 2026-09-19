export interface RedactionOptions {
  /** Additional object keys whose values must be replaced before output. */
  additionalKeys?: readonly string[];
}

const DEFAULT_SENSITIVE_KEYS = new Set([
  "apikey",
  "authorization",
  "credential",
  "password",
  "secret",
  "token",
]);

export function redactSensitiveText(value: string, secrets: readonly string[]): string {
  let redacted = value;
  for (const secret of secrets) {
    if (secret.length > 0) redacted = redacted.split(secret).join("[REDACTED]");
  }
  return redacted;
}

export function redactSensitiveValue<T>(value: T, secrets: readonly string[], options: RedactionOptions = {}): T {
  if (typeof value === "string") return redactSensitiveText(value, secrets) as T;
  if (Array.isArray(value)) return value.map((item) => redactSensitiveValue(item, secrets, options)) as T;
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    const additionalKeys = new Set((options.additionalKeys ?? []).map(normalizeKey));
    for (const [key, item] of Object.entries(value)) {
      result[key] = isSensitiveKey(key, additionalKeys) ? "[REDACTED]" : redactSensitiveValue(item, secrets, options);
    }
    return result as T;
  }
  return value;
}

function isSensitiveKey(key: string, additionalKeys: ReadonlySet<string>): boolean {
  const normalized = normalizeKey(key);
  return DEFAULT_SENSITIVE_KEYS.has(normalized) || additionalKeys.has(normalized);
}

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}
