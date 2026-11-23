import zlib from 'node:zlib';
import { logger } from './logger.js';

const COMPRESSIBLE = /^(text\/|application\/(json|javascript|xml|graphql|wasm)|image\/svg\+xml)/i;
const NEVER_COMPRESS = /^(image\/(?!svg\+xml)|audio\/|video\/|font\/(woff2|otf)|application\/(zip|gzip|br|x-rar-compressed|pdf))/i;

function parseAcceptEncoding(value) {
  return String(value || '').split(',').map((part) => {
    const [name, ...params] = part.trim().toLowerCase().split(';');
    const q = params.find((p) => p.trim().startsWith('q='));
    return { name, q: q ? Number.parseFloat(q.split('=')[1]) : 1 };
  }).filter(({ name, q }) => name && Number.isFinite(q) && q > 0);
}

export function negotiateEncoding(header, { enableBrotli = true } = {}) {
  const accepted = parseAcceptEncoding(header);
  const quality = (name) => accepted.find((item) => item.name === name)?.q
    ?? accepted.find((item) => item.name === '*')?.q
    ?? 0;
  const candidates = [
    ...(enableBrotli ? [{ name: 'br', q: quality('br') }] : []),
    { name: 'gzip', q: quality('gzip') },
  ].filter((item) => item.q > 0).sort((a, b) => b.q - a.q);
  return candidates[0]?.name ?? null;
}

export class CompressionMiddleware {
  constructor(options = {}) {
    this.threshold = Math.max(0, options.threshold ?? 1024);
    this.gzipLevel = options.gzipLevel ?? 6;
    this.brotliLevel = options.brotliLevel ?? 4;
    this.enableBrotli = options.enableBrotli ?? true;
    this.metrics = options.metrics ?? null;
    this.logger = options.logger ?? logger;
  }

  shouldCompress(req, res) {
    const contentType = String(res.getHeader('content-type') || '').split(';', 1)[0];
    const length = Number(res.getHeader('content-length'));
    if (res.getHeader('content-encoding') || res.statusCode === 204 || req.method === 'HEAD') return null;
    if (Number.isFinite(length) && length < this.threshold) return null;
    if (!COMPRESSIBLE.test(contentType) || NEVER_COMPRESS.test(contentType)) return null;
    return negotiateEncoding(req.headers['accept-encoding'], { enableBrotli: this.enableBrotli });
  }

  middleware() {
    return (req, res) => {
      const originalWrite = res.write.bind(res);
      const originalEnd = res.end.bind(res);
      const originalSetHeader = res.setHeader.bind(res);
      let stream = null;
      let encoding = null;
      let inputBytes = 0;
      let outputBytes = 0;
      let started = false;

      const start = () => {
        if (started) return;
        started = true;
        encoding = this.shouldCompress(req, res);
        if (!encoding) return;
        stream = encoding === 'br'
          ? zlib.createBrotliCompress({ params: { [zlib.constants.BROTLI_PARAM_QUALITY]: this.brotliLevel } })
          : zlib.createGzip({ level: this.gzipLevel });
        originalSetHeader('Content-Encoding', encoding);
        originalSetHeader('Vary', 'Accept-Encoding');
        originalSetHeader('Transfer-Encoding', 'chunked');
        res.removeHeader('Content-Length');
        stream.on('data', (chunk) => { outputBytes += chunk.length; originalWrite(chunk); });
        stream.on('end', () => {
          this.metrics?.observeCompression?.({ encoding, originalSize: inputBytes, compressedSize: outputBytes, ratio: inputBytes ? outputBytes / inputBytes : 1 });
        });
      };

      res.setHeader = (name, value) => {
        if (String(name).toLowerCase() === 'content-length' && stream) return res;
        return originalSetHeader(name, value);
      };
      res.write = (chunk, chunkEncoding, callback) => {
        start();
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, chunkEncoding);
        inputBytes += buffer.length;
        if (stream) return stream.write(buffer, callback);
        return originalWrite(chunk, chunkEncoding, callback);
      };
      res.end = (chunk, chunkEncoding, callback) => {
        start();
        if (!stream) return originalEnd(chunk, chunkEncoding, callback);
        if (chunk) {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, chunkEncoding);
          inputBytes += buffer.length;
          stream.end(buffer, callback);
        } else stream.end(callback);
        return res;
      };
    };
  }
}

export function createCompressionMiddleware(options = {}) {
  return new CompressionMiddleware(options);
}
