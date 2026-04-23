# 🎯 Direct Lambda Invocation - Perfect for Your Use Case!

## ✅ **Exactly What You Wanted**

You said: _"i am not using api gateway only i want invoke this lambda only"_

## 🚀 **Direct Lambda Invocation Setup**

### **Input** (Direct Lambda Event):

```json
{
  "m3u8Url": "https://stream.mux.com/your-playback-id.m3u8",
  "uploadS3Path": "videos/converted/my-video.mp4",
  "bucketName": "your-fieldflicks-bucket",
  "quality": "medium"
}
```

### **Output** (Direct Lambda Response):

```json
{
  "success": true,
  "s3Path": "videos/converted/my-video.mp4",
  "bucketName": "your-fieldflicks-bucket",
  "signedUrl": "https://s3.amazonaws.com/presigned-url",
  "fileSize": 15728640,
  "duration": 120.5,
  "message": "M3U8 successfully converted to MP4 and uploaded to S3"
}
```

## 🔥 **How to Invoke Your Lambda**

### **1. AWS CLI Invocation**

```bash
aws lambda invoke \
  --function-name fieldflicks-m3u8-converter-dev-m3u8-converter \
  --payload '{
    "m3u8Url": "https://stream.mux.com/abc123.m3u8",
    "uploadS3Path": "converted/video.mp4",
    "bucketName": "fieldflicks-storage",
    "quality": "medium"
  }' \
  --cli-binary-format raw-in-base64-out \
  response.json

# Check the response
cat response.json
```

### **2. AWS SDK (Node.js)**

```javascript
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';

const lambda = new LambdaClient({ region: 'us-east-1' });

const invokeParams = {
  FunctionName: 'fieldflicks-m3u8-converter-dev-m3u8-converter',
  Payload: JSON.stringify({
    m3u8Url: 'https://stream.mux.com/abc123.m3u8',
    uploadS3Path: 'videos/converted/my-video.mp4',
    bucketName: 'my-bucket',
    quality: 'high',
  }),
};

const result = await lambda.send(new InvokeCommand(invokeParams));
const response = JSON.parse(new TextDecoder().decode(result.Payload));

console.log(response);
// {
//   "success": true,
//   "s3Path": "videos/converted/my-video.mp4",
//   "bucketName": "my-bucket",
//   "signedUrl": "https://...",
//   "fileSize": 15728640
// }
```

### **3. AWS SDK (Python)**

```python
import boto3
import json

lambda_client = boto3.client('lambda', region_name='us-east-1')

payload = {
    "m3u8Url": "https://stream.mux.com/abc123.m3u8",
    "uploadS3Path": "videos/converted/my-video.mp4",
    "bucketName": "my-bucket",
    "quality": "medium"
}

response = lambda_client.invoke(
    FunctionName='fieldflicks-m3u8-converter-dev-m3u8-converter',
    Payload=json.dumps(payload)
)

result = json.loads(response['Payload'].read())
print(result)
```

### **4. From Another Lambda**

```javascript
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';

export const handler = async (event) => {
  const lambda = new LambdaClient({ region: process.env.AWS_REGION });

  const conversionRequest = {
    m3u8Url: event.muxUrl,
    uploadS3Path: `recordings/${event.userId}/${event.recordingId}.mp4`,
    bucketName: process.env.VIDEOS_BUCKET,
    quality: 'high',
  };

  const result = await lambda.send(
    new InvokeCommand({
      FunctionName: process.env.M3U8_CONVERTER_FUNCTION,
      Payload: JSON.stringify(conversionRequest),
    }),
  );

  const response = JSON.parse(new TextDecoder().decode(result.Payload));

  if (response.success) {
    console.log(`Video converted: ${response.s3Path}`);
    return response;
  } else {
    throw new Error(`Conversion failed: ${response.message}`);
  }
};
```

### **5. Asynchronous Invocation**

```bash
# Fire and forget - Lambda runs in background
aws lambda invoke \
  --function-name fieldflicks-m3u8-converter-dev-m3u8-converter \
  --invocation-type Event \
  --payload '{
    "m3u8Url": "https://stream.mux.com/abc123.m3u8",
    "uploadS3Path": "async/video.mp4",
    "bucketName": "async-bucket"
  }' \
  --cli-binary-format raw-in-base64-out \
  async_response.json
```

## 📁 **File Organization Examples**

### **User-Based Organization**

```json
{
  "m3u8Url": "https://stream.mux.com/abc123.m3u8",
  "uploadS3Path": "users/john_doe/recordings/meeting_2025_01_07.mp4",
  "bucketName": "company-videos"
}
```

### **Date-Based Organization**

```json
{
  "m3u8Url": "https://stream.mux.com/xyz789.m3u8",
  "uploadS3Path": "archive/2025/january/sports_game.mp4",
  "bucketName": "sports-archive"
}
```

### **Category-Based Organization**

```json
{
  "m3u8Url": "https://stream.mux.com/premium.m3u8",
  "uploadS3Path": "premium/4k/movie_trailer.mp4",
  "bucketName": "premium-content"
}
```

## ⚡ **Performance Benefits**

### **Direct Invocation Advantages:**

- ✅ **No API Gateway overhead** - Direct Lambda execution
- ✅ **No HTTP timeouts** - Full 15-minute Lambda timeout
- ✅ **Lower latency** - No API Gateway processing delay
- ✅ **Cost effective** - No API Gateway charges
- ✅ **Full payload size** - 6MB sync, 256KB async (vs 10MB API Gateway)

## 🔒 **IAM Permissions for Invoking**

Your caller needs these permissions:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "lambda:InvokeFunction",
      "Resource": "arn:aws:lambda:*:*:function:fieldflicks-m3u8-converter-*"
    }
  ]
}
```

## 📊 **Error Handling**

### **Success Response:**

```json
{
  "success": true,
  "s3Path": "videos/converted/my-video.mp4",
  "bucketName": "my-bucket",
  "signedUrl": "https://s3.amazonaws.com/...",
  "fileSize": 15728640,
  "duration": 120.5,
  "message": "M3U8 successfully converted to MP4 and uploaded to S3"
}
```

### **Error Response:**

```json
{
  "success": false,
  "error": "Validation failed",
  "message": "Invalid S3 path format - must end with .mp4 and not start with /",
  "requestId": "lambda-request-id"
}
```

## 🚀 **Deployment**

```bash
# Deploy Lambda (no API Gateway)
npm run deploy

# Function name will be:
# fieldflicks-m3u8-converter-{stage}-m3u8-converter

# Test direct invocation
aws lambda invoke \
  --function-name fieldflicks-m3u8-converter-dev-m3u8-converter \
  --payload file://test-request-example.json \
  --cli-binary-format raw-in-base64-out \
  test-response.json
```

## ✅ **Perfect for Your Use Case**

Direct Lambda invocation is ideal when:

- ✅ **You control the caller** (your backend, another Lambda, cron job)
- ✅ **No need for HTTP endpoints** (internal processing)
- ✅ **Want maximum performance** (no API Gateway overhead)
- ✅ **Long-running processes** (full 15-minute timeout)
- ✅ **Cost optimization** (no API Gateway charges)

**Your Lambda is now optimized for direct invocation!** 🎯
