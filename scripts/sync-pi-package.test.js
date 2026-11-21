const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

test('package sync handles relative and absolute destinations and rejects unsafe roots', { skip: process.platform !== 'win32' }, () => {
  const source = fs.readFileSync(path.join(__dirname, 'sync-pi-package.ps1'), 'utf8');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'digipath-package-test-'));
  const repo = path.join(temp, 'repo');
  const script = path.join(repo, 'scripts', 'sync-pi-package.ps1');
  try {
    fs.mkdirSync(path.dirname(script), { recursive: true });
    fs.writeFileSync(script, source);
    const files = [...source.matchAll(/\$(?:rootFiles|scriptFiles) = @\(([\s\S]*?)\n\)/g)]
      .flatMap(match => [...match[1].matchAll(/"([^"]+)"/g)].map(item => item[1]));
    assert.ok(files.length > 20);
    for (const file of files) {
      const target = path.join(repo, file); fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, 'synthetic fixture\n');
    }
    const run = destination => spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-Destination', destination], { cwd: temp, encoding: 'utf8', windowsHide: true });
    for (const destination of ['relative-package', path.join(temp, 'absolute-package')]) {
      const absolute = path.resolve(temp, destination);
      fs.mkdirSync(absolute); fs.writeFileSync(path.join(absolute, '.env'), 'SYNTHETIC_SETTING=preserved\n');
      fs.writeFileSync(path.join(absolute, 'stray.txt'), 'synthetic stray');
      const result = run(destination); assert.equal(result.status, 0, result.stderr);
      for (const file of files) assert.equal(fs.readFileSync(path.join(absolute, file), 'utf8'), 'synthetic fixture\n');
      assert.equal(fs.readFileSync(path.join(absolute, '.env'), 'utf8'), 'SYNTHETIC_SETTING=preserved\n');
      assert.equal(fs.existsSync(path.join(absolute, 'stray.txt')), false);
    }
    for (const destination of [repo, temp, path.parse(temp).root]) assert.notEqual(run(destination).status, 0);
    assert.equal(fs.readFileSync(script, 'utf8'), source);
  } finally {
    assert.ok(path.resolve(temp).startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(temp, { recursive: true, force: true });
  }
});


test('Pi updater validates private configuration before any update', { skip: process.platform !== 'win32' }, () => {
  const bash = 'C:/Program Files/Git/bin/bash.exe';
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'digipath-env-test-'));
  try {
    const scripts = path.join(temp, 'scripts'); fs.mkdirSync(scripts);
    fs.copyFileSync(path.join(__dirname, 'pi-load-env.sh'), path.join(scripts, 'pi-load-env.sh'));
    const source = fs.readFileSync(path.join(__dirname, 'pi-update-network.sh'), 'utf8');
    const preflight = path.join(scripts, 'preflight.sh');
    fs.writeFileSync(preflight, source.slice(0, source.indexOf('update_env_file()')));
    const syntax = spawnSync(bash, ['-n', path.join(__dirname, 'pi-update-network.sh')], { encoding: 'utf8', windowsHide: true });
    assert.equal(syntax.status, 0, syntax.stderr || syntax.error?.message);
    for (const key of ['', 'short', 'dev-device-key-change-me', 'synthetic-private-key-01234567890123456789']) {
      const config = `DIGIPATH_DEVICE_API_KEY=${key}\nUNRELATED_SETTING=preserved\n`;
      fs.writeFileSync(path.join(temp, '.env'), config);
      const result = spawnSync(bash, [preflight], { encoding: 'utf8', windowsHide: true });
      assert.equal(result.status === 0, key.length >= 32, result.stderr);
      assert.equal(fs.readFileSync(path.join(temp, '.env'), 'utf8'), config);
      assert.ok(!result.stdout.includes(key) || !key);
    }
  } finally {
    assert.ok(path.resolve(temp).startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
