import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { validateEnv } from 'src/config/configuration';
import { StorageModule } from 'src/modules/storage/storage.module';
import { StorageService } from 'src/modules/storage/storage.service';

/**
 * Proves the object-storage settings work, against the real bucket.
 *
 *   npm run storage:check
 *
 * Exercises StorageService rather than the HTTP route: the route adds auth and
 * the homeroom rule, and neither is what an S3 misconfiguration breaks. Uploads a
 * real PNG, signs a URL, fetches it back, compares the bytes, checks the object
 * is *not* public, then deletes it so the bucket is left as it was found.
 *
 * Worth running whenever S3_ENDPOINT, S3_BUCKET or the keys change: the two
 * mistakes it catches both fail confusingly otherwise. Naming the bucket inside
 * S3_ENDPOINT makes the SDK ask for `bucket.bucket.s3…` and the error is a TLS
 * certificate complaint; a bucket that does not exist is a bare 404 on the first
 * upload, long after startup. StorageService only warns at boot, so neither shows
 * up until someone tries to save a photo.
 */
@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }), StorageModule],
})
class StorageCliModule {}

/** The smallest valid PNG: one opaque red pixel. */
const RED_PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64',
);

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(StorageCliModule, {
    logger: ['warn', 'error'],
  });
  const storage = app.get(StorageService);
  let key: string | null = null;

  try {
    const result = await storage.upload(
      {
        buffer: RED_PIXEL,
        originalname: 'ຮູບນັກຮຽນ.png',
        mimetype: 'image/png',
        size: RED_PIXEL.length,
      },
      'photo',
      'connection-test',
    );
    key = result.key;
    console.log('1. upload      OK  key =', result.key, `(${result.sizeBytes} bytes)`);

    const url = await storage.getSignedUrl(key);
    if (!url) throw new Error('no signed URL returned');
    const host = new URL(url).host;
    const expiresIn = new URL(url).searchParams.get('X-Amz-Expires');
    console.log('2. sign URL    OK  host =', host, '| expires in', expiresIn, 's');

    const response = await fetch(url);
    const body = Buffer.from(await response.arrayBuffer());
    const matches = body.equals(RED_PIXEL);
    console.log(
      '3. fetch back ',
      response.ok && matches ? 'OK ' : 'FAIL',
      ` HTTP ${response.status}, ${body.length} bytes, bytes match: ${matches}`,
    );

    // Unsigned, to prove the bucket is not publicly readable — a student photo
    // must not be fetchable by anyone who guesses the key.
    const unsigned = await fetch(url.split('?')[0]);
    console.log(
      '4. unsigned   ',
      unsigned.status === 403 || unsigned.status === 404 ? 'OK ' : 'WARN',
      ` HTTP ${unsigned.status} (403/404 means the object is not public)`,
    );
  } finally {
    if (key) {
      await storage.delete(key);
      console.log('5. cleanup     OK  test object deleted');
    }
    await app.close();
  }
}

void main().catch((error: unknown) => {
  console.error('FAILED:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
