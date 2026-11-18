import { digest, localDemo, parseJson, query, randomToken, readText, ScannerError, seconds, utf8, type ScannerEnv } from './runtime';

const COOKIE = 'masar_scan';
const SESSION_TTL = 12 * 60 * 60;

async function credential(env: ScannerEnv, url: URL) {
  const code = localDemo(env,url) ? 'demo-masar' : env.SCANNER_ACCESS_CODE;
  if (!code || (!localDemo(env,url) && !/^[a-f0-9]{32,128}$/.test(code))) {
    throw new ScannerError(503,'login_unconfigured','رمز الدخول التجريبي غير مهيأ.');
  }
  return code;
}

export async function verifySecret(candidate: string, expected: string) {
  const key = await crypto.subtle.importKey('raw',utf8.encode(expected),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);
  const signed = await crypto.subtle.sign('HMAC',key,utf8.encode(expected));
  return crypto.subtle.verify('HMAC',key,signed,utf8.encode(candidate));
}

function cookie(value: string, url: URL, maxAge: number) {
  return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${url.protocol==='https:' ? '; Secure' : ''}`;
}

async function cookieHash(request: Request) {
  const match = request.headers.get('cookie')?.match(/(?:^|;\s*)masar_scan=([a-f0-9]{64})(?:;|$)/);
  return match ? digest(match[1]) : null;
}

export async function login(request: Request, env: ScannerEnv, url: URL) {
  const {code} = parseJson(await readText(request,2048));
  const expected = await credential(env,url);
  const at = seconds();
  const subject = await digest(request.headers.get('cf-connecting-ip') ?? 'local');
  const limit = await query(env,`INSERT INTO scanner_login_limits(subject,attempts,expires_at) VALUES (?,1,?)
    ON CONFLICT(subject) DO UPDATE SET
      attempts=CASE WHEN expires_at<=? THEN 1 ELSE min(attempts+1,11) END,
      expires_at=CASE WHEN expires_at<=? THEN excluded.expires_at ELSE expires_at END
    RETURNING attempts`,subject,at+600,at,at).first<{attempts:number}>();
  if (!limit || limit.attempts>10) throw new ScannerError(429,'login_limit','محاولات كثيرة. أعد المحاولة بعد عشر دقائق.');
  if (typeof code!=='string' || !await verifySecret(code.trim(),expected)) {
    throw new ScannerError(401,'bad_login','رمز الدخول غير صحيح.');
  }
  const token = randomToken();
  const version = await digest(expected);
  await query(env,'INSERT INTO scanner_sessions(token_hash,credential_version,expires_at) VALUES (?,?,?)',
    await digest(token),version,at+SESSION_TTL).run();
  return cookie(token,url,SESSION_TTL);
}

export async function signedIn(request: Request, env: ScannerEnv, url: URL) {
  const token = await cookieHash(request);
  if (!token) return false;
  const version = await digest(await credential(env,url));
  return !!await query(env,'SELECT 1 FROM scanner_sessions WHERE token_hash=? AND credential_version=? AND expires_at>?',
    token,version,seconds()).first();
}

export async function logout(request: Request, env: ScannerEnv, url: URL) {
  const token = await cookieHash(request);
  if (token) await query(env,'DELETE FROM scanner_sessions WHERE token_hash=?',token).run();
  return cookie('',url,0);
}
