import { S3Client } from '@aws-sdk/client-s3';
import { AWSS3Bucket } from 'src/constant/providers.constant';

export default {
  provide: AWSS3Bucket,
  useFactory() {
    return new S3Client({
      region: process.env.AWS_REGION,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      },
    });
  },
};
