import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import axios from 'axios';
import { S3Event } from 'aws-lambda';
import * as path from 'path';

const s3Client = new S3Client({ region: process.env.AWS_REGION });
const API_URL = process.env.API_URL;
const LAMBDA_API_KEY = process.env.LAMBDA_API_KEY;

/**
 * An AWS Lambda function that triggers when a new file is created in an S3 bucket.
 * It generates a pre-signed URL for the new file and calls an external API with the URL,
 * the object key, and the recording ID (derived from the filename).
 * @param event The S3 event that triggered the Lambda function.
 */
export const handler = async (event: S3Event): Promise<any> => {
  console.log('Received event:', JSON.stringify(event, null, 2));

  const bucket = event.Records[0].s3.bucket.name;
  const key = decodeURIComponent(
    event.Records[0].s3.object.key.replace(/\+/g, ' '),
  );
  const recordingId = path.basename(key, path.extname(key));

  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: key,
  });

  if (!API_URL) {
    throw new Error('API_URL environment variable is not set.');
  }

  if (!LAMBDA_API_KEY) {
    throw new Error('LAMBDA_API_KEY environment variable is not set.');
  }

  try {
    const signedUrl = await getSignedUrl(s3Client, command, {
      expiresIn: 3600,
    });

    console.log('Generated presigned URL:', signedUrl);

    await axios.post(
      API_URL,
      {
        s3Url: signedUrl,
        key: key,
        recordingId: recordingId,
      },
      {
        headers: {
          'x-api-key': LAMBDA_API_KEY,
        },
      },
    );

    console.log('Successfully called API');

    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'API called successfully' }),
    };
  } catch (error) {
    console.error('Error generating presigned URL or calling API:', error);
    throw error;
  }
};
