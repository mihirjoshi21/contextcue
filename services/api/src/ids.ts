// Unambiguous charset: no 0/O, 1/I/L, etc.
const CHARSET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function generateSessionCode(length = 6): string {
  let code = '';
  for (let i = 0; i < length; i++) {
    code += CHARSET[Math.floor(Math.random() * CHARSET.length)];
  }
  return code;
}
