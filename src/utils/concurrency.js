/**
 * Run `worker` over `items` with at most `concurrency` in flight at once.
 * Per-item failures are captured rather than aborting the whole pool.
 * Returns results in the same order as `items`.
 */
export async function runPool(items, worker, concurrency = 5) {
  const results = new Array(items.length);
  let cursor = 0;

  async function runNext() {
    while (cursor < items.length) {
      const index = cursor++;
      try {
        results[index] = { ok: true, value: await worker(items[index], index) };
      } catch (error) {
        results[index] = { ok: false, error };
      }
    }
  }

  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, runNext);
  await Promise.all(workers);
  return results;
}

export function sleep(ms) {
  if (!ms) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** A queue-based worker pool for crawling, where new items can be pushed while running. */
export class WorkQueue {
  constructor({ concurrency = 5, onTask } = {}) {
    this.concurrency = concurrency;
    this.onTask = onTask;
    this.queue = [];
    this.active = 0;
    this.seen = new Set();
    this._resolveIdle = null;
    this._idlePromise = null;
  }

  push(task, key) {
    if (key !== undefined) {
      if (this.seen.has(key)) return false;
      this.seen.add(key);
    }
    this.queue.push(task);
    this._pump();
    return true;
  }

  size() {
    return this.queue.length + this.active;
  }

  _pump() {
    while (this.active < this.concurrency && this.queue.length > 0) {
      const task = this.queue.shift();
      this.active++;
      Promise.resolve(this.onTask(task))
        .catch(() => {})
        .finally(() => {
          this.active--;
          if (this.size() === 0 && this._resolveIdle) {
            this._resolveIdle();
            this._resolveIdle = null;
            this._idlePromise = null;
          } else {
            this._pump();
          }
        });
    }
  }

  onIdle() {
    if (this.size() === 0) return Promise.resolve();
    if (!this._idlePromise) {
      this._idlePromise = new Promise((resolve) => {
        this._resolveIdle = resolve;
      });
    }
    return this._idlePromise;
  }
}
