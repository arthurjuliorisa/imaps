const os = require('os');
const { spawn } = require('child_process');

function getRecommendedHeapSizeMb() {
  const totalMemoryMb = Math.floor(os.totalmem() / 1024 / 1024);

  if (totalMemoryMb <= 4096) {
    return 2048;
  }

  if (totalMemoryMb <= 6144) {
    return 2560;
  }

  if (totalMemoryMb <= 8192) {
    return 3072;
  }

  return 4096;
}

function ensureNodeOptions(options) {
  const heapFlag = `--max-old-space-size=${getRecommendedHeapSizeMb()}`;

  if (!options) {
    return heapFlag;
  }

  if (options.includes('--max-old-space-size=')) {
    return options;
  }

  return `${options} ${heapFlag}`;
}

const env = {
  ...process.env,
  NODE_OPTIONS: ensureNodeOptions(process.env.NODE_OPTIONS),
};

const child = spawn(
  process.execPath,
  ['node_modules/next/dist/bin/next', 'build'],
  {
    cwd: process.cwd(),
    env,
    stdio: 'inherit',
  }
);

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});
