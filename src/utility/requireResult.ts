export type RequireResult<T> =
  | { ok: true; value: T }
  | { ok: false; message: string };
