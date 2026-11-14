export const local = {
  get<T>(key: string, fallback: T): T {
    try {
      const raw = localStorage.getItem(`gh:${key}`);
      return raw === null ? fallback : (JSON.parse(raw) as T);
    } catch {
      return fallback;
    }
  },
  set(key: string, value: unknown) {
    try { localStorage.setItem(`gh:${key}`, JSON.stringify(value)); } catch { /* stockage indisponible */ }
  },
};
