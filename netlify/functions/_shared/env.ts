export function env(name: string): string {
  try {
    const value = Netlify.env.get(name);
    if (value) return value;
  } catch {
    /* Netlify runtime not always present */
  }
  return process.env[name] ?? "";
}
