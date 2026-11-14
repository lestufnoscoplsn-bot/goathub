/** Erreur « normale » dont le message peut être montré à l'utilisateur. */
export class AppError extends Error {
  constructor(message: string, public code = 'error') {
    super(message);
  }
}

export const assert = (condition: unknown, message: string): asserts condition => {
  if (!condition) throw new AppError(message);
};
