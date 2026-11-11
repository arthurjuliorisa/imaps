import { integer } from '../insw-queue/contracts';

function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    const done = () => { clearTimeout(timer); signal.removeEventListener('abort', done); resolve(); };
    const timer = setTimeout(done, ms);
    signal.addEventListener('abort', done, { once: true });
    if (signal.aborted) done();
  });
}

// Valid ONLY inside the existing sticky, single-flight owner. Construct AFTER
// acquisition: a full fresh interval replaces unknown timing from a dead owner.
// Never persist/compare hrtime values across processes, boots or clock epochs.
export class ElapsedPacing {
  private previous: bigint;
  private barrier: bigint;
  private failed = false;

  constructor(private readonly now = () => process.hrtime.bigint(), private readonly sleep = pause) {
    this.previous = this.barrier = this.sample();
  }

  private sample(): bigint {
    const value = this.now();
    if (typeof value !== 'bigint' || value < BigInt(0)
      || (this.previous !== undefined && value < this.previous)) throw new Error('ELAPSED_CLOCK_UNAVAILABLE');
    this.previous = value;
    return value;
  }

  // Called AFTER physical invocation (or after drain if the adapter has no hook).
  // Do not throw from the post-fetch hook: the HTTP promise must stay tracked.
  mark(): void {
    try { this.barrier = this.sample(); }
    catch { this.failed = true; }
  }

  async wait(intervalMs: number, signal: AbortSignal): Promise<boolean> {
    integer(intervalMs, 'elapsed interval', 3600, 2147483647);
    const deadline = this.barrier + BigInt(intervalMs) * BigInt(1000000);
    while (!signal.aborted) {
      if (this.failed) throw new Error('ELAPSED_CLOCK_UNAVAILABLE');
      const observed = this.sample();
      const remaining = deadline - observed;
      if (remaining <= BigInt(0)) return true;
      // Timer wakeup alone is never evidence. Recheck elapsed time, including
      // early wakeups; no database polling or transaction is held during sleep.
      await this.sleep(Number((remaining + BigInt(999999)) / BigInt(1000000)), signal);
      if (!signal.aborted && this.sample() === observed) throw new Error('ELAPSED_CLOCK_UNAVAILABLE');
    }
    return false;
  }
}
