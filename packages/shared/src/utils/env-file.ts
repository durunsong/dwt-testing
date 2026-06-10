export function parseEnvFileContent(content: string): Map<string, string> {
  const values = new Map<string, string>();
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const separator = trimmed.indexOf("=");
    if (separator <= 0) {
      continue;
    }
    const key = trimmed.slice(0, separator).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      continue;
    }
    values.set(key, unquoteEnvValue(trimmed.slice(separator + 1).trim()));
  }
  return values;
}

export function unquoteEnvValue(value: string): string {
  if (value.startsWith("\"") && value.endsWith("\"")) {
    try {
      return JSON.parse(value) as string;
    } catch {
      return value.slice(1, -1);
    }
  }
  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1);
  }
  return value;
}

export function serializeEnvValue(value: string): string {
  if (value === "") {
    return "";
  }
  if (/^[^\s#"'`=]+$/.test(value)) {
    return value;
  }
  return JSON.stringify(value);
}
