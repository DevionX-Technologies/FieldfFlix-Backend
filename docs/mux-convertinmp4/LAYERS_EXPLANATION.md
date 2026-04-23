# 🎯 Lambda Layers Configuration

## 📋 **Layers Required for Your Lambda**

Your Mux M3U8 converter Lambda requires **2 layers**:

### **1. AWS Lambda Insights Extension** ✅

```yaml
arn:aws:lambda:${aws:region}:580247275435:layer:LambdaInsightsExtension:38
```

- **Purpose**: Monitoring and observability
- **Auto-created**: ✅ **YES** - AWS managed layer
- **Action**: Nothing needed - automatically available

### **2. FFmpeg Layer** ⚠️

```yaml
${cf:ffmpeg-layer-${self:provider.stage}.FfmpegLayerExport}
```

- **Purpose**: Video processing (FFmpeg binaries)
- **Auto-created**: ❌ **NO** - Custom layer required
- **Action**: **You need to create this manually**

## 🚨 **FFmpeg Layer - Manual Creation Required**

### **Option 1: Use Existing Public Layer (Recommended)**

Replace the FFmpeg layer ARN with a public one:

```yaml
layers:
  - arn:aws:lambda:${aws:region}:580247275435:layer:LambdaInsightsExtension:38
  - arn:aws:lambda:ap-south-1:764866452798:layer:chrome-aws-lambda:31 # Example public layer
```

### **Option 2: Create Your Own FFmpeg Layer**

1. **Download FFmpeg binaries**:

   ```bash
   # Create layer directory
   mkdir ffmpeg-layer
   cd ffmpeg-layer

   # Download FFmpeg static build
   wget https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz
   tar -xf ffmpeg-release-amd64-static.tar.xz
   ```

2. **Create layer structure**:
   ```bash
   mkdir -p bin
   cp ffmpeg-*-amd64-static/ffmpeg bin/
   cp ffmpeg-*-amd64-static/ffprobe bin/
   chmod +x bin/*
   ```
3. **Deploy layer**:
   ```bash
   zip -r ffmpeg-layer.zip .
   aws lambda publish-layer-version \
     --layer-name ffmpeg-layer \
     --zip-file fileb://ffmpeg-layer.zip \
     --compatible-runtimes nodejs20.x
   ```

### **Option 3: Use Serverless Plugin (Easiest)**

Add this plugin to automatically create FFmpeg layer:

```bash
npm install --save-dev serverless-layers
```

Update `serverless.yml`:

```yaml
plugins:
  - serverless-layers
  # ... other plugins

custom:
  layers:
    - name: ffmpeg
      path: layer
      description: FFmpeg binaries for video processing
```

## 🔧 **Recommended Configuration**

### **For Development/Testing**:

```yaml
layers:
  - arn:aws:lambda:${aws:region}:580247275435:layer:LambdaInsightsExtension:38
  # Remove FFmpeg layer temporarily for testing
```

### **For Production**:

```yaml
layers:
  - arn:aws:lambda:${aws:region}:580247275435:layer:LambdaInsightsExtension:38
  - arn:aws:lambda:ap-south-1:YOUR_ACCOUNT_ID:layer:ffmpeg-layer:1 # Your custom layer
```

## 🚀 **Quick Start (No FFmpeg Layer)**

If you want to deploy immediately without FFmpeg layer:

```yaml
functions:
  muxM3u8Converter:
    handler: dist/src/lambda/mux-m3u8-converter/mux-m3u8-converter_lambda.handler
    name: ${self:service}-${self:provider.stage}-m3u8-converter
    description: Convert Mux M3U8 streams to MP4 and upload to S3 (Direct Invocation)
    memorySize: 3008
    timeout: 900
    architecture: x86_64
    package:
      individually: true
    layers:
      - arn:aws:lambda:${aws:region}:580247275435:layer:LambdaInsightsExtension:38
      # FFmpeg layer removed - add when ready
```

## ✅ **Layer Status Summary**

| Layer               | Type        | Auto-Created | Required Action                     |
| ------------------- | ----------- | ------------ | ----------------------------------- |
| **Lambda Insights** | AWS Managed | ✅ Yes       | None - ready to use                 |
| **FFmpeg**          | Custom      | ❌ No        | Create manually or use public layer |

## 🎯 **Next Steps**

1. **Deploy without FFmpeg layer** first to test basic functionality
2. **Create FFmpeg layer** when ready for video processing
3. **Update serverless.yml** with correct layer ARN
4. **Redeploy** with complete configuration

**Your Lambda will work without FFmpeg layer, but video conversion will fail until you add it!** 🎯
