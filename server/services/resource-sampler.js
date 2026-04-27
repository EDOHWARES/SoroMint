const os = require('os');
const { logger } = require('../utils/logger');

const cpuPercent = () => {
  const cpus = os.cpus();
  let idle = 0,
    total = 0;
  for (const cpu of cpus) {
    for (const val of Object.values(cpu.times)) total += val;
    idle += cpu.times.idle;
  }
  return parseFloat(((1 - idle / total) * 100).toFixed(1));
};

const memStats = () => {
  const total = os.totalmem();
  const free = os.freemem();
  const used = total - free;
  return {
    totalGb: parseFloat((total / 1e9).toFixed(2)),
    usedGb: parseFloat((used / 1e9).toFixed(2)),
    freeGb: parseFloat((free / 1e9).toFixed(2)),
    usedPercent: parseFloat(((used / total) * 100).toFixed(1)),
  };
};

const diskStats = () => {
  if (process.env.NODE_ENV === 'test') return null;
  try {
    const { execSync } = require('child_process');
    const raw = execSync(
      'df -k / --output=size,used,avail 2>/dev/null || df -k /',
      {
        timeout: 2000,
      }
    )
      .toString()
      .trim()
      .split('\n');
    // Last line is the data row
    const [size, used, avail] = raw[raw.length - 1]
      .trim()
      .split(/\s+/)
      .map(Number);
    return {
      totalGb: parseFloat((size / 1e6).toFixed(2)),
      usedGb: parseFloat((used / 1e6).toFixed(2)),
      freeGb: parseFloat((avail / 1e6).toFixed(2)),
      usedPercent: parseFloat(((used / size) * 100).toFixed(1)),
    };
  } catch { return null; }
};

class ResourceSampler {
  constructor() { this._latest = null; this._timer = null; }
  get latest() { return this._latest; }
  start() {
    if (process.env.NODE_ENV === 'test') return;
    this._collect();
    const env = require('../config/env-config').getEnv();
    this._timer = setInterval(() => this._collect(), env.METRICS_INTERVAL_MS);
    if (this._timer.unref) this._timer.unref();
    logger.info('ResourceSampler started', {
      intervalMs: env.METRICS_INTERVAL_MS,
    });
  }
  stop() { if (this._timer) { clearInterval(this._timer); this._timer = null; } }
  _collect() {
    const env = require('../config/env-config').getEnv();
    const cpu = cpuPercent();
    const memory = memStats();
    const disk = diskStats();
    const thresholds = {
      cpu: env.ALERT_THRESHOLD_CPU,
      memory: env.ALERT_THRESHOLD_MEMORY,
      disk: env.ALERT_THRESHOLD_DISK,
    };

    const alerts = [];
    if (cpu >= thresholds.cpu)
      alerts.push({ resource: 'cpu', value: cpu, threshold: thresholds.cpu });
    if (memory.usedPercent >= thresholds.memory)
      alerts.push({
        resource: 'memory',
        value: memory.usedPercent,
        threshold: thresholds.memory,
      });
    if (disk && disk.usedPercent >= thresholds.disk)
      alerts.push({
        resource: 'disk',
        value: disk.usedPercent,
        threshold: thresholds.disk,
      });

    if (alerts.length) {
      logger.warn('Resource threshold exceeded', { alerts });
    }

    this._latest = {
      sampledAt: new Date().toISOString(),
      cpu: {
        usedPercent: cpu,
        loadAvg: os.loadavg().map((v) => parseFloat(v.toFixed(2))),
      },
      memory,
      disk,
      alerts,
      thresholds,
    };
  }
}

const sampler = new ResourceSampler();
module.exports = { sampler };
