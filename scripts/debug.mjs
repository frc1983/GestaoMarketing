import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const fromPackage = (packageName, relativePath) => join(dirname(require.resolve(`${packageName}/package.json`)), relativePath);
const scripts = {
  tsc: fromPackage('typescript', 'bin/tsc'),
  vite: fromPackage('vite', 'bin/vite.js'),
  wrangler: fromPackage('wrangler', 'bin/wrangler.js'),
};

function run(name, args) {
  const script = scripts[name];
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], { stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(`${name} terminou com código ${code}`)));
  });
}

await run('tsc', ['--noEmit']);
await run('vite', ['build']);
await run('wrangler', [
  'dev', '--local', '--port', '8787', '--inspector-port', '9229',
  '--var', 'APP_ENV:local', '--var', 'DEV_AUTH_BYPASS:true',
]);
