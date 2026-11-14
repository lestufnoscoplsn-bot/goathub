// Limiteurs « au plus N actions par période », en mémoire.
export class Limiter {
  private hits = new Map<string, number[]>();
  private lastSweep = Date.now();

  constructor(private max: number, private windowMs: number) {}

  private recent(key: string): number[] {
    const now = Date.now();
    const list = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (list.length) this.hits.set(key, list);
    else this.hits.delete(key);
    if (now - this.lastSweep > 60_000) {
      this.lastSweep = now;
      for (const [k, v] of this.hits) if (!v.length || now - v[v.length - 1] > this.windowMs) this.hits.delete(k);
    }
    return list;
  }

  /** Vrai si la limite est atteinte (sans compter). */
  blocked(key: string): boolean {
    return this.recent(key).length >= this.max;
  }

  hit(key: string): void {
    const list = this.recent(key);
    list.push(Date.now());
    this.hits.set(key, list);
  }

  /** Compte une action ; renvoie false si la limite est dépassée. */
  take(key: string): boolean {
    if (this.blocked(key)) return false;
    this.hit(key);
    return true;
  }

  reset(key: string): void {
    this.hits.delete(key);
  }
}
