export const ACCOUNT_SERVICE_URL = 'https://api.hexing.studio';
export const LEGACY_ACCOUNT_SERVICE_URL = 'https://api.hexing.studio/skill';

export function normalizeAccountServiceUrl(raw) {
  const address = new URL(raw);
  if (address.username || address.password || address.search || address.hash) throw new Error('账号服务地址不允许凭据、查询参数或片段');
  if (address.pathname === '/') return address.origin;
  return address.href.replace(/\/$/, '');
}

export function accountEndpoint(raw, { allowLoopback = false } = {}) {
  const normalized = normalizeAccountServiceUrl(raw);
  const serviceBaseUrl = [LEGACY_ACCOUNT_SERVICE_URL, 'https://shensi.hexing.studio'].includes(normalized) ? ACCOUNT_SERVICE_URL : normalized;
  const address = new URL(serviceBaseUrl);
  if (!(address.protocol === 'https:' || allowLoopback && address.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(address.hostname))) {
    throw new Error('账号服务只允许 HTTPS 或本机联调地址');
  }
  // Account identity also scopes existing vault keys, signed plugin pins and sealed files.
  const issuer = serviceBaseUrl === ACCOUNT_SERVICE_URL ? LEGACY_ACCOUNT_SERVICE_URL : serviceBaseUrl;
  return {issuer, serviceBaseUrl};
}
