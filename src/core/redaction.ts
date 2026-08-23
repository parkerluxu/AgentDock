export function redactSensitiveText(value: string, secrets: readonly string[]): string {
  let redacted = value;
  for (const secret of secrets) {
    if (secret.length > 0) redacted = redacted.split(secret).join("[REDACTED]");
  }
  return redacted;
}

export function redactSensitiveValue<T>(value: T, secrets: readonly string[]): T {
  if (typeof value === "string") return redactSensitiveText(value, secrets) as T;
  if (Array.isArray(value)) return value.map((item) => redactSensitiveValue(item, secrets)) as T;
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) result[key] = redactSensitiveValue(item, secrets);
    return result as T;
  }
  return value;
}
