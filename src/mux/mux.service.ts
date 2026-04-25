import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import Mux from '@mux/mux-node';
import { ENV } from '../env.config';
import { Recording } from '../recording/entities/recording.entity';
import * as crypto from 'crypto';
import axios from 'axios';
import { MUX_API_BASE_URL } from 'src/constant/constant';

/**
 * Service for interacting with the Mux API.
 */
@Injectable()
export class MuxService {
  private readonly mux: Mux;
  private readonly logger = new Logger(MuxService.name);

  /**
   * @param recordingRepository The repository for the Recording entity.
   */
  constructor(
    @InjectRepository(Recording)
    private readonly recordingRepository: Repository<Recording>,
  ) {
    this.mux = new Mux({
      tokenId: ENV.MUX_TOKEN_ID,
      tokenSecret: ENV.MUX_TOKEN_SECRET,
    });
  }

  /**
   * Creates a new Mux asset from a file in S3 and updates the corresponding recording entity.
   * This process is asynchronous and does not block the request.
   * @param s3Url The pre-signed S3 URL of the file to upload.
   * @param key The object key of the file in the S3 bucket.
   * @param recordingId The ID of the recording to associate the Mux asset with.
   */
  async uploadFromS3(
    s3Url: string,
    key: string,
    recordingId: string,
  ): Promise<void> {
    this.logger.log(
      `Starting Mux upload for recordingId: ${recordingId} (key: ${key})`,
    );

    const muxTokenId = process.env.MUX_TOKEN_ID;
    const muxTokenSecret = process.env.MUX_TOKEN_SECRET;

    try {
      // Clean URL - remove any quotes, whitespace, or newlines
      let cleanUrl = String(s3Url).trim();
      cleanUrl = cleanUrl.replace(/^["']|["']$/g, ''); // Remove leading/trailing quotes
      cleanUrl = cleanUrl.replace(/\\/g, ''); // Remove backslashes
      cleanUrl = cleanUrl.replace(/[\r\n]/g, ''); // Remove newlines

      this.logger.log(`Original URL: ${s3Url}`);
      this.logger.log(`Cleaned URL: ${cleanUrl}`);

      // Validate URL format
      if (!cleanUrl.startsWith('http')) {
        throw new Error(`Invalid URL format: ${cleanUrl}`);
      }

      // Prepare request data
      // When `MUX_SIGNING_KEY_ID` is configured we issue assets with the `signed` policy so
      // playback URLs only work in-app (the app obtains a short-lived JWT from the backend).
      // Otherwise we keep the original `public` policy for backwards compatibility.
      const usesSignedPolicy = !!process.env.MUX_SIGNING_KEY_ID;
      const data = {
        input: cleanUrl,
        playback_policy: [usesSignedPolicy ? 'signed' : 'public'],
        encoding_tier: 'smart',
      };

      // Make axios request to Mux API with raw JSON string
      const response = await axios({
        method: 'POST',
        url: `${MUX_API_BASE_URL}/video/v1/assets`,
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        auth: {
          username: muxTokenId,
          password: muxTokenSecret,
        },
        data: data,
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
      });

      this.logger.log(`Mux API Response Status: ${response.status}`);
      this.logger.log(
        `Mux API Response Data: ${JSON.stringify(response.data, null, 2)}`,
      );

      const asset = response.data.data;

      this.logger.log(
        `Mux asset created in process with ID: ${asset.id} for recordingId: ${recordingId}`,
      );

      if (asset) {
        const recording = await this.recordingRepository.findOne({
          where: { id: recordingId },
        });

        if (recording) {
          recording.mux_asset_id = asset.id;
          if (asset.playback_ids && asset.playback_ids.length > 0) {
            const playbackId = asset.playback_ids[0].id;
            recording.mux_playback_id = playbackId;
            recording.mux_media_url = `https://stream.mux.com/${playbackId}.m3u8`;
            this.logger.log(
              `Updated mux_media_url to ${recording.mux_media_url} in process for recordingId: ${recordingId}`,
            );
          }
          await this.recordingRepository.save(recording);
          await this.recordingRepository.update(recordingId, {
            status: 'completed',
          });
          this.logger.log(
            `Saved Mux details to database for recordingId: ${recordingId}`,
          );
        } else {
          this.logger.warn(
            `Recording record not found for recordingId: ${recordingId}`,
          );
        }
      }
    } catch (error) {
      this.logger.error(
        `Error uploading to Mux or saving to DB for recordingId: ${recordingId}`,
      );
      if (error.response) {
        this.logger.error(
          `Mux API Error Response: ${JSON.stringify(error.response.data)}`,
        );
        this.logger.error(`Mux API Status: ${error.response.status}`);
      } else {
        this.logger.error(`Error details: ${error.message}`);
        this.logger.error(error.stack);
      }
      await this.recordingRepository.update(recordingId, {
        status: 'failed',
      });
    }
  }

  /**
   * Retrieves detailed information about a Mux asset including timing data.
   *
   * @param assetId The Mux asset ID
   * @returns Asset details with timing information
   */
  async getAssetDetails(assetId: string): Promise<any> {
    try {
      this.logger.log(`Retrieving asset details for asset ID: ${assetId}`);

      const asset = await this.mux.video.assets.retrieve(assetId);

      this.logger.log(
        `Asset details retrieved successfully for ID: ${assetId}`,
        {
          duration: asset.duration,
          aspectRatio: asset.aspect_ratio,
          createdAt: asset.created_at,
          status: asset.status,
        },
      );

      return asset;
    } catch (error) {
      this.logger.error(
        `Failed to retrieve asset details for ID: ${assetId}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Updates recording with timing information from Mux asset.
   * Simple approach assuming Mux always provides valid data.
   *
   * @param recordingId The recording ID to update
   * @param assetId The Mux asset ID
   */
  async updateRecordingWithTimingFromAsset(
    recordingId: string,
    assetId: string,
  ): Promise<void> {
    try {
      this.logger.log(
        `Updating recording ${recordingId} with timing from asset ${assetId}`,
      );

      const asset = await this.getAssetDetails(assetId);
      const recording = await this.recordingRepository.findOne({
        where: { id: recordingId },
      });

      if (!recording) {
        this.logger.warn(`Recording not found for ID: ${recordingId}`);
        return;
      }

      this.logger.log(`Asset duration: ${asset.duration}`);
      this.logger.log(`Asset created_at: ${asset.created_at}`);
      this.logger.log(`Recording start time: ${recording.startTime}`);

      // Use existing recording start time or Mux asset creation time
      const startTime = new Date(asset.created_at);

      // Calculate end time from start time + duration
      const durationMs = parseFloat(asset.duration) * 1000;
      const endTime = new Date(startTime.getTime() + durationMs);

      this.logger.log(`Calculated start time: ${startTime.toISOString()}`);
      this.logger.log(`Calculated end time: ${endTime.toISOString()}`);

      // Update recording
      await this.recordingRepository.update(
        { id: recordingId },
        {
          startTime: startTime,
          endTime: endTime,
        },
      );

      this.logger.log(
        `Successfully updated recording ${recordingId} with timing data`,
        {
          startTime: startTime.toISOString(),
          endTime: endTime.toISOString(),
          duration: asset.duration,
        },
      );
    } catch (error) {
      this.logger.error(
        `Failed to update recording ${recordingId} with timing from asset ${assetId}`,
        {
          error: error.message,
          stack: error.stack,
        },
      );
      // Don't throw - just log error so highlight creation continues
    }
  }

  /**
   * Verifies the signature of a Mux webhook following official Mux documentation.
   * @param rawBody The raw request body as received (string format)
   * @param muxSignatureHeader The mux-signature header value
   * @param secret The webhook signing secret
   * @returns void (throws error if verification fails)
   */
  verifyWebhookSignature(
    rawBody: string,
    muxSignatureHeader: string,
    secret: string,
  ): void {
    this.logger.debug('Starting Mux webhook signature verification', {
      bodyLength: rawBody?.length,
      bodyType: typeof rawBody,
      hasSignatureHeader: !!muxSignatureHeader,
      secretProvided: !!secret,
    });

    // Step 1: Basic validation
    if (!rawBody) {
      throw new Error(
        'Raw request body is required for signature verification',
      );
    }

    if (!muxSignatureHeader) {
      throw new Error('mux-signature header is missing');
    }

    if (!secret) {
      throw new Error('Webhook signing secret is required');
    }

    // Step 2: Extract timestamp and signature from header
    // Header format: "t=timestamp,v1=signature" or "t=timestamp,v1=signature1,v1=signature2"
    const parts = muxSignatureHeader.split(',');
    let timestamp: number | null = null;
    const signatures: string[] = [];

    for (const part of parts) {
      const trimmedPart = part.trim();
      const [key, value] = trimmedPart.split('=');

      if (key === 't') {
        timestamp = parseInt(value, 10);
      } else if (key === 'v1') {
        signatures.push(value);
      }
    }

    if (timestamp === null || isNaN(timestamp)) {
      throw new Error(
        'Unable to extract valid timestamp from mux-signature header',
      );
    }

    if (signatures.length === 0) {
      throw new Error('No v1 signatures found in mux-signature header');
    }

    this.logger.debug('Extracted from signature header', {
      timestamp,
      signaturesCount: signatures.length,
      signatures: signatures.slice(0, 2), // Log first 2 for debugging
    });

    // Step 3: Check timestamp tolerance (5 minutes as per Mux docs)
    const currentTime = Math.floor(Date.now() / 1000);
    const timestampAge = currentTime - timestamp;
    const tolerance = 300; // 5 minutes in seconds

    if (timestampAge > tolerance) {
      throw new Error(
        `Webhook timestamp is too old. Age: ${timestampAge}s, tolerance: ${tolerance}s`,
      );
    }

    // Step 4: Prepare the signed payload string
    // Format: timestamp + "." + raw_request_body
    const signedPayload = `${timestamp}.${rawBody}`;

    this.logger.debug('Signature verification payload', {
      payloadLength: signedPayload.length,
      payloadPreview: signedPayload.substring(0, 100),
    });

    // Step 5: Determine the expected signature using HMAC SHA256
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(signedPayload, 'utf8')
      .digest('hex');

    this.logger.debug('Signature comparison', {
      expectedSignature,
      receivedSignatures: signatures,
    });

    // Step 6: Compare signatures (timing-safe comparison)
    let signatureValid = false;
    for (const signature of signatures) {
      try {
        // Both signatures should be hex strings of same length
        if (signature.length === expectedSignature.length) {
          const expectedBuffer = Buffer.from(expectedSignature, 'hex');
          const receivedBuffer = Buffer.from(signature, 'hex');

          if (crypto.timingSafeEqual(expectedBuffer, receivedBuffer)) {
            signatureValid = true;
            this.logger.debug('Valid signature found');
            break;
          }
        }
      } catch (error) {
        this.logger.debug('Signature comparison error', {
          error: error.message,
          signature,
        });
        // Continue to next signature
      }
    }

    if (!signatureValid) {
      this.logger.error('Webhook signature verification failed', {
        expectedSignature,
        receivedSignatures: signatures,
        payloadLength: signedPayload.length,
        secretLength: secret.length,
        timestamp,
        timestampAge,
      });
      throw new Error(
        'Webhook signature verification failed - no matching signatures found',
      );
    }

    this.logger.debug('Mux webhook signature verification successful');
  }

  verifyWebhookSignatureOld(body: any, headers: any, secret: any) {
    this.mux.webhooks.verifySignature(body, headers, secret);
  }

  /**
   * Issues a Mux signed-playback JWT (RS256) for a given `playback_id`.
   * Returns `null` if the signing key isn't configured — the caller can fall back to
   * the bare public URL for legacy assets created before signed-policy was enabled.
   *
   * Required env: `MUX_SIGNING_KEY_ID`, `MUX_PRIVATE_KEY` (PEM, may be base64-encoded).
   */
  signPlaybackToken(
    playbackId: string,
    ttlSeconds = 60 * 60 * 6,
  ): { token: string; expires_at: Date } | null {
    const keyId = process.env.MUX_SIGNING_KEY_ID;
    let privateKeyRaw = process.env.MUX_PRIVATE_KEY;

    if (!keyId || !privateKeyRaw) {
      return null;
    }

    try {
      // Allow callers to pass the PEM as base64 to avoid newline/escape issues in env files.
      if (!privateKeyRaw.includes('BEGIN')) {
        try {
          privateKeyRaw = Buffer.from(privateKeyRaw, 'base64').toString('utf8');
        } catch {
          // fall through with the original value
        }
      }
      // Convert literal "\n" sequences (common in env loaders) into real newlines.
      const privateKey = privateKeyRaw.replace(/\\n/g, '\n');

      const now = Math.floor(Date.now() / 1000);
      const exp = now + ttlSeconds;
      const header = {
        alg: 'RS256',
        typ: 'JWT',
        kid: keyId,
      };
      const payload = {
        sub: playbackId,
        aud: 'v',
        exp,
        kid: keyId,
      };

      const b64url = (input: Buffer | string) =>
        (typeof input === 'string' ? Buffer.from(input) : input)
          .toString('base64')
          .replace(/=+$/g, '')
          .replace(/\+/g, '-')
          .replace(/\//g, '_');

      const headerB64 = b64url(JSON.stringify(header));
      const payloadB64 = b64url(JSON.stringify(payload));
      const signingInput = `${headerB64}.${payloadB64}`;

      const signer = crypto.createSign('RSA-SHA256');
      signer.update(signingInput);
      signer.end();
      const signature = signer.sign(privateKey);
      const signatureB64 = b64url(signature);

      return {
        token: `${signingInput}.${signatureB64}`,
        expires_at: new Date(exp * 1000),
      };
    } catch (err) {
      this.logger.error('Failed to sign Mux playback token', err);
      return null;
    }
  }
}
