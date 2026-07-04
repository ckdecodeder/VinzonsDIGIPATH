const { spawn } = require('child_process');

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const services = [
  { name: 'backend', args: ['--prefix', 'backend', 'run', 'dev'] },
  { name: 'dashboard', args: ['--prefix', 'dashboard', 'run', 'dev'] },
];

let shuttingDown = false;

const children = services.map((service) => {
  const child = spawn(npmCommand, service.args, {
    cwd: process.cwd(),
    shell: true,
    stdio: ['inherit', 'pipe', 'pipe'],
  });

  child.stdout.on('data', (chunk) => {
    process.stdout.write(`[${service.name}] ${chunk}`);
  });
  child.stderr.on('data', (chunk) => {
    process.stderr.write(`[${service.name}] ${chunk}`);
  });
  child.on('exit', (code) => {
    if (code && !shuttingDown) {
      console.error(`[${service.name}] exited with code ${code}`);
      shutdown(code);
    }
  });

  return child;
});

const shutdown = (code = 0) => {
  if (shuttingDown) return;
  shuttingDown = true;
  children.forEach((child) => {
    if (!child.killed) child.kill();
  });
  process.exitCode = code;
};

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
