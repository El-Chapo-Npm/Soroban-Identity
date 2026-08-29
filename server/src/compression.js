import zlib from 'node:zlib';
import { logger } from './logger.js';

/**
 * Configuration for response compression middleware.
 * Supports gzip and brotli compression.
 */
export class CompressionMiddleware {
  constructor(options = {}) {
    // Minimum response size in bytes before compression is applied (default 1KB)
    this.threshold = options.threshold ?? 1024;
    
    // Compression level (0-9 for gzip, 0-11 for brotli)
    this.gzipLevel = options.gzipLevel ?? zlib.constants.Z_DEFAULT_COMPRESSION;
    this.brotliLevel = options.brotliLevel ?? 4;
    
    // Whether to enable brotli compression (requires Node.js >= 10.16.0)
    this.enableBrotli = options.enableBrotli ?? true;
    
    // Content types that should NOT be compressed (already compressed)
    this.excludeContentTypes = new Set(options.excludeContentTypes ?? [
      'application/gzip',
      'application/x-gzip',
      'application/br',
      'application/x-brotli',
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp',
      'audio/mpeg',
      'audio/mp4',
      'video/mp4',
      'video/webm',
      'font/woff2',
    ]);
    
    // Content types that should be compressed
    this.includeContentTypes = new Set(options.includeContentTypes ?? [
      'text/plain',
      'text/html',
      'text/css',
      'text/javascript',
      'application/javascript',
      'application/json',
      'application/xml',
      'application/xhtml+xml',
      'image/svg+xml',
      'font/woff',
      'font/ttf',
      'font/eot',
      'application/octet-stream',
    ]);
    
    this.metrics = options.metrics ?? null;
    this.logger = options.logger ?? logger;
  }

  /**
   * Determine if response should be compressed based on Content-Type and size.
   */
  shouldCompress(req, res, contentType, contentLength) {
    // Don't compress if client doesn't support it
    const acceptEncoding = req.headers['accept-encoding'] || '';
    const supportsCompression = acceptEncoding.includes('gzip') || 
                                (this.enableBrotli && acceptEncoding.includes('br'));
    if (!supportsCompression) return null;
    
    // Don't compress if already below threshold
    if (contentLength && contentLength < this.threshold) return null;
    
    // Don't compress if already compressed
    if (res.getHeader('content-encoding')) return null;
    
    // Check content type
    const mimeType = contentType ? contentType.split(';')[0].trim() : '';
    if (this.excludeContentTypes.has(mimeType)) return null;
    
    // Determine compression algorithm preference
    if (this.enableBrotli && acceptEncoding.includes('br')) {
      return 'br';
    }
    if (acceptEncoding.includes('gzip')) {
      return 'gzip';
    }
    
    return null;
  }

  /**
   * Create a compression transform stream.
   */
  createCompressionStream(encoding) {
    if (encoding === 'br') {
      return zlib.createBrotliCompress({
        params: {
          [zlib.constants.BROTLI_PARAM_QUALITY]: this.brotliLevel,
        },
      });
    }
    
    return zlib.createGzip({
      level: this.gzipLevel,
    });
  }

  /**
   * Middleware function to enable response compression.
   */
  middleware() {
    return async (req, res) => {
      const originalWrite = res.write.bind(res);
      const originalEnd = res.end.bind(res);
      const originalSetHeader = res.setHeader.bind(res);
      
      let compressionStream = null;
      let compressionStarted = false;
      let originalContentLength = null;
      const startTime = process.hrtime.bigint();
      
      // Override setHeader to intercept content-type and content-length
      res.setHeader = function(name, value) {
        if (name.toLowerCase() === 'content-length') {
          originalContentLength = Number.parseInt(value, 10);
          // Don't set content-length when we're compressing
          if (compressionStream) return res;
        }
        return originalSetHeader(name, value);
      };
      
      // Override write to enable compression on first write
      res.write = function(chunk, encoding, callback) {
        if (!compressionStarted) {
          compressionStarted = true;
          
          const contentType = res.getHeader('content-type');
          const encoding = this.shouldCompress(req, res, contentType, originalContentLength);
          
          if (encoding) {
            compressionStream = this.createCompressionStream(encoding);
            originalSetHeader('Content-Encoding', encoding);
            originalSetHeader('Vary', 'Accept-Encoding');
            
            // Pipe the compression stream to the original response
            compressionStream.pipe(res, { end: false });
            
            const endTime = process.hrtime.bigint();
            const durationMs = Number(endTime - startTime) / 1e6;
            
            if (this.metrics?.observeCompression) {
              this.metrics.observeCompression({ encoding, originalSize: originalContentLength, duration: durationMs });
            }
            
            this.logger.debug({ encoding, originalSize: originalContentLength }, 'Response compression enabled');
          }
        }
        
        if (compressionStream) {
          return compressionStream.write(chunk, encoding, callback);
        }
        return originalWrite(chunk, encoding, callback);
      }.bind(this);
      
      // Override end to finalize compression
      res.end = function(chunk, encoding, callback) {
        if (compressionStream && !compressionStream.writableEnded) {
          if (chunk) {
            compressionStream.write(chunk, encoding);
          }
          compressionStream.end(callback);
        } else {
          return originalEnd(chunk, encoding, callback);
        }
      }.bind(this);
      
      this.shouldCompress = this.shouldCompress.bind(this);
    }.bind(this);
  }
}

/**
 * Create a compression middleware configured with default settings.
 */
export function createCompressionMiddleware(config = {}) {
  return new CompressionMiddleware(config);
}
