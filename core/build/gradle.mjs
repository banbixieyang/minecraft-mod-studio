/**
 * Gradle 集成。
 *
 * 24 小时里最容易出问题的一段：Windows 上必须走 cmd 才能执行 .bat，
 * 而且 Gradle 的彩色输出需要关掉才好在界面上看。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const IS_WIN = process.platform === 'win32';

/** 正在跑的构建：projectRoot -> job */
const jobs = new Map();

export function gradleWrapper(root) {
  const bat = path.join(root, 'gradlew.bat');
  const sh = path.join(root, 'gradlew');
  if (IS_WIN && fs.existsSync(bat)) return { cmd: bat, shell: false };
  if (fs.existsSync(sh)) return { cmd: sh, shell: false };
  if (fs.existsSync(bat)) return { cmd: bat, shell: false };
  return null;
}

export function hasWrapper(root) {
  return gradleWrapper(root) !== null;
}

/**
 * 启动一个 Gradle 任务。
 * @returns job 对象：{ id, task, lines, running, exitCode, startedAt }
 */
export function runGradle(root, task, opts = {}) {
  const key = path.resolve(root);
  if (jobs.has(key) && jobs.get(key).running) {
    throw new Error('这个工程已经有构建在跑，等它结束再试');
  }
  const wrapper = gradleWrapper(root);
  if (!wrapper) throw new Error('工程里没有 Gradle wrapper（gradlew），无法构建。请先用编辑器新建工程。');

  const job = {
    id: `build-${Date.now()}`,
    task,
    lines: [],
    running: true,
    exitCode: null,
    startedAt: Date.now(),
    endedAt: null,
    error: null,
  };
  jobs.set(key, job);

  const args = ['--console=plain', '--no-daemon', task];
  // Java 25 的 toolchain 由 foojay 自动下载，不需要额外环境变量
  const env = { ...process.env, TERM: 'dumb', NO_COLOR: '1', FORCE_COLOR: '0' };

  let child;
  try {
    // Windows 下 .bat 必须经 cmd 执行；用 shell:true 会把参数拼接错，所以显式 cmd /c
    child = IS_WIN && wrapper.cmd.endsWith('.bat')
      ? spawn('cmd.exe', ['/c', wrapper.cmd, ...args], { cwd: root, env, windowsHide: true })
      : spawn(wrapper.cmd, args, { cwd: root, env });
  } catch (e) {
    job.running = false;
    job.error = e.message;
    job.exitCode = -1;
    return job;
  }

  // Gradle 在 Windows 上会把「任务名」和「任务状态」分两次写到同一行，
  // 直接按换行切会得到 "> Task :compileJava" 和孤零零的 " UP-TO-DATE"。
  // 这里把状态贴回上一行，没有信息量的状态整行丢掉。
  const ANSI = /\x1b\[[0-9;]*m/g;
  const BARE_STATUS = /^(UP-TO-DATE|NO-SOURCE|FROM-CACHE|SKIPPED|SUCCESSFUL|FAILED)$/;
  const QUIET_STATUS = new Set(['UP-TO-DATE', 'NO-SOURCE', 'FROM-CACHE', 'SKIPPED']);

  const pushLines = (chunk) => {
    const text = chunk.toString('utf8').replace(ANSI, '');
    for (const raw of text.split(/\r\n|\r|\n/)) {
      const line = raw.replace(/\s+$/, '');
      const trimmed = line.trim();
      if (!trimmed) continue;
      // 进度条动画
      if (/^<[-= ]+>$/.test(trimmed)) continue;

      if (BARE_STATUS.test(trimmed)) {
        const prev = job.lines[job.lines.length - 1];
        if (prev && prev.startsWith('> Task ')) {
          if (QUIET_STATUS.has(trimmed)) job.lines.pop();
          else job.lines[job.lines.length - 1] = `${prev} ${trimmed}`;
        }
        continue;
      }

      job.lines.push(line);
      if (job.lines.length > 4000) job.lines.splice(0, 1000);
    }
  };

  child.stdout?.on('data', pushLines);
  child.stderr?.on('data', pushLines);

  child.on('error', (e) => {
    job.running = false;
    job.error = e.message;
    job.exitCode = -1;
    job.endedAt = Date.now();
  });

  child.on('close', (code) => {
    job.running = false;
    job.exitCode = code;
    job.endedAt = Date.now();
  });

  const timeoutMs = opts.timeoutMs || 15 * 60 * 1000;
  setTimeout(() => {
    if (job.running) {
      job.error = '构建超时（超过 15 分钟），已终止';
      try {
        child.kill('SIGKILL');
      } catch {
        /* 忽略 */
      }
    }
  }, timeoutMs).unref?.();

  return job;
}

export function getJob(root) {
  return jobs.get(path.resolve(root)) || null;
}

/** 增量读取：返回 sinceIndex 之后的新行，界面用它做长轮询 */
export function tailJob(root, sinceIndex = 0) {
  const job = jobs.get(path.resolve(root));
  if (!job) return null;
  const from = Math.max(0, Math.min(sinceIndex, job.lines.length));
  return {
    id: job.id,
    task: job.task,
    running: job.running,
    exitCode: job.exitCode,
    error: job.error,
    total: job.lines.length,
    next: job.lines.length,
    lines: job.lines.slice(from),
    elapsedMs: (job.endedAt || Date.now()) - job.startedAt,
  };
}

/** 找到构建产物 jar */
export function findArtifacts(root) {
  const dir = path.join(root, 'build', 'libs');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.jar') && !f.endsWith('-sources.jar') && !f.endsWith('-dev.jar'))
    .map((f) => {
      const abs = path.join(dir, f);
      const st = fs.statSync(abs);
      return { name: f, path: abs, size: st.size, mtime: st.mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime);
}

/**
 * 从构建日志里提取对人类有用的错误摘要。
 * 只挑真正指向「哪一行错了」的行，不要整段倾倒。
 */
export function extractErrors(job) {
  if (!job) return [];
  const out = [];
  const lines = job.lines;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/error:|错误:/.test(l)) {
      out.push(l.trim());
      // 跟着的一两行通常指向具体代码
      for (let k = 1; k <= 2 && i + k < lines.length; k++) {
        const nx = lines[i + k].trim();
        if (nx && !/^at |^\.\.\./.test(nx)) out.push('  ' + nx);
      }
      if (out.length > 40) break;
    }
  }
  return out;
}

/** 探测本机 JDK（构建前给用户一个明确提示，而不是等 Gradle 报错） */
export function detectJava() {
  return new Promise((resolve) => {
    const child = IS_WIN
      ? spawn('cmd.exe', ['/c', 'java -version'], { windowsHide: true })
      : spawn('java', ['-version']);
    let out = '';
    child.stdout?.on('data', (d) => (out += d));
    child.stderr?.on('data', (d) => (out += d));
    child.on('error', () => resolve({ ok: false, version: null }));
    child.on('close', (code) => {
      const m = out.match(/version "?(\d+)(?:\.(\d+))?/);
      resolve({ ok: code === 0, version: m ? Number(m[1]) : null, raw: out.split('\n')[0] });
    });
  });
}

export function platformInfo() {
  return { platform: process.platform, arch: os.arch(), node: process.version, cpus: os.cpus().length };
}
