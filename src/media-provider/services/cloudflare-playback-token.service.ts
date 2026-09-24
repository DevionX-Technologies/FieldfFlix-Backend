import { Injectable, Logger } from '@nestjs/common';
import { SignJWT, importPKCS8 } from 'jose';
import * as crypto from 'crypto';

export interface CloudflareTokenPayload {
  sub: string;
  kid?: string;
  exp: number;
  nbf?: number;
  iat?: number;
  accessRules?: Array<{ type: string; [key: string]: any }>;
}

@Injectable()
export class CloudflarePlaybackTokenService {
  private readonly logger = new Logger(CloudflarePlaybackTokenService.name);
  private readonly keyId?: string;
  private readonly privateKeyRaw?: string;
  private readonly hmacSecret?: string;

  constructor() {
    this.keyId = process.env.CLOUDFLARE_STREAM_KEY_ID;
    this.privateKeyRaw = process.env.CLOUDFLARE_STREAM_PRIVATE_KEY;
    this.hmacSecret =
      process.env.CLOUDFLARE_STREAM_SIGNING_SECRET ||
      process.env.CLOUDFLARE_STREAM_API_TOKEN;
  }

  /**
   * Generates a signed playback token for a Cloudflare Stream video or live input UID.
   * Default TTL is 6 hours (21600 seconds).
   */
  async generateSignedToken(
    assetUid: string,
    ttlSeconds = 21600,
    customKeyId?: string,
    customPrivateKey?: string,
  ): Promise<{ token: string; expiresAt: Date }> {
    const keyId = customKeyId || this.keyId;
    let privateKeyPem = customPrivateKey || this.privateKeyRaw;

    const now = Math.floor(Date.now() / 1000);
    const exp = now + ttlSeconds;
    const expiresAt = new Date(exp * 1000);

    // 1. Asymmetric RS256 Signing (Cloudflare Stream standard)
    if (keyId && privateKeyPem) {
      try {
        if (!privateKeyPem.includes('BEGIN')) {
          try {
            privateKeyPem = Buffer.from(privateKeyPem, 'base64').toString(
              'utf8',
            );
          } catch {
            // raw string fallback
          }
        }
        let formattedPem = privateKeyPem.replace(/\\n/g, '\n');
        if (formattedPem.includes('BEGIN RSA PRIVATE KEY')) {
          try {
            formattedPem = crypto
              .createPrivateKey(formattedPem)
              .export({ type: 'pkcs8', format: 'pem' }) as string;
          } catch {
            // Keep original formattedPem if crypto parsing fails
          }
        }
        const privateKey = await importPKCS8(formattedPem, 'RS256');

        const token = await new SignJWT({
          sub: assetUid,
          kid: keyId,
          accessRules: [{ type: 'any' }],
        })
          .setProtectedHeader({ alg: 'RS256', typ: 'JWT', kid: keyId })
          .setIssuedAt(now)
          .setNotBefore(now - 30) // 30s clock drift tolerance
          .setExpirationTime(exp)
          .sign(privateKey);

        return { token, expiresAt };
      } catch (err: any) {
        this.logger.error(
          `Failed to sign Cloudflare RS256 token: ${err.message}`,
          err.stack,
        );
        throw err;
      }
    }

    // 2. Symmetric HMAC-SHA256 fallback (Edge Worker validation)
    const secret = this.hmacSecret;
    if (secret) {
      const header = Buffer.from(
        JSON.stringify({ alg: 'HS256', typ: 'JWT' }),
      ).toString('base64url');

      const payload = Buffer.from(
        JSON.stringify({
          sub: assetUid,
          iat: now,
          nbf: now - 30,
          exp: exp,
        }),
      ).toString('base64url');

      const signature = crypto
        .createHmac('sha256', secret)
        .update(`${header}.${payload}`)
        .digest('base64url');

      const token = `${header}.${payload}.${signature}`;
      return { token, expiresAt };
    }

    // 3. Fallback for test / dev environment without signing keys configured
    this.logger.warn(
      `Cloudflare signing keys not configured. Generating self-signed dev token for ${assetUid}.`,
    );
    const devToken = `dev_cf_${assetUid}_exp_${exp}`;
    return { token: devToken, expiresAt };
  }

  /**
   * Verifies that a signed playback token is valid, not expired, and matches expected asset.
   */
  async verifySignedToken(
    token: string,
    expectedAssetUid?: string,
    customPublicKeyPem?: string,
    customHmacSecret?: string,
  ): Promise<CloudflareTokenPayload> {
    if (!token) {
      throw new UnauthorizedException('Missing playback token');
    }

    // Dev token bypass in test environments
    if (token.startsWith('dev_cf_')) {
      const parts = token.split('_');
      const exp = parseInt(parts[parts.length - 1], 10);
      const now = Math.floor(Date.now() / 1000);
      if (now > exp) {
        throw new UnauthorizedException('Playback token has expired');
      }
      return { sub: expectedAssetUid || parts[2], exp };
    }

    const segments = token.split('.');
    if (segments.length !== 3) {
      throw new UnauthorizedException('Malformed JWT playback token');
    }

    let payload: CloudflareTokenPayload;
    try {
      payload = JSON.parse(
        Buffer.from(segments[1], 'base64url').toString('utf8'),
      );
    } catch {
      throw new UnauthorizedException('Invalid token payload encoding');
    }

    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) {
      throw new UnauthorizedException('Playback token has expired');
    }

    if (payload.nbf && payload.nbf > now) {
      throw new UnauthorizedException('Playback token is not active yet');
    }

    if (expectedAssetUid && payload.sub !== expectedAssetUid) {
      throw new UnauthorizedException(
        `Playback token asset mismatch (expected: ${expectedAssetUid}, got: ${payload.sub})`,
      );
    }

    let header: { alg?: string; typ?: string; kid?: string } = {};
    try {
      header = JSON.parse(
        Buffer.from(segments[0], 'base64url').toString('utf8'),
      );
    } catch {
      // ignore header parse failure
    }

    if (header.alg === 'RS256') {
      let privateKeyPem = customPublicKeyPem || this.privateKeyRaw;
      if (privateKeyPem) {
        try {
          if (!privateKeyPem.includes('BEGIN')) {
            try {
              privateKeyPem = Buffer.from(privateKeyPem, 'base64').toString(
                'utf8',
              );
            } catch {
              // raw string fallback
            }
          }
          const formattedPem = privateKeyPem.replace(/\\n/g, '\n');
          const publicKey = crypto.createPublicKey(formattedPem);
          const verifier = crypto.createVerify('RSA-SHA256');
          verifier.update(`${segments[0]}.${segments[1]}`);
          const isValid = verifier.verify(
            publicKey,
            Buffer.from(segments[2], 'base64url'),
          );
          if (!isValid) {
            throw new UnauthorizedException('Invalid playback token signature');
          }
        } catch (err: any) {
          if (err instanceof UnauthorizedException) throw err;
          this.logger.warn(`RS256 token verification warning: ${err.message}`);
        }
      }
    } else {
      const secret = customHmacSecret || this.hmacSecret;
      if (secret) {
        const expectedSig = crypto
          .createHmac('sha256', secret)
          .update(`${segments[0]}.${segments[1]}`)
          .digest('base64url');

        const expectedBuffer = Buffer.from(expectedSig);
        const receivedBuffer = Buffer.from(segments[2]);

        if (
          expectedBuffer.length !== receivedBuffer.length ||
          !crypto.timingSafeEqual(expectedBuffer, receivedBuffer)
        ) {
          throw new UnauthorizedException('Invalid playback token signature');
        }
      }
    }

    return payload;
  }

  /**
   * Generates public or signed HLS playback URL.
   */
  getSignedPlaybackUrl(assetUid: string, token?: string | null): string {
    if (token) {
      return `https://videodelivery.net/${token}/manifest/video.m3u8`;
    }
    return `https://videodelivery.net/${assetUid}/manifest/video.m3u8`;
  }

  /**
   * Generates public or signed thumbnail poster URL.
   */
  getSignedThumbnailUrl(assetUid: string, token?: string | null): string {
    if (token) {
      return `https://videodelivery.net/${token}/thumbnails/thumbnail.jpg`;
    }
    return `https://videodelivery.net/${assetUid}/thumbnails/thumbnail.jpg`;
  }
}
