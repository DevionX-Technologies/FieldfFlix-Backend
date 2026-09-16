import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import * as dotenv from 'dotenv';
import axios from 'axios';
import * as crypto from 'crypto';
import * as fs from 'fs';

dotenv.config();

const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'eu-north-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  }
});

async function runS3Benchmark() {
  console.log('Starting S3 Upload Benchmark (Simulating Local Recording Server)...');
  
  const bucketName = process.env.AWS_S3_BUCKET_NAME || 'fieldflicks-media-assets';
  const testKey = `benchmark/test_video_${Date.now()}.mp4`;
  
  // 1. Generate a dummy 50MB file
  const fileSizeMB = 50;
  console.log(`[0s] Generating ${fileSizeMB}MB dummy video file...`);
  const buffer = crypto.randomBytes(fileSizeMB * 1024 * 1024);
  
  // 2. Generate Presigned URL
  console.log(`[+] Generating Presigned URL for s3://${bucketName}/${testKey}...`);
  const command = new PutObjectCommand({
    Bucket: bucketName,
    Key: testKey,
    ContentType: 'video/mp4'
  });
  
  const uploadUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 });
  
  // 3. Upload using Axios
  console.log(`[+] Uploading ${fileSizeMB}MB file to S3...`);
  const startTime = Date.now();
  
  try {
    await axios.put(uploadUrl, buffer, {
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Length': buffer.length
      },
      maxBodyLength: Infinity,
      maxContentLength: Infinity
    });
    
    const durationSec = (Date.now() - startTime) / 1000;
    const speedMbps = ((fileSizeMB * 8) / durationSec).toFixed(2);
    
    console.log(`\n✅ S3 Benchmark Complete!`);
    console.log(`Upload Duration: ${durationSec} seconds`);
    console.log(`Estimated Speed: ${speedMbps} Mbps`);
    
    // Estimate for a real 1-hour 1080p game (approx 2.7GB)
    const gameSizeMB = 2700;
    const estGameUploadSec = (gameSizeMB / fileSizeMB) * durationSec;
    console.log(`\n📊 Projection for a full 1-hour game (2.7 GB):`);
    console.log(`Estimated upload time: ${(estGameUploadSec / 60).toFixed(1)} minutes`);
    
  } catch (err) {
    console.error('S3 Upload failed:', err.message);
  }
}

runS3Benchmark().catch(console.error);
