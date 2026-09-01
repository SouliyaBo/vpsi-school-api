import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { BadRequestException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import { AppException } from 'src/common/exceptions/app.exception';
import { AppConfig } from 'src/config/configuration';

export interface UploadResult {
  key: string;
  sizeBytes: number;
  mimeType: string;
  filename: string;
}

/** What a caller may upload, per purpose. */
export const UPLOAD_RULES = {
  photo: {
    mimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
    maxBytes: 5 * 1024 * 1024,
    prefix: 'photos',
  },
  document: {
    // Word, Excel and PowerPoint in both the legacy and the OOXML flavour, plus
    // PDF and a photographed page. A lesson plan arrives as whichever of these
    // the teacher happens to write in, and a rejected upload at that point reads
    // as the feature being broken.
    mimeTypes: [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'image/jpeg',
      'image/png',
    ],
    maxBytes: 20 * 1024 * 1024,
    prefix: 'documents',
  },
  report: {
    mimeTypes: ['application/pdf'],
    maxBytes: 50 * 1024 * 1024,
    prefix: 'reports',
  },
} as const;

export type UploadKind = keyof typeof UPLOAD_RULES;

/**
 * S3-compatible object storage (MinIO in dev, any S3 in production).
 *
 * Only object *keys* are stored in Mongo. URLs are minted on read as short-lived
 * signed URLs, so a leaked database row does not grant access to a student's
 * photo, and rotating the bucket or endpoint needs no data migration.
 */
@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly signedUrlTtl: number;

  constructor(private readonly config: ConfigService<AppConfig, true>) {
    this.bucket = config.get('S3_BUCKET', { infer: true });
    this.signedUrlTtl = config.get('S3_SIGNED_URL_TTL_SECONDS', { infer: true });
    this.client = new S3Client({
      endpoint: config.get('S3_ENDPOINT', { infer: true }),
      region: config.get('S3_REGION', { infer: true }),
      // MinIO serves buckets as path segments rather than subdomains.
      forcePathStyle: config.get('S3_FORCE_PATH_STYLE', { infer: true }),
      credentials: {
        accessKeyId: config.get('S3_ACCESS_KEY', { infer: true }),
        secretAccessKey: config.get('S3_SECRET_KEY', { infer: true }),
      },
    });
  }

  /** Warns rather than throws: the API should still serve non-file routes. */
  async onModuleInit(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      this.logger.log(`Object storage ready (bucket: ${this.bucket})`);
    } catch {
      this.logger.warn(
        `Bucket "${this.bucket}" is not reachable. File uploads and downloads will fail ` +
          `until it exists — run "docker compose up minio-init" to create it.`,
      );
    }
  }

  async upload(
    file: { buffer: Buffer; originalname: string; mimetype: string; size: number },
    kind: UploadKind,
    /** Optional grouping segment, e.g. a student id. */
    scope?: string,
  ): Promise<UploadResult> {
    const rule = UPLOAD_RULES[kind];

    if (!(rule.mimeTypes as readonly string[]).includes(file.mimetype)) {
      throw new BadRequestException(
        `Unsupported file type "${file.mimetype}". Allowed: ${rule.mimeTypes.join(', ')}`,
      );
    }
    if (file.size > rule.maxBytes) {
      throw new BadRequestException(
        `File exceeds the ${Math.round(rule.maxBytes / 1024 / 1024)} MB limit for ${kind} uploads`,
      );
    }

    // A random key rather than the original filename: filenames can carry Lao
    // characters, path separators, and duplicates, none of which belong in a key.
    const key = [rule.prefix, scope, `${randomUUID()}${extname(file.originalname).toLowerCase()}`]
      .filter(Boolean)
      .join('/');

    // Naming the cause is the whole point of catching here.
    //
    // A store that is down (MinIO not started in development, a wrong endpoint in
    // production) surfaced as a bare AWS `AggregateError` and then as a generic
    // 500 — which reads as "the upload feature is broken" and sends someone
    // looking through the wrong code. This says what actually failed, and the log
    // line carries the underlying error for whoever fixes the environment.
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: file.buffer,
          ContentType: file.mimetype,
          // Preserve the original name for downloads without trusting it as a key.
          Metadata: { 'original-name': encodeURIComponent(file.originalname) },
        }),
      );
    } catch (error) {
      this.logger.error(
        `Upload to "${this.bucket}" failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw AppException.unprocessable('common.storageUnavailable', { bucket: this.bucket });
    }

    return {
      key,
      sizeBytes: file.size,
      mimeType: file.mimetype,
      filename: file.originalname,
    };
  }

  /** Stores a buffer produced by the app itself (e.g. a rendered PDF). */
  async putBuffer(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }),
    );
  }

  /**
   * Reads an object back into memory.
   *
   * Returns `null` for a key that is not there rather than throwing, because a
   * missing file is a normal state for a record whose rendering failed — the
   * caller re-renders instead of erroring.
   */
  async getBuffer(key: string | null | undefined): Promise<Buffer | null> {
    if (!key) return null;
    try {
      const result = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      const body = result.Body;
      if (!body) return null;
      return Buffer.from(await body.transformToByteArray());
    } catch (error) {
      this.logger.warn(
        `Could not read ${key} from ${this.bucket}: ` +
          (error instanceof Error ? error.message : String(error)),
      );
      return null;
    }
  }

  async getSignedUrl(key: string | null | undefined): Promise<string | null> {
    if (!key) return null;
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: key }), {
      expiresIn: this.signedUrlTtl,
    });
  }

  async delete(key: string | null | undefined): Promise<void> {
    if (!key) return;
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}
