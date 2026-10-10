export class TimeoutError extends Error {
  override name = 'TimeoutError';
}

/** Rejects with a TimeoutError if the promise has not settled after `ms`. The timer never keeps the process alive. */
export async function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(`${what} took longer than ${ms} ms`)), ms);
    timer.unref();
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
