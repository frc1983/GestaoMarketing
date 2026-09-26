import { pbkdf2Sync, randomBytes } from 'node:crypto';

const password = process.env.MARKETING_PASSWORD;
if (!password || password.length < 10) {
  console.error('Defina MARKETING_PASSWORD com pelo menos 10 caracteres.');
  process.exit(1);
}
const rounds = 210_000;
const salt = randomBytes(16);
const hash = pbkdf2Sync(password, salt, rounds, 32, 'sha256');
console.log(`pbkdf2-sha256$${rounds}$${salt.toString('base64')}$${hash.toString('base64')}`);
