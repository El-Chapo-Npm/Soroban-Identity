import { isIP } from "node:net";

function parseAddress(value) {
  if (typeof value !== "string") return null;
  let address = value.trim();
  if (address.startsWith("[") && address.endsWith("]")) {
    address = address.slice(1, -1);
  }
  address = address.replace(/%[^%]+$/, "");
  const version = isIP(address);
  if (version === 4) {
    const octets = address.split(".").map(Number);
    return {
      version: 4,
      bits: 32,
      value: octets.reduce((result, octet) => (result << 8n) | BigInt(octet), 0n),
    };
  }
  if (version !== 6) return null;

  let expanded = address.toLowerCase();
  const ipv4 = expanded.match(/(?:^|:)(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (ipv4) {
    const octets = ipv4[1].split(".").map(Number);
    const high = ((octets[0] << 8) | octets[1]).toString(16);
    const low = ((octets[2] << 8) | octets[3]).toString(16);
    expanded = expanded.replace(ipv4[1], `${high}:${low}`);
  }

  const halves = expanded.split("::");
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length > 1 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  if (missing < 0 || (halves.length === 1 && missing !== 0)) return null;
  const groups = [...left, ...Array(missing).fill("0"), ...right];
  if (groups.length !== 8) return null;
  const valueBigInt = groups.reduce(
    (result, group) => (result << 16n) | BigInt(`0x${group || "0"}`),
    0n,
  );
  // Treat IPv4-mapped IPv6 addresses as their IPv4 equivalent so an entry
  // such as 203.0.113.8 also matches ::ffff:203.0.113.8 from Node sockets.
  if ((valueBigInt >> 32n) === 0xffffn) {
    return { version: 4, bits: 32, value: valueBigInt & 0xffffffffn };
  }
  return { version: 6, bits: 128, value: valueBigInt };
}

function parseRange(value) {
  const [address, prefixText, ...extra] = value.split("/");
  if (extra.length > 0) return null;
  const parsed = parseAddress(address);
  if (!parsed) return null;
  const prefix = prefixText === undefined ? parsed.bits : Number(prefixText);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > parsed.bits) return null;
  return { ...parsed, prefix };
}

function matchesRange(address, range) {
  if (!address || address.version !== range.version) return false;
  const shift = BigInt(address.bits - range.prefix);
  return (address.value >> shift) === (range.value >> shift);
}

/** Resolve the request's network peer, trusting forwarded headers only when configured. */
export function getClientAddress(req, trustProxy = false) {
  if (trustProxy) {
    const forwarded = req?.headers?.["x-forwarded-for"];
    if (typeof forwarded === "string" && forwarded.trim()) {
      const firstHop = forwarded.split(",")[0].trim();
      if (parseAddress(firstHop)) return firstHop;
    }
  }
  return req?.socket?.remoteAddress ?? req?.connection?.remoteAddress ?? "";
}

/** Match a request's resolved peer against exact IPs or IPv4/IPv6 CIDR ranges. */
export function isIpAllowed(address, allowlist) {
  const client = parseAddress(address);
  if (!client || !Array.isArray(allowlist) || allowlist.length === 0) return false;
  return allowlist.some((entry) => {
    const range = typeof entry === "string" ? parseRange(entry.trim()) : null;
    return range && matchesRange(client, range);
  });
}

export function isAdminIpAllowed(req, config) {
  const allowlist = config.adminIpAllowlist ?? [];
  if (allowlist.length === 0) return config.adminIpAllowlistRequired !== true;
  return isIpAllowed(getClientAddress(req, config.trustProxy === true), allowlist);
}
