export type Submission = { state: string; http?: number };
export async function submitOne(input: {
  signal: AbortSignal; deadline: number;
  request: () => Promise<Response>; collision: () => Promise<boolean>;
  record: (s: Submission) => void;
  pause: (ms: number) => Promise<void>;
}) {
  for (let retry = 0; retry <= 3 && !input.signal.aborted; retry++) {
    input.record({ state: 'SUBMISSION_INTENT' });
    let response: Response;
    try { response = await input.request(); }
    catch { input.record({ state: 'SUBMISSION_UNKNOWN' }); return; }
    await response.body?.cancel();
    if (response.status !== 429 || retry === 3) {
      input.record({ state: response.ok ? 'ACCEPTED' : 'WMS_REJECTED', http: response.status }); return;
    }
    input.record({ state: 'API_RATE_LIMITED', http: 429 });
    if (await input.collision()) return;
    const header = response.headers.get('retry-after');
    const seconds = header && /^\d+$/.test(header) ? Number(header) : header ? Math.ceil((Date.parse(header)-Date.now())/1000) : 0;
    const ms = Math.max(1000*2**retry, (Number.isFinite(seconds) ? seconds : 0)*1000);
    if (ms > 60000 || Date.now()+ms >= input.deadline) return;
    await input.pause(ms);
  }
}
