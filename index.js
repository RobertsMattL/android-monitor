#!/usr/bin/env node

import { exec } from 'child_process';
import { promisify } from 'util';
import { program } from 'commander';
import chalk from 'chalk';

const execAsync = promisify(exec);

class AndroidMonitor {
  constructor(deviceId, packageName, interval = 2000) {
    this.deviceId = deviceId;
    this.packageName = packageName;
    this.interval = interval;
    this.running = false;
  }

  async executeAdb(command) {
    const deviceFlag = this.deviceId ? `-s ${this.deviceId}` : '';
    const fullCommand = `adb ${deviceFlag} ${command}`;

    try {
      const { stdout, stderr } = await execAsync(fullCommand);
      if (stderr && !stderr.includes('WARNING')) {
        throw new Error(stderr);
      }
      return stdout;
    } catch (error) {
      throw new Error(`ADB command failed: ${error.message}`);
    }
  }

  async getMemoryStats() {
    const output = await this.executeAdb(`shell dumpsys meminfo ${this.packageName}`);

    const stats = {
      totalPss: 0,
      totalPrivateDirty: 0,
      totalPrivateClean: 0,
      nativeHeap: 0,
      dalvikHeap: 0,
      timestamp: new Date()
    };

    // Parse TOTAL line
    const totalMatch = output.match(/TOTAL\s+(\d+)\s+(\d+)\s+(\d+)/);
    if (totalMatch) {
      stats.totalPss = parseInt(totalMatch[1]);
      stats.totalPrivateDirty = parseInt(totalMatch[2]);
      stats.totalPrivateClean = parseInt(totalMatch[3]);
    }

    // Parse Native Heap
    const nativeMatch = output.match(/Native Heap\s+(\d+)/);
    if (nativeMatch) {
      stats.nativeHeap = parseInt(nativeMatch[1]);
    }

    // Parse Dalvik Heap
    const dalvikMatch = output.match(/Dalvik Heap\s+(\d+)/);
    if (dalvikMatch) {
      stats.dalvikHeap = parseInt(dalvikMatch[1]);
    }

    return stats;
  }

  async getCpuStats() {
    const output = await this.executeAdb(`shell top -n 1 -m 100`);

    const lines = output.split('\n');
    const packageLine = lines.find(line => line.includes(this.packageName));

    if (!packageLine) {
      return { cpu: 0, threads: 0, timestamp: new Date() };
    }

    // Parse top output (format varies by Android version)
    // Common format: PID USER PR NI VIRT RES SHR S[%CPU] %MEM TIME+ ARGS
    const parts = packageLine.trim().split(/\s+/);

    let cpuIndex = -1;
    const headerLine = lines.find(line => line.includes('PID') || line.includes('%CPU'));
    if (headerLine) {
      const headers = headerLine.trim().split(/\s+/);
      cpuIndex = headers.findIndex(h => h.includes('CPU'));
    }

    // Try to find CPU percentage (usually around index 8-9)
    let cpu = 0;
    if (cpuIndex > 0 && parts[cpuIndex]) {
      cpu = parseFloat(parts[cpuIndex].replace('%', '')) || 0;
    } else {
      // Fallback: look for percentage values
      for (let i = 0; i < parts.length; i++) {
        if (parts[i].includes('%') || (!isNaN(parseFloat(parts[i])) && parseFloat(parts[i]) < 100)) {
          const val = parseFloat(parts[i].replace('%', ''));
          if (!isNaN(val) && val >= 0 && val <= 100) {
            cpu = val;
            break;
          }
        }
      }
    }

    return {
      cpu,
      timestamp: new Date()
    };
  }

  async getPidAndThreads() {
    try {
      const output = await this.executeAdb(`shell pidof ${this.packageName}`);
      const pid = output.trim();

      if (!pid) {
        return { pid: null, threads: 0 };
      }

      // Get thread count
      const threadOutput = await this.executeAdb(`shell ls /proc/${pid}/task | wc -l`);
      const threads = parseInt(threadOutput.trim()) || 0;

      return { pid, threads };
    } catch (error) {
      return { pid: null, threads: 0 };
    }
  }

  formatBytes(kb) {
    if (kb < 1024) return `${kb} KB`;
    const mb = (kb / 1024).toFixed(2);
    if (mb < 1024) return `${mb} MB`;
    const gb = (mb / 1024).toFixed(2);
    return `${gb} GB`;
  }

  displayStats(memStats, cpuStats, pidInfo) {
    // Clear console
    console.clear();

    // Header
    console.log(chalk.bold.cyan('\n═══════════════════════════════════════════════════════════════'));
    console.log(chalk.bold.cyan('              ANDROID APP PERFORMANCE MONITOR'));
    console.log(chalk.bold.cyan('═══════════════════════════════════════════════════════════════\n'));

    // Device and Package Info
    console.log(chalk.bold('Device:      ') + chalk.white(this.deviceId || 'default'));
    console.log(chalk.bold('Package:     ') + chalk.white(this.packageName));
    console.log(chalk.bold('PID:         ') + chalk.white(pidInfo.pid || 'N/A'));
    console.log(chalk.bold('Threads:     ') + chalk.white(pidInfo.threads || 'N/A'));
    console.log(chalk.bold('Time:        ') + chalk.white(new Date().toLocaleTimeString()));

    console.log(chalk.cyan('\n───────────────────────────────────────────────────────────────'));

    // CPU Stats
    console.log(chalk.bold.yellow('\n📊 CPU USAGE'));
    const cpuColor = cpuStats.cpu > 80 ? chalk.red : cpuStats.cpu > 50 ? chalk.yellow : chalk.green;
    console.log(chalk.bold('  Usage:       ') + cpuColor.bold(`${cpuStats.cpu.toFixed(1)}%`));

    // Memory Stats
    console.log(chalk.bold.blue('\n💾 MEMORY USAGE'));
    console.log(chalk.bold('  Total PSS:        ') + chalk.white(this.formatBytes(memStats.totalPss)));
    console.log(chalk.bold('  Private Dirty:    ') + chalk.white(this.formatBytes(memStats.totalPrivateDirty)));
    console.log(chalk.bold('  Private Clean:    ') + chalk.white(this.formatBytes(memStats.totalPrivateClean)));
    console.log(chalk.bold('  Native Heap:      ') + chalk.white(this.formatBytes(memStats.nativeHeap)));
    console.log(chalk.bold('  Dalvik Heap:      ') + chalk.white(this.formatBytes(memStats.dalvikHeap)));

    console.log(chalk.cyan('\n═══════════════════════════════════════════════════════════════'));
    console.log(chalk.dim(`Refreshing every ${this.interval/1000}s... (Ctrl+C to stop)\n`));
  }

  async monitor() {
    this.running = true;

    console.log(chalk.yellow('Starting Android app monitor...'));
    console.log(chalk.dim('Connecting to device and fetching initial data...\n'));

    const monitorLoop = async () => {
      try {
        const [memStats, cpuStats, pidInfo] = await Promise.all([
          this.getMemoryStats(),
          this.getCpuStats(),
          this.getPidAndThreads()
        ]);

        this.displayStats(memStats, cpuStats, pidInfo);
      } catch (error) {
        console.error(chalk.red('Error:'), error.message);
        console.log(chalk.yellow('\nRetrying...\n'));
      }

      if (this.running) {
        setTimeout(monitorLoop, this.interval);
      }
    };

    // Handle Ctrl+C
    process.on('SIGINT', () => {
      console.log(chalk.yellow('\n\nStopping monitor...'));
      this.running = false;
      process.exit(0);
    });

    await monitorLoop();
  }
}

// CLI Setup
program
  .name('android-monitor')
  .description('Monitor CPU and memory usage of Android applications')
  .version('1.0.0')
  .requiredOption('-p, --package <name>', 'Package name to monitor (e.g., com.atakmap.app.civ)')
  .option('-d, --device <id>', 'Device ID (optional, uses default if not specified)')
  .option('-i, --interval <ms>', 'Refresh interval in milliseconds', '2000')
  .parse(process.argv);

const options = program.opts();

// Validate interval
const interval = parseInt(options.interval);
if (isNaN(interval) || interval < 500) {
  console.error(chalk.red('Error: Interval must be at least 500ms'));
  process.exit(1);
}

// Start monitoring
const monitor = new AndroidMonitor(options.device, options.package, interval);
monitor.monitor().catch(error => {
  console.error(chalk.red('Fatal error:'), error.message);
  process.exit(1);
});
