# 🎯 Mux M3U8 to MP4 Converter - Flow & Tools

## 📋 **Complete Flow Overview**

### **1. Input Processing**

- **Tool**: AWS Lambda (Direct Invocation)
- **Input**: JSON event with Mux URL, S3 path, bucket name
- **Validation**: Mux URL format validation (stream.mux.com only)

### **2. Asset ID Extraction**

- **Tool**: Custom TypeScript utility function
- **Process**: Parse Mux URL to extract asset ID
- **Output**: Asset ID used for filename generation

### **3. Video Processing**

- **Tool**: FFmpeg (via Lambda Layer)
- **Process**: Download M3U8 stream and convert to MP4
- **Quality**: Configurable (low/medium/high)
- **Output**: Temporary MP4 file

### **4. File Upload**

- **Tool**: AWS S3 SDK
- **Process**: Upload converted MP4 to specified S3 bucket
- **Features**: Multipart upload for large files

### **5. URL Generation**

- **Tool**: AWS S3 SDK (getSignedUrl)
- **Process**: Generate presigned URL for secure access
- **Expiration**: Configurable (default 1 hour)

### **6. Cleanup**

- **Tool**: File system cleanup
- **Process**: Remove temporary files
- **Memory**: Free up Lambda execution memory

### **7. Response**

- **Tool**: Direct Lambda response
- **Output**: JSON with S3 details and signed URL

## 🛠️ **Tools & Technologies Used**

### **AWS Services**

- **AWS Lambda** - Serverless compute
- **AWS S3** - Object storage
- **AWS IAM** - Permissions management

### **Development Tools**

- **TypeScript** - Programming language
- **Node.js** - Runtime environment
- **Serverless Framework** - Deployment tool

### **Video Processing**

- **FFmpeg** - Video conversion engine
- **Lambda Layer** - FFmpeg binary distribution

### **Validation & Processing**

- **URL Validation** - Custom TypeScript utilities
- **File System** - Temporary file management
- **JSON Processing** - Event parsing

### **Deployment & Management**

- **Serverless Framework** - Infrastructure as code
- **AWS CLI** - Command line interface
- **npm** - Package management

## 🔄 **Execution Flow**

```
App (UUID) → Backend (Create Path) → Lambda Invocation → Validation → Asset ID Extraction → FFmpeg Processing → S3 Upload → URL Generation → Cleanup → Lambda Response → Backend Response → App
```

## 📊 **Performance Characteristics**

### **Processing Time**

- **Low Quality**: 30-60 seconds
- **Medium Quality**: 1-3 minutes
- **High Quality**: 3-8 minutes

### **Resource Usage**

- **Memory**: Up to 3GB (Lambda limit)
- **Timeout**: 15 minutes maximum
- **Storage**: Temporary files cleaned up automatically

### **File Sizes**

- **Low Quality**: 5-15 MB
- **Medium Quality**: 15-40 MB
- **High Quality**: 40-120 MB

## 🎯 **Key Features**

### **Direct Invocation**

- No API Gateway overhead
- Full Lambda timeout available
- Lower latency processing

### **Asset ID Filename**

- Automatic extraction from Mux URL
- Unique filename generation
- Easy source identification

### **Quality Control**

- Multiple quality levels
- Configurable output settings
- Optimized for different use cases

### **Error Handling**

- Comprehensive validation
- Graceful failure handling
- Detailed error responses

## 🚀 **Deployment Flow**

1. **Build** - TypeScript compilation
2. **Package** - Dependencies bundling
3. **Deploy** - Serverless Framework deployment
4. **Test** - Function validation
5. **Monitor** - CloudWatch logging

## 📁 **File Organization**

### **Source Code**

- Handler logic
- Service classes
- Utility functions
- Type definitions

### **Configuration**

- Serverless configuration
- Environment variables
- IAM permissions

### **Documentation**

- Usage examples
- API reference
- Deployment guide
