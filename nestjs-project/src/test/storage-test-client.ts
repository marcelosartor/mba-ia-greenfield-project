import { DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';
import storageConfig from '../config/storage.config';

/** Direct S3 client for test cleanup, independent from the code under test. */
export function createStorageTestClient(): S3Client {
  const config = storageConfig();
  return new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: true,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
}

export async function deleteStoredObject(
  client: S3Client,
  bucket: string,
  key: string,
): Promise<void> {
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}
