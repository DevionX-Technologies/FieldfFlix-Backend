# S3 Bucket Configuration for Mux

## Problem

Mux error: "URL could not be downloaded" even though the URL works in browser.

This happens because Mux needs specific permissions to access your S3 bucket.

## Solution

You need to configure your S3 bucket with proper **CORS** and **Bucket Policy** to allow Mux to download files.

## Step 1: Configure CORS

Add this CORS configuration to your S3 bucket:

```json
[
  {
    "AllowedHeaders": ["*"],
    "AllowedMethods": ["GET", "HEAD"],
    "AllowedOrigins": ["*"],
    "ExposeHeaders": ["Content-Length", "Content-Type", "ETag"],
    "MaxAgeSeconds": 3000
  }
]
```

### How to Add CORS (AWS Console):

1. Go to AWS S3 Console
2. Select your bucket: `fieldflicks-production-media`
3. Go to **Permissions** tab
4. Scroll to **Cross-origin resource sharing (CORS)**
5. Click **Edit**
6. Paste the CORS configuration above
7. Click **Save changes**

## Step 2: Update Bucket Policy (Optional but Recommended)

If Mux still can't access, add this bucket policy:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowMuxAccess",
      "Effect": "Allow",
      "Principal": "*",
      "Action": ["s3:GetObject"],
      "Resource": "arn:aws:s3:::fieldflicks-production-media/recordings/*",
      "Condition": {
        "IpAddress": {
          "aws:SourceIp": [
            "35.197.98.0/24",
            "35.189.86.0/24",
            "34.102.110.0/24",
            "34.145.96.0/24",
            "34.145.97.0/24",
            "34.145.98.0/24",
            "34.145.99.0/24"
          ]
        }
      }
    }
  ]
}
```

**Note:** The IP ranges above are Mux's known IP ranges. You can also make it simpler by allowing all IPs for the recordings folder.

### Simpler Bucket Policy (Less Secure but Works):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "PublicReadForRecordings",
      "Effect": "Allow",
      "Principal": "*",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::fieldflicks-production-media/recordings/*"
    }
  ]
}
```

### How to Add Bucket Policy:

1. Go to AWS S3 Console
2. Select your bucket: `fieldflicks-production-media`
3. Go to **Permissions** tab
4. Scroll to **Bucket policy**
5. Click **Edit**
6. Paste one of the policies above
7. Click **Save changes**

## Step 3: Verify Block Public Access Settings

Make sure "Block all public access" is **OFF** for the recordings folder:

1. Go to **Permissions** tab
2. Look at **Block public access (bucket settings)**
3. Click **Edit**
4. Uncheck "Block all public access"
5. Click **Save changes**
6. Type "confirm" when prompted

⚠️ **Security Note:** This makes your recordings publicly accessible via direct URL. If you need more security, use the Mux IP whitelist approach in Step 2.

## Step 4: Test the Configuration

After applying the changes, test if Mux can access your files:

```bash
# Test from command line (should return video content)
curl -I "https://fieldflicks-production-media.s3.ap-south-1.amazonaws.com/recordings/YOUR-VIDEO.mp4"
```

Expected response:

```
HTTP/1.1 200 OK
Content-Type: video/mp4
Content-Length: [file size]
...
```

## Alternative: Use Direct S3 URLs (No Presigned URLs)

If you make the recordings folder public, you can use direct URLs instead of presigned URLs:

**Current (Presigned URL):**

```
https://fieldflicks-production-media.s3.ap-south-1.amazonaws.com/recordings/video.mp4?X-Amz-Algorithm=...
```

**Alternative (Direct URL):**

```
https://fieldflicks-production-media.s3.ap-south-1.amazonaws.com/recordings/video.mp4
```

To use direct URLs, modify the code to skip presigned URL generation for Mux uploads:

```typescript
// In triggerMuxUpload method, instead of presigned URL:
const directUrl = `https://${bucketName}.s3.${process.env.AWS_REGION}.amazonaws.com/${s3Key}`;
await this.muxService.uploadFromS3(directUrl, s3Path, recordingId);
```

## Code Changes Applied

The following changes were made to fix URL issues:

1. ✅ Clean URL to remove extra quotes: `.trim().replace(/^["']|["']$/g, '')`
2. ✅ Normalize S3 key path (remove `video/`, ensure `recordings/`)
3. ✅ Use 7-day expiration for presigned URLs (Mux requirement)
4. ✅ Better error logging

## Troubleshooting

### Still Getting "Could not be downloaded" Error?

**Option 1: Check Mux Dashboard**

- Go to Mux Dashboard → Assets
- Find the failed asset
- Check the error message for more details

**Option 2: Test the URL Manually**

```bash
# Copy the presigned URL from logs and test it
curl -v "[PRESIGNED_URL]"
```

**Option 3: Use Direct S3 URLs**
If presigned URLs keep failing, switch to direct S3 URLs (see Alternative section above).

**Option 4: Contact Mux Support**
If the issue persists, Mux support can help debug why their servers can't access your URLs.

## Security Recommendations

For production:

1. ✅ Use Mux IP whitelist in bucket policy (most secure)
2. ✅ Keep presigned URLs with 7-day expiration
3. ✅ Enable S3 access logging to monitor downloads
4. ✅ Use CloudFront in front of S3 for better security and caching
5. ❌ Avoid "Block all public access" on recordings folder (breaks Mux)

## Environment-Specific Settings

Make sure these environment variables are set:

```env
AWS_REGION=ap-south-1
APP_NAME=fieldflicks
ENVIRONMENT=production
```

Bucket name is constructed as: `${APP_NAME}-${ENVIRONMENT}-media`
