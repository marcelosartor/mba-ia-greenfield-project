import { registerAs } from '@nestjs/config';

export default registerAs('storage', () => ({
  endpoint: process.env.STORAGE_ENDPOINT || 'http://minio:9000',
  region: process.env.STORAGE_REGION || 'us-east-1',
  accessKeyId: process.env.STORAGE_ACCESS_KEY_ID!,
  secretAccessKey: process.env.STORAGE_SECRET_ACCESS_KEY!,
  videosBucket: process.env.STORAGE_BUCKET_VIDEOS || 'videos',
  thumbnailsBucket: process.env.STORAGE_BUCKET_THUMBNAILS || 'thumbnails',
  publicEndpoint: process.env.STORAGE_PUBLIC_ENDPOINT,
}));
