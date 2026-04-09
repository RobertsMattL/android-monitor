# Android Monitor

A real-time Terminal UI (TUI) monitoring tool for Android app CPU and memory usage with live charts and gauges.

## Features

- 📊 **Real-time CPU gauge** - Visual gauge showing current CPU usage with color-coded alerts
- 📈 **Historical CPU chart** - Line chart tracking CPU usage over time
- 💾 **Memory tracking** - Multi-line chart showing Total PSS, Private Dirty, Native Heap, and Dalvik Heap trends
- 📉 **Memory statistics panel** - Current memory values in an easy-to-read format
- 🎨 **Rich Terminal UI** - Beautiful blessed-based interface with multiple panels
- 🔄 **Configurable refresh intervals** - Adjust monitoring frequency
- 📱 **Support for multiple devices** - Monitor any connected Android device
- 🧵 **Thread count tracking** - Monitor active thread count
- 📊 **60-point history** - Keeps last 60 data points for trend analysis

## Installation

```bash
cd android-monitor
npm install
```

## Usage

### Basic Usage

Monitor a specific package on the default device:

```bash
npm start -- -p com.atakmap.app.civ
```

### With Device ID

Monitor on a specific device:

```bash
npm start -- -p com.atakmap.app.civ -d RFCN901AZVL
```

### Custom Refresh Interval

Set a custom refresh interval (in milliseconds):

```bash
npm start -- -p com.atakmap.app.civ -i 5000
```

### All Options

```bash
npm start -- -p <package> [-d <device-id>] [-i <interval-ms>]
```

**Options:**
- `-p, --package <name>` - Package name to monitor (required)
- `-d, --device <id>` - Device ID (optional, uses default if not specified)
- `-i, --interval <ms>` - Refresh interval in milliseconds (default: 2000, min: 500)

## Interface Layout

The monitor displays a rich terminal UI with multiple panels:

```
┌─ Device Info ────────────────────────────────────────────────┐
│ Device:   RFCN901AZVL                                         │
│ Package:  com.atakmap.app.civ                                 │
│ PID:      12345                                               │
│ Threads:  42                                                  │
│ Time:     2:30:45 PM                                          │
└───────────────────────────────────────────────────────────────┘

┌─ CPU Usage ──┐ ┌─ Memory Stats ───┐ ┌─ CPU History (%) ─────┐
│              │ │ Total PSS: 246MB │ │                        │
│      15%     │ │ Private Dirty:   │ │   ╱╲    ╱╲            │
│   ████░░░░   │ │   189 MB         │ │  ╱  ╲  ╱  ╲   ╱╲      │
│              │ │ Private Clean:   │ │ ╱    ╲╱    ╲ ╱  ╲     │
│              │ │   45 MB          │ │╱            ╲    ╲    │
│              │ │ Native Heap:     │ └────────────────────────┘
│              │ │   78 MB          │
│              │ │ Dalvik Heap:     │
│              │ │   68 MB          │
└──────────────┘ └──────────────────┘

┌─ Memory History (MB) ──────────────────────────────────────┐
│ ─ Total PSS     ─ Private Dirty  ─ Native Heap            │
│ ─ Dalvik Heap                                              │
│                                                             │
│ 300┤                         ╭─ Total PSS                  │
│ 250┤                    ╭────╯                             │
│ 200┤              ╭─────╯    ╭─ Private Dirty             │
│ 150┤         ╭────╯     ╭────╯                             │
│ 100┤    ╭────╯      ╭───╯  ╭─ Native Heap                 │
│  50┤────╯       ────╯  ────╯─ Dalvik Heap                 │
│   0┤────────────────────────────────────────────────       │
│    10:30      10:31      10:32      10:33                  │
└─────────────────────────────────────────────────────────────┘

Press q, Esc, or Ctrl+C to quit
```

### UI Components

- **Device Info Panel** - Shows device ID, package name, PID, thread count, and current time
- **CPU Gauge** - Visual gauge (green/yellow/red based on usage thresholds)
- **Memory Stats Panel** - Current memory values in KB/MB/GB format
- **CPU History Chart** - Yellow line chart showing CPU % over last 60 data points
- **Memory History Chart** - Multi-line chart with color-coded memory metrics:
  - **Cyan** - Total PSS (overall memory footprint)
  - **Red** - Private Dirty (modified private memory)
  - **Yellow** - Native Heap (C/C++ allocations)
  - **Green** - Dalvik Heap (Java/Kotlin objects)

## Memory Metrics Explained

Understanding the memory statistics displayed by the monitor:

### Total PSS (Proportional Set Size)
**Most important metric for overall memory usage.**

PSS is the total memory used by your app, with shared memory divided proportionally among all processes using it. This is the best single metric to understand your app's actual memory footprint.

- Formula: Private memory + (Shared memory / Number of processes sharing it)
- Use case: Compare memory usage between app versions or track memory growth over time
- What's good: Lower is better. On modern Android, aim to keep under 200-300MB for typical apps

### Private Dirty
**Memory that has been modified and is exclusively used by your app.**

This memory cannot be paged out to disk and must stay in RAM. It includes:
- Modified heap allocations
- Written-to stack memory
- Dirty pages from libraries loaded exclusively by your app

- Impact: Directly contributes to memory pressure
- Use case: Track memory leaks - if this continuously grows, you likely have a leak
- What's good: Should remain relatively stable during normal operation

### Private Clean
**Unmodified memory exclusively used by your app that can be paged out.**

This memory can be reclaimed by the system if needed because it hasn't been modified:
- Code pages from your APK
- Read-only resources
- Unmodified memory mapped files

- Impact: Less critical - can be freed and reloaded if needed
- Use case: Understand your app's base memory footprint from code/resources
- What's good: This is acceptable memory usage; the system can reclaim it under pressure

### Native Heap
**Memory allocated by native code (C/C++) through malloc/new.**

Includes:
- Native libraries (e.g., OpenGL, SQLite, custom JNI code)
- Bitmap pixel data (stored in native memory on modern Android)
- Native allocations from third-party SDKs

- Impact: Not subject to Java/Dalvik garbage collection
- Use case: Monitor if you use JNI, NDK, or work with large bitmaps
- Warning: Native memory leaks require manual investigation (native heap dumps)
- What's good: Depends on your app - should be stable unless actively loading resources

### Dalvik Heap
**Memory used by the Dalvik/ART virtual machine for Java objects.**

Includes:
- Java object allocations
- Array allocations
- String objects
- Activity/Fragment instances and their fields

- Impact: Managed by garbage collector, but still counts toward app memory limit
- Use case: Track Java-side memory usage and potential Java object leaks
- Warning: If this grows continuously, you may be leaking Activities, Bitmaps (pre-API 26), or other Java objects
- What's good: Should grow and shrink with normal app operation due to GC

### Which Metric Should You Monitor?

**For general health checks:** Watch Total PSS - it's your complete memory footprint

**For memory leak detection:** Monitor Private Dirty and Dalvik Heap over time:
- If Private Dirty grows continuously → likely native or general memory leak
- If Dalvik Heap grows continuously → likely Java object leak (Activities, Contexts, etc.)

**For optimization:** Reduce Native Heap (optimize bitmap usage) and Dalvik Heap (reduce object allocations)

## Requirements

- Node.js 14+ (uses ES modules)
- Android Debug Bridge (adb) installed and in PATH
- USB debugging enabled on Android device
- Target app running on the device

## How It Works

The monitor uses the following ADB commands:

- `dumpsys meminfo <package>` - Retrieves detailed memory statistics
- `top -n 1 -m 100` - Captures CPU usage snapshot
- `pidof <package>` - Gets the process ID
- `/proc/<pid>/task` - Counts active threads

## Troubleshooting

### "ADB command failed"
- Ensure adb is installed: `adb version`
- Check device connection: `adb devices`
- Verify package is running: `adb shell pm list packages | grep <package>`

### "Package not found in top output"
- The app may not be running
- The app might be using very low CPU (0%)
- Try a longer refresh interval

### Permission denied
- Ensure USB debugging is enabled
- Re-authorize the computer on the device
- Check that the package name is correct

## Example Use Cases

**Monitor ATAK app on specific device:**
```bash
npm start -- -p com.atakmap.app.civ -d RFCN901AZVL
```

**High-frequency monitoring (500ms):**
```bash
npm start -- -p com.atakmap.app.civ -i 500
```

**Monitor during stress testing:**
```bash
npm start -- -p com.somewearlabs.atakplugin -i 1000
```

## Development

The monitor is a single-file Node.js application built with:

- **blessed** - Terminal UI framework for creating rich interfaces
- **blessed-contrib** - Graphs, gauges, and advanced widgets for blessed
- **commander** - CLI argument parsing
- **chalk** - Terminal colors (for error messages)

### Architecture

- `AndroidMonitor` class handles all ADB communication and data collection
- Historical data tracking keeps last 60 data points (configurable via `maxDataPoints`)
- UI updates on every monitoring interval
- Charts automatically scale and scroll with data

### Customization

- Modify `maxDataPoints` in the constructor to keep more/less history
- Adjust grid layout in `createUI()` to change panel sizes
- Change color schemes in widget style properties
- Add new metrics by extending `getMemoryStats()` or `getCpuStats()`

## License

MIT
