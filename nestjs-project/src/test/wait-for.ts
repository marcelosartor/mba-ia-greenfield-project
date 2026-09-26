/** Polls `check` until it returns a value other than `undefined`/`false`. */
export async function waitFor<T>(
  check: () => Promise<T | undefined | false>,
  { timeoutMs = 30_000, intervalMs = 100 } = {},
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const result = await check();
    if (result !== undefined && result !== false) {
      return result;
    }
    if (Date.now() >= deadline) {
      throw new Error(`Condition not met within ${timeoutMs} ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
