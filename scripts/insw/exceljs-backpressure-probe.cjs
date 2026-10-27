// Isolated diagnostic only: no DB, network, files, or application imports.
// Internal queue inspection is evidence, never a production pacing mechanism.
const ExcelJS = require('exceljs');
const { Writable } = require('node:stream');
const { setImmediate: tick } = require('node:timers/promises');
const { randomBytes } = require('node:crypto');

async function probe(rows) {
  let release;
  let stalled = true;
  let accepted = 0;
  const sink = new Writable({
    highWaterMark: 1024,
    write(chunk, encoding, callback) {
      accepted += chunk.length;
      if (stalled) release = callback;
      else callback();
    },
  });
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: sink, useSharedStrings: false });
  const sheet = workbook.addWorksheet('INSW Logs');
  let outstandingPipeBytes = 0;
  let peakOutstandingPipeBytes = 0;
  const originalPipe = sheet.stream._pipe.bind(sheet.stream);
  sheet.stream._pipe = async chunk => {
    const bytes = chunk.length;
    outstandingPipeBytes += bytes;
    peakOutstandingPipeBytes = Math.max(peakOutstandingPipeBytes, outstandingPipeBytes);
    try { return await originalPipe(chunk); }
    finally { outstandingPipeBytes -= bytes; }
  };
  const before = process.memoryUsage();
  let maxQueued = 0;
  const start = performance.now();
  for (let i = 0; i < rows; i++) {
    sheet.addRow([i + 1, '28/10/2026 12:00:00', 'incoming', randomBytes(50).toString('hex'), '30', 'SUCCESS', 0]).commit();
    if ((i + 1) % 2000 === 0) {
      await tick(); // Trial DB batch pacing; HTTP consumer remains stalled.
      maxQueued = Math.max(maxQueued, sheet.stream.buffers.reduce((sum, b) => sum + b.length, 0));
    }
  }
  const after = process.memoryUsage();
  const result = { rows, producedWhileSinkStalled: rows, acceptedBySink: accepted,
    worksheetQueuedBytes: maxQueued, outstandingPipeBytes, peakOutstandingPipeBytes, sinkQueuedBytes: sink.writableLength,
    rss: after.rss, heapUsed: after.heapUsed, external: after.external, arrayBuffers: after.arrayBuffers,
    rssDelta: after.rss - before.rss, producerMs: Math.round(performance.now() - start) };
  stalled = false;
  if (release) release();
  await workbook.commit();
  console.log(JSON.stringify(result));
}
(async () => {
  // Bounded proof of missing producer pacing; intentionally not a 100K benchmark.
  await probe(2000);
  await probe(10000);
})().catch(error => { console.error(error); process.exitCode = 1; });
