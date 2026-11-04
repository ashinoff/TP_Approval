import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

// 32 MiB, three passes; parameters are fixed rather than accepted from stored input.
const derive = (password:string, salt:Buffer) => new Promise<Buffer>((resolve,reject) =>
  scrypt(password,salt,32,{N:32768,r:8,p:3,maxmem:64*1024*1024},(error,key) => error?reject(error):resolve(key)));

// Тестовый режим: минимум 4 символа по решению владельца 04.11.2026; до работы с реальными данными вернуть 12.
export const PASSWORD_MIN=4;
export async function hashPassword(password:string) {
  const salt=randomBytes(16);
  return `scrypt-v1:${salt.toString('hex')}:${(await derive(password,salt)).toString('hex')}`;
}

export async function checkPassword(password:string, encoded:string) {
  if(!/^scrypt-v1:[a-f0-9]{32}:[a-f0-9]{64}$/.test(encoded))return false;
  const [,salt,key]=encoded.split(':');
  return timingSafeEqual(await derive(password,Buffer.from(salt,'hex')),Buffer.from(key,'hex'));
}
