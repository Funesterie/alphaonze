/**
 * A11 Process Supervisor
 * Simple and reliable process supervision for A11 services
 */

const { spawn } = require('child_process');
const EventEmitter = require('events');
const path = require('path');
const fs = require('fs');

class A11Supervisor extends EventEmitter {
  constructor(options = {}) {
    super();
    this.processes = new Map();
    this.config = {
      maxRestarts: options.maxRestarts || 3,
      restartDelay: options.restartDelay || 2000,
      logDir: options.logDir || path.resolve(__dirname, '../../logs/supervisor'),
      ...options
    };
    
    // Ensure log directory exists
    if (!fs.existsSync(this.config.logDir)) {
      fs.mkdirSync(this.config.logDir, { recursive: true });
    }
    
    console.log('[A11-Supervisor] Initialized with config:', {
      maxRestarts: this.config.maxRestarts,
      restartDelay: this.config.restartDelay,
      logDir: this.config.logDir
    });
  }

  /**
   * Register a process for supervision
   * @param {Object} processConfig - Process configuration
   */
  register(processConfig) {
    const { name, command, args = [], cwd, env = {}, autoRestart = true } = processConfig;
    
    if (!name || !command) {
      throw new Error('Process name and command are required');
    }
    
    this.processes.set(name, {
      config: {
        name,
        command,
        args,
        cwd: cwd || process.cwd(),
        env,
        autoRestart
      },
      process: null,
      restarts: 0,
      status: 'registered',
      pid: null,
      startTime: null
    });
    
    console.log(`[A11-Supervisor] Registered process: ${name}`);
    this.emit('registered', { name });
  }

  /**
   * Start a registered process
   * @param {string} name - Process name
   */
  start(name) {
    const entry = this.processes.get(name);
    if (!entry) {
      throw new Error(`Process ${name} not registered`);
    }
    
    if (entry.status === 'running') {
      console.warn(`[A11-Supervisor] Process ${name} is already running`);
      return;
    }
    
    const { command, args, cwd, env } = entry.config;
    const logFile = path.join(this.config.logDir, `${name}.log`);
    const logStream = fs.createWriteStream(logFile, { flags: 'a' });
    
    console.log `[A11-Supervisor] Starting process: ${name}`;
    console.log(`[A11-Supervisor] Command: ${command} ${args.join(' ')}`);
    console.log(`[A11-Supervisor] CWD: ${cwd}`);
    console.log(`[A11-Supervisor] Log: ${logFile}`);
    
    const proc = spawn(command, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      // Run detached so child can continue independently when requested
      detached: true
    });

    entry.process = proc;
    entry.status = 'running';
    entry.pid = proc.pid;
    entry.startTime = Date.now();

    // If we started the child as detached, unref it so parent can exit without keeping
    try {
      if (proc && typeof proc.unref === 'function') {
        proc.unref();
      }
    } catch (e) {
      // ignore
    }

    // Pipe output to log file
    proc.stdout.on('data', (data) => {
      logStream.write(`[STDOUT ${new Date().toISOString()}] ${data}`);
    });
    
    proc.stderr.on('data', (data) => {
      logStream.write(`[STDERR ${new Date().toISOString()}] ${data}`);
    });
    
    proc.on('error', (err) => {
      console.error(`[A11-Supervisor] Process ${name} error:`, err.message);
      logStream.write(`[ERROR ${new Date().toISOString()}] ${err.message}\n`);
      this.emit('error', { name, error: err });
    });
    
    proc.on('exit', (code, signal) => {
      logStream.end();
      this.handleExit(name, code, signal);
    });
    
    this.emit('start', { name, pid: proc.pid });
    console.log(`[A11-Supervisor] Process ${name} started with PID ${proc.pid}`);
  }

  /**
   * Handle process exit
   * @param {string} name - Process name
   * @param {number} code - Exit code
   * @param {string} signal - Exit signal
   */
  handleExit(name, code, signal) {
    const entry = this.processes.get(name);
    if (!entry) return;
    
    const runtime = entry.startTime ? ((Date.now() - entry.startTime) / 1000).toFixed(2) : 'unknown';
    
    entry.status = 'stopped';
    entry.pid = null;
    entry.restarts++;
    
    console.log(`[A11-Supervisor] Process ${name} exited with code ${code}, signal ${signal} (runtime: ${runtime}s)`);
    this.emit('exit', { name, code, signal, runtime });
    
    if (!entry.config.autoRestart) {
      console.log(`[A11-Supervisor] Auto-restart disabled for ${name}`);
      return;
    }
    
    if (entry.restarts >= this.config.maxRestarts) {
      console.error(`[A11-Supervisor] Process ${name} reached max restarts (${this.config.maxRestarts})`);
      this.emit('max-restarts', { name, restarts: entry.restarts });
      return;
    }
    
    console.log(`[A11-Supervisor] Scheduling restart for ${name} in ${this.config.restartDelay}ms (attempt ${entry.restarts}/${this.config.maxRestarts})`);
    setTimeout(() => {
      try {
        this.start(name);
      } catch (err) {
        console.error(`[A11-Supervisor] Failed to restart ${name}:`, err.message);
      }
    }, this.config.restartDelay);
  }

  /**
   * Stop a running process
   * @param {string} name - Process name
   */
  stop(name) {
    const entry = this.processes.get(name);
    if (!entry) {
      throw new Error(`Process ${name} not registered`);
    }
    
    if (!entry.process || entry.status !== 'running') {
      console.warn(`[A11-Supervisor] Process ${name} is not running`);
      return;
    }
    
    console.log(`[A11-Supervisor] Stopping process: ${name} (PID ${entry.pid})`);
    
    // Disable auto-restart before killing
    entry.config.autoRestart = false;
    
    try {
      entry.process.kill('SIGTERM');
      
      // Force kill after 5 seconds if still running
      setTimeout(() => {
        if (entry.process && entry.status === 'running') {
          console.warn(`[A11-Supervisor] Force killing ${name}`);
          entry.process.kill('SIGKILL');
        }
      }, 5000);
      
      this.emit('stop', { name, pid: entry.pid });
    } catch (err) {
      console.error(`[A11-Supervisor] Error stopping ${name}:`, err.message);
      throw err;
    }
  }

  /**
   * Restart a process
   * @param {string} name - Process name
   */
  restart(name) {
    const entry = this.processes.get(name);
    if (!entry) {
      throw new Error(`Process ${name} not registered`);
    }
    
    console.log(`[A11-Supervisor] Restarting process: ${name}`);
    
    // Reset restart counter
    entry.restarts = 0;
    
    if (entry.status === 'running') {
      // Stop then start
      entry.config.autoRestart = true; // Re-enable auto-restart
      this.stop(name);
      setTimeout(() => this.start(name), 1000);
    } else {
      this.start(name);
    }
  }

  /**
   * Get status of all processes
   * @returns {Object} Status information
   */
  getStatus() {
    const status = {
      supervisor: {
        config: {
          maxRestarts: this.config.maxRestarts,
          restartDelay: this.config.restartDelay
        }
      },
      processes: {}
    };
    
    for (const [name, entry] of this.processes) {
      const uptime = entry.startTime && entry.status === 'running' 
        ? ((Date.now() - entry.startTime) / 1000).toFixed(2) 
        : null;
      
      status.processes[name] = {
        status: entry.status,
        pid: entry.pid,
        restarts: entry.restarts,
        uptime,
        autoRestart: entry.config.autoRestart
      };
    }
    
    return status;
  }

  /**
   * Stop all running processes
   */
  stopAll() {
    console.log('[A11-Supervisor] Stopping all processes...');
    for (const name of this.processes.keys()) {
      try {
        this.stop(name);
      } catch (err) {
        console.error(`[A11-Supervisor] Error stopping ${name}:`, err.message);
      }
    }
  }
}

module.exports = { A11Supervisor };
