function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sanitizeGeminiNode(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeGeminiNode(item));
  }

  if (!isPlainObject(value)) {
    return value;
  }

  const sanitized: Record<string, unknown> = {};

  for (const [key, child] of Object.entries(value)) {
    if (
      key === "type" &&
      Array.isArray(child) &&
      child.length === 2 &&
      child.includes("null")
    ) {
      const nonNullType = child.find((item) => item !== "null");
      sanitized[key] = typeof nonNullType === "string" ? nonNullType : child;
      continue;
    }

    sanitized[key] = sanitizeGeminiNode(child);
  }

  return sanitized;
}

export function sanitizeSchemaForGemini(schema: unknown) {
  return sanitizeGeminiNode(schema);
}
