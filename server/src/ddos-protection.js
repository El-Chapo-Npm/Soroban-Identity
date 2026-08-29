import crypto from 'node:crypto';

/**
 * Lightweight origin-side DDoS controls. Edge providers should reject most
 * volumetric traffic before it reaches the process; this module protects the
 * remaining origin capacity and is intentionally dependency-free.
 */
export class DdosProtection {
  constructor(config = {}, { verifyCaptcha = null, onAlert = null, now = () => Date.now() } = {}) {
    this.enabled = config.ddosProtectionEnabled === true;
    this.windowMs = config.ddosWindowMs ?? 60_000;
    this.maxRequests = config.ddosMaxRequestsPerIp ?? 120;
    this.maxConnections = config.ddosMaxConnectionsPerIp ?? 20;
    this.suspiciousThreshold = config.ddosSuspiciousThreshold ?? Math.max(1, Math.floor(this.maxRequests * 0.8));
    this.trustProxy = config.trustProxy === true;
    this.blockedRegions = new Set((config.ddosBlockedRegions ?? []).map((region) => region.toUpperCase()));
    this.captchaEnabled = config.ddosCaptchaEnabled === true;
    this.captchaSecret = config.ddosCaptchaSecret ?? '';
    this.captchaUrl = config.ddosCaptchaUrl ?? 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
    this.verifyCaptcha = verifyCaptcha;
    this.onAlert = onAlert;
    this.now = now;
    this.requests = new Map();
    this.connections = new Map();
    this.alerted = new Set();
  }

  clientIp(req) {
    if (this.trustProxy) {
      const forwarded = req.headers['x-forwarded-for'];
      if (forwarded) return String(forwarded).split(',')[0].trim();
      if (req.headers['cf-connecting-ip']) return String(req.headers['cf-connecting-ip']);
    }
    return req.socket?.remoteAddress ?? 'unknown';
  }

  region(req) {
    return String(req.headers['cf-ipcountry'] ?? req.headers['x-geo-country'] ?? '').toUpperCase();
  }

  async check(req) {
    if (!this.enabled) return { allowed: true, ip: this.clientIp(req), reason: null };
    const ip = this.clientIp(req);
    const region = this.region(req);
    if (region && this.blockedRegions.has(region)) {
      await this.alert('geo_block', { ip, region });
      return { allowed: false, status: 403, reason: 'geo_blocked', ip, region };
    }

    const now = this.now();
    const timestamps = (this.requests.get(ip) ?? []).filter((time) => now - time < this.windowMs);
    timestamps.push(now);
    this.requests.set(ip, timestamps);
    const suspicious = timestamps.length >= this.suspiciousThreshold;
    if (timestamps.length > this.maxRequests) {
      await this.alert('rate_limit', { ip, count: timestamps.length, region });
      return { allowed: false, status: 429, reason: 'ip_rate_limited', ip, retryAfter: Math.ceil(this.windowMs / 1000) };
    }
    if (suspicious && this.captchaEnabled && !(await this.hasValidCaptcha(req, ip))) {
      await this.alert('captcha_challenge', { ip, count: timestamps.length, region });
      return { allowed: false, status: 403, reason: 'captcha_required', ip, captchaRequired: true };
    }
    return { allowed: true, ip, region, remaining: Math.max(0, this.maxRequests - timestamps.length), suspicious };
  }

  connectionOpened(ip) {
    if (!this.enabled) return true;
    const count = (this.connections.get(ip) ?? 0) + 1;
    this.connections.set(ip, count);
    if (count > this.maxConnections) {
      this.connections.set(ip, count - 1);
      void this.alert('connection_limit', { ip, count });
      return false;
    }
    return true;
  }

  connectionClosed(ip) {
    const count = Math.max(0, (this.connections.get(ip) ?? 1) - 1);
    if (count === 0) this.connections.delete(ip); else this.connections.set(ip, count);
  }

  async hasValidCaptcha(req, ip) {
    const token = req.headers['cf-turnstile-response'] ?? req.headers['x-captcha-token'];
    if (!token || !this.captchaSecret) return false;
    if (this.verifyCaptcha) return Boolean(await this.verifyCaptcha({ token: String(token), secret: this.captchaSecret, ip }));
    try {
      const response = await fetch(this.captchaUrl, {
        method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ secret: this.captchaSecret, response: String(token), remoteip: ip }),
      });
      return response.ok && Boolean((await response.json()).success);
    } catch { return false; }
  }

  async alert(type, details) {
    const fingerprint = crypto.createHash('sha256').update(`${type}:${details.ip}:${Math.floor(this.now() / this.windowMs)}`).digest('hex');
    if (this.alerted.has(fingerprint)) return;
    this.alerted.add(fingerprint);
    if (this.onAlert) await this.onAlert({ type, ...details });
  }

  stats() {
    return { trackedIps: this.requests.size, activeConnections: [...this.connections.values()].reduce((sum, value) => sum + value, 0), blockedRegions: [...this.blockedRegions] };
  }
}

export function ddosResponse(res, result) {
  if (result.reason === 'ip_rate_limited') res.setHeader('Retry-After', String(result.retryAfter));
  if (result.captchaRequired) res.setHeader('X-Captcha-Required', 'turnstile');
  res.writeHead(result.status ?? 429, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ error: result.reason, message: result.reason === 'captcha_required' ? 'Complete the CAPTCHA challenge and retry.' : 'Request blocked by traffic protection.' }));
}

export default DdosProtection;

// SHA-256 is used only for alert deduplication; it is not an authentication primitive.
void crypto;
