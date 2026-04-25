const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');

const resultsRoot = path.resolve(__dirname, '..', 'benchmarks', 'results');
const mode = process.argv[2] === 'heap' ? 'heap' : 'cpu';
const targetScript = process.argv[3] || 'index.js';
const nodeBinary = process.execPath;
const profileDurationMs = Number.parseInt(process.env.PROFILE_DURATION_MS || '0', 10);
const exerciseCommand = process.env.PROFILE_EXERCISE_CMD;
const readinessPort = Number.parseInt(process.env.PROFILE_SERVER_PORT || process.env.PORT || '5000', 10);
const timestamp = new Date().toISOString().replace(/[.:]/g, '-');
const outputDir = path.join(resultsRoot, `${timestamp}-${mode}`);
const metadataPath = path.join(outputDir, 'metadata.json');

const waitForPort = async (port, timeoutMs = 30000) => {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      await new Promise((resolve, reject) => {
        const socket = net.connect({ port, host: '127.0.0.1' }, () => {
          socket.end();
          resolve();
        });
        socket.on('error', reject);
      });
      return;
    } catch (_error) {
      await delay(250);
    }
  }

  throw new Error(`Timed out waiting for port ${port}`);
};

const runShellCommand = (command) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, {
      cwd: path.resolve(__dirname, '..'),
      env: process.env,
      shell: true,
      stdio: 'inherit',
    });

    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`Exercise command exited with code ${code}`));
    });
    child.on('error', reject);
  });

const main = async () => {
  fs.mkdirSync(outputDir, { recursive: true });

  const nodeFlags =
    mode === 'heap'
      ? ['--heap-prof', `--heap-prof-dir=${outputDir}`, '--heapsnapshot-near-heap-limit=1']
      : ['--cpu-prof', `--cpu-prof-dir=${outputDir}`];

  const child = spawn(nodeBinary, [...nodeFlags, targetScript], {
    cwd: path.resolve(__dirname, '..'),
    env: process.env,
    stdio: 'inherit',
  });
  let childExited = false;
  const exitPromise = new Promise((resolve, reject) => {
    child.once('exit', (code, signal) => {
      childExited = true;
      resolve({ code, signal });
    });
    child.once('error', reject);
  });

  const cleanup = () => {
    if (!childExited && !child.killed) {
      child.kill('SIGINT');
    }
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  try {
    await waitForPort(readinessPort);

    if (exerciseCommand) {
      await runShellCommand(exerciseCommand);
    } else if (profileDurationMs > 0) {
      await delay(profileDurationMs);
    } else {
      console.log(`Profiling server on port ${readinessPort}. Press Ctrl+C to stop.`);
      await exitPromise;
      return;
    }
  } finally {
    cleanup();
    await exitPromise.catch(() => undefined);
    fs.writeFileSync(
      metadataPath,
      JSON.stringify(
        {
          mode,
          targetScript,
          outputDir,
          readinessPort,
          exerciseCommand: exerciseCommand || null,
          profileDurationMs: Number.isFinite(profileDurationMs) ? profileDurationMs : 0,
          completedAt: new Date().toISOString(),
        },
        null,
        2
      )
    );
    console.log(`Profile artifacts written to ${outputDir}`);
  }
};

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
