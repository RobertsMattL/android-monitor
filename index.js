#!/usr/bin/env node

import { exec } from 'child_process';
import { promisify } from 'util';
import { program } from 'commander';
import blessed from 'blessed';
import contrib from 'blessed-contrib';

const execAsync = promisify(exec);

class AndroidMonitor {
  constructor(deviceId, packageName, interval = 2000) {
    this.deviceId = deviceId;
    this.packageName = packageName;
    this.interval = interval;
    this.running = false;

    // Historical data for charts (keep last 60 data points)
    this.cpuHistory = [];
    this.memoryHistory = {
      totalPss: [],
      privateDirty: [],
      nativeHeap: [],
      dalvikHeap: []
    };
    this.timeLabels = [];
    this.maxDataPoints = 60;

    // Current stats
    this.currentStats = {
      cpu: 0,
      memory: {},
      pid: null,
      threads: 0
    };
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

  stripAnsiCodes(str) {
    // Remove ANSI escape codes
    return str.replace(/\x1B\[[0-9;]*[mKHJsu]/g, '').replace(/\x1B\[[0-9;]*[A-Za-z]/g, '');
  }

  async getCpuStats() {
    const output = await this.executeAdb(`shell top -n 1 -m 100`);

    // Strip ANSI codes from entire output
    const cleanOutput = this.stripAnsiCodes(output);
    const lines = cleanOutput.split('\n');

    // Find line matching package name (handle truncated names with +)
    const packageLine = lines.find(line => {
      const cleanLine = line.trim();
      // Match exact package name or truncated version with +
      return cleanLine.includes(this.packageName) ||
             (this.packageName.length > 15 && cleanLine.includes(this.packageName.substring(0, 15) + '+'));
    });

    if (!packageLine) {
      return { cpu: 0, timestamp: new Date() };
    }

    // Find header line to determine column positions
    const headerLine = lines.find(line => line.includes('PID') && line.includes('CPU'));

    if (!headerLine) {
      return { cpu: 0, timestamp: new Date() };
    }

    // Parse header to find CPU column index
    // Header format: PID USER PR NI VIRT RES SHR S[%CPU] %MEM TIME+ ARGS
    const headers = headerLine.trim().split(/\s+/);
    let cpuIndex = headers.findIndex(h => h.includes('CPU') || h.includes('S[%CPU]'));

    // Parse data line
    const parts = packageLine.trim().split(/\s+/);

    let cpu = 0;

    if (cpuIndex >= 0 && cpuIndex < parts.length) {
      // Try to parse the CPU value at the found index
      const cpuValue = parts[cpuIndex].replace(/[%\[\]]/g, '');
      cpu = parseFloat(cpuValue) || 0;
    } else {
      // Fallback: CPU is typically at index 8 in standard Android top output
      // Format: PID USER PR NI VIRT RES SHR S[%CPU] %MEM TIME+ ARGS
      //         0   1    2  3  4    5   6   7 8      9    10    11+
      if (parts.length > 8) {
        const cpuValue = parts[8].replace(/[%\[\]]/g, '');
        cpu = parseFloat(cpuValue) || 0;
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

  formatMB(kb) {
    return (kb / 1024).toFixed(2);
  }

  addDataPoint(cpuStats, memStats) {
    // Add CPU data
    this.cpuHistory.push(cpuStats.cpu);
    if (this.cpuHistory.length > this.maxDataPoints) {
      this.cpuHistory.shift();
    }

    // Add memory data (convert to MB for charts)
    this.memoryHistory.totalPss.push(parseFloat(this.formatMB(memStats.totalPss)));
    this.memoryHistory.privateDirty.push(parseFloat(this.formatMB(memStats.totalPrivateDirty)));
    this.memoryHistory.nativeHeap.push(parseFloat(this.formatMB(memStats.nativeHeap)));
    this.memoryHistory.dalvikHeap.push(parseFloat(this.formatMB(memStats.dalvikHeap)));

    // Trim memory history
    Object.keys(this.memoryHistory).forEach(key => {
      if (this.memoryHistory[key].length > this.maxDataPoints) {
        this.memoryHistory[key].shift();
      }
    });

    // Add time label
    const time = new Date().toLocaleTimeString();
    this.timeLabels.push(time);
    if (this.timeLabels.length > this.maxDataPoints) {
      this.timeLabels.shift();
    }
  }

  createUI() {
    // Create screen
    const screen = blessed.screen({
      smartCSR: true,
      title: 'Android Monitor'
    });

    // Create grid
    const grid = new contrib.grid({
      rows: 12,
      cols: 12,
      screen: screen
    });

    // Info box (top, full width)
    const infoBox = grid.set(0, 0, 2, 12, blessed.box, {
      label: ' Device Info ',
      content: '',
      tags: true,
      border: {
        type: 'line'
      },
      style: {
        fg: 'white',
        border: {
          fg: 'cyan'
        }
      }
    });

    // CPU Gauge (left)
    const cpuGauge = grid.set(2, 0, 3, 3, contrib.gauge, {
      label: ' CPU Usage ',
      stroke: 'cyan',
      fill: 'white',
      border: {
        type: 'line',
        fg: 'cyan'
      }
    });

    // Memory Stats Box (middle left)
    const memStatsBox = grid.set(2, 3, 3, 3, blessed.box, {
      label: ' Memory Stats ',
      content: '',
      tags: true,
      border: {
        type: 'line'
      },
      style: {
        fg: 'white',
        border: {
          fg: 'cyan'
        }
      }
    });

    // CPU Line Chart (right top)
    const cpuLine = grid.set(2, 6, 3, 6, contrib.line, {
      label: ' CPU History (%) ',
      showLegend: false,
      minY: 0,
      maxY: 100,
      style: {
        line: 'yellow',
        text: 'white',
        baseline: 'white',
        border: {
          fg: 'cyan'
        }
      },
      xLabelPadding: 3,
      xPadding: 5,
      showNthLabel: 5
    });

    // Memory Line Chart (bottom, full width)
    const memoryLine = grid.set(5, 0, 7, 12, contrib.line, {
      label: ' Memory History (MB) ',
      showLegend: true,
      legend: { width: 20 },
      style: {
        line: 'blue',
        text: 'white',
        baseline: 'white',
        border: {
          fg: 'cyan'
        }
      },
      xLabelPadding: 3,
      xPadding: 5,
      showNthLabel: 5
    });

    // Quit instructions
    screen.key(['escape', 'q', 'C-c'], () => {
      return process.exit(0);
    });

    return {
      screen,
      infoBox,
      cpuGauge,
      memStatsBox,
      cpuLine,
      memoryLine
    };
  }

  updateUI(ui) {
    const { screen, infoBox, cpuGauge, memStatsBox, cpuLine, memoryLine } = ui;

    // Update info box
    const info = [
      `{cyan-fg}Device:{/cyan-fg}   ${this.deviceId || 'default'}`,
      `{cyan-fg}Package:{/cyan-fg}  ${this.packageName}`,
      `{cyan-fg}PID:{/cyan-fg}      ${this.currentStats.pid || 'N/A'}`,
      `{cyan-fg}Threads:{/cyan-fg}  ${this.currentStats.threads || 'N/A'}`,
      `{cyan-fg}Time:{/cyan-fg}     ${new Date().toLocaleTimeString()}`
    ].join('\n');
    infoBox.setContent(info);

    // Update CPU gauge
    const cpu = this.currentStats.cpu;
    cpuGauge.setPercent(Math.min(cpu, 100));

    // Update gauge label with color-coded status
    let statusColor = 'green';
    let status = 'Normal';
    if (cpu > 80) {
      statusColor = 'red';
      status = 'High';
    } else if (cpu > 50) {
      statusColor = 'yellow';
      status = 'Elevated';
    }
    cpuGauge.setLabel(` CPU Usage - ${cpu.toFixed(1)}% (${status}) `);

    // Update memory stats box
    const mem = this.currentStats.memory;
    const memInfo = [
      `{cyan-fg}Total PSS:{/cyan-fg}       ${this.formatBytes(mem.totalPss || 0)}`,
      `{cyan-fg}Private Dirty:{/cyan-fg}   ${this.formatBytes(mem.totalPrivateDirty || 0)}`,
      `{cyan-fg}Private Clean:{/cyan-fg}   ${this.formatBytes(mem.totalPrivateClean || 0)}`,
      `{cyan-fg}Native Heap:{/cyan-fg}     ${this.formatBytes(mem.nativeHeap || 0)}`,
      `{cyan-fg}Dalvik Heap:{/cyan-fg}     ${this.formatBytes(mem.dalvikHeap || 0)}`
    ].join('\n');
    memStatsBox.setContent(memInfo);

    // Update CPU line chart
    cpuLine.setData([{
      title: 'CPU',
      x: this.timeLabels,
      y: this.cpuHistory,
      style: { line: 'yellow' }
    }]);

    // Update memory line chart
    memoryLine.setData([
      {
        title: 'Total PSS',
        x: this.timeLabels,
        y: this.memoryHistory.totalPss,
        style: { line: 'cyan' }
      },
      {
        title: 'Private Dirty',
        x: this.timeLabels,
        y: this.memoryHistory.privateDirty,
        style: { line: 'red' }
      },
      {
        title: 'Native Heap',
        x: this.timeLabels,
        y: this.memoryHistory.nativeHeap,
        style: { line: 'yellow' }
      },
      {
        title: 'Dalvik Heap',
        x: this.timeLabels,
        y: this.memoryHistory.dalvikHeap,
        style: { line: 'green' }
      }
    ]);

    screen.render();
  }

  async monitor() {
    this.running = true;

    // Create UI
    const ui = this.createUI();

    // Show loading message
    ui.infoBox.setContent('{yellow-fg}Connecting to device and fetching initial data...{/yellow-fg}');
    ui.screen.render();

    const monitorLoop = async () => {
      try {
        const [memStats, cpuStats, pidInfo] = await Promise.all([
          this.getMemoryStats(),
          this.getCpuStats(),
          this.getPidAndThreads()
        ]);

        // Update current stats
        this.currentStats = {
          cpu: cpuStats.cpu,
          memory: memStats,
          pid: pidInfo.pid,
          threads: pidInfo.threads
        };

        // Add to history
        this.addDataPoint(cpuStats, memStats);

        // Update UI
        this.updateUI(ui);
      } catch (error) {
        ui.infoBox.setContent(`{red-fg}Error: ${error.message}{/red-fg}\n\n{yellow-fg}Retrying...{/yellow-fg}`);
        ui.screen.render();
      }

      if (this.running) {
        setTimeout(monitorLoop, this.interval);
      }
    };

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
  console.error('Error: Interval must be at least 500ms');
  process.exit(1);
}

// Start monitoring
const monitor = new AndroidMonitor(options.device, options.package, interval);
monitor.monitor().catch(error => {
  console.error('Fatal error:', error.message);
  process.exit(1);
});
