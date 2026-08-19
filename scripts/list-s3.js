const {
  S3Client,
  ListBucketsCommand,
  ListObjectsV2Command,
} = require('@aws-sdk/client-s3');

process.env.AWS_REGION = 'ap-south-1';
const s3 = new S3Client({ region: 'ap-south-1' });

async function main() {
  console.log('Listing S3 buckets...');
  try {
    const response = await s3.send(new ListBucketsCommand({}));
    console.table(
      response.Buckets.map((b) => ({
        Name: b.Name,
        CreationDate: b.CreationDate.toLocaleString(),
      })),
    );
  } catch (error) {
    console.error('Error listing S3 buckets:', error.message);
  }
}

main();
