# Async Stop Recording - Quick Response API

## Problem

The `/recording/stop/:id` endpoint was taking 3-4 minutes to respond because it was waiting synchronously for the Raspberry Pi to:

1. Stop the recording
2. Process/encode the video
3. Upload to S3
4. Return the S3 path

This created a poor user experience with long-running HTTP requests.

## Solution

Implemented **asynchronous processing** pattern that returns an immediate response to the client while processing continues in the background.

## How It Works

### 1. Client Calls Stop Recording

```http
PUT /recording/stop/{recordingId}
Authorization: Bearer {token}
```

**Response (immediate - within 1-2 seconds):**

```json
{
  "id": "recording-uuid",
  "status": "processing",
  "endTime": "2025-10-09T10:30:00Z",
  "userId": "user-uuid",
  "cameraId": "camera-uuid",
  ...
}
```

### 2. Background Processing

The server continues processing in the background:

- Calls Raspberry Pi API (takes 3-4 minutes)
- Retries up to 3 times with exponential backoff
- Updates database when complete
- Sends push notification to user
- Triggers Mux upload

### 3. Client Checks Status (Polling)

```http
GET /recording/{recordingId}/status
Authorization: Bearer {token}
```

**Response while processing:**

```json
{
  "id": "recording-uuid",
  "status": "processing",
  "startTime": "2025-10-09T10:00:00Z",
  "endTime": "2025-10-09T10:30:00Z"
}
```

**Response when completed:**

```json
{
  "id": "recording-uuid",
  "status": "completed",
  "s3Path": "s3://bucket/path/to/video.mp4",
  "mux_playback_id": "mux-id-xyz",
  "startTime": "2025-10-09T10:00:00Z",
  "endTime": "2025-10-09T10:30:00Z"
}
```

**Response if failed:**

```json
{
  "id": "recording-uuid",
  "status": "failed",
  "startTime": "2025-10-09T10:00:00Z",
  "endTime": "2025-10-09T10:30:00Z"
}
```

## Recording Status Flow

```
in_progress → processing → completed
                        ↘ failed
```

### Status Meanings:

- **`in_progress`**: Recording is currently being captured
- **`processing`**: Recording stopped, waiting for Raspberry Pi to upload to S3
- **`completed`**: Video successfully uploaded to S3 and ready to watch
- **`failed`**: Something went wrong during processing

## Client Implementation Examples

### Option 1: Polling (Recommended)

```javascript
// 1. Stop the recording
const stopResponse = await fetch(`/recording/stop/${recordingId}`, {
  method: 'PUT',
  headers: { Authorization: `Bearer ${token}` },
});

const recording = await stopResponse.json();
console.log('Recording stopped, now processing...', recording.status);

// 2. Poll status every 10 seconds
const pollStatus = async () => {
  const statusResponse = await fetch(`/recording/${recordingId}/status`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  const status = await statusResponse.json();

  if (status.status === 'completed') {
    console.log('Video ready!', status.s3Path);
    // Show video player
    return true;
  } else if (status.status === 'failed') {
    console.log('Processing failed');
    return true;
  }

  return false; // Still processing
};

// Poll every 10 seconds
const intervalId = setInterval(async () => {
  const done = await pollStatus();
  if (done) {
    clearInterval(intervalId);
  }
}, 10000);
```

### Option 2: Push Notification (Best UX)

The backend already sends a push notification when processing is complete:

```javascript
// 1. Stop the recording
await fetch(`/recording/stop/${recordingId}`, {
  method: 'PUT',
  headers: { Authorization: `Bearer ${token}` },
});

// 2. Show "Processing..." UI to user

// 3. Listen for push notification
// When notification arrives with type 'RECORDING_STOP':
onNotificationReceived((notification) => {
  if (
    notification.type === 'RECORDING_STOP' &&
    notification.data.recordingId === recordingId
  ) {
    // Refresh recording data and show video
    console.log('Video ready!');
  }
});
```

### Option 3: Hybrid Approach (Production Ready)

```javascript
async function stopAndWaitForRecording(recordingId) {
  // 1. Stop recording
  const stopResponse = await fetch(`/recording/stop/${recordingId}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}` },
  });

  // 2. Show processing UI
  showProcessingUI();

  // 3. Setup notification listener (instant update when ready)
  const notificationListener = (notification) => {
    if (
      notification.type === 'RECORDING_STOP' &&
      notification.data.recordingId === recordingId
    ) {
      hideProcessingUI();
      showVideo(notification.data.s3Path);
      clearInterval(pollInterval);
    }
  };
  addNotificationListener(notificationListener);

  // 4. Fallback: Poll every 15 seconds (in case notification fails)
  const pollInterval = setInterval(async () => {
    const status = await fetch(`/recording/${recordingId}/status`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then((r) => r.json());

    if (status.status === 'completed') {
      clearInterval(pollInterval);
      removeNotificationListener(notificationListener);
      hideProcessingUI();
      showVideo(status.s3Path);
    } else if (status.status === 'failed') {
      clearInterval(pollInterval);
      removeNotificationListener(notificationListener);
      hideProcessingUI();
      showError('Processing failed');
    }
  }, 15000);

  // 5. Timeout after 10 minutes
  setTimeout(() => {
    clearInterval(pollInterval);
    removeNotificationListener(notificationListener);
    showError('Processing timeout');
  }, 600000);
}
```

## Benefits

✅ **Immediate Response**: Client gets response in 1-2 seconds instead of 3-4 minutes  
✅ **Better UX**: Users see "Processing..." status instead of app appearing frozen  
✅ **No Timeouts**: Prevents HTTP timeout errors on long-running operations  
✅ **Reliable**: Background processing continues even if client disconnects  
✅ **Retry Logic**: Automatic retries with exponential backoff  
✅ **Notifications**: Users get notified when video is ready  
✅ **Scalable**: Server can handle multiple concurrent recordings

## API Changes Summary

### Modified Endpoints:

- `PUT /recording/stop/:id` - Now returns immediately with `status: "processing"`

### New Endpoints:

- `GET /recording/:id/status` - Check current status of a recording

### Database Changes:

No schema changes needed. Uses existing `status` field with new value `"processing"`.

## Error Handling

If the Raspberry Pi fails after 3 retries:

- Recording status is set to `"failed"`
- Error is logged in application logs
- Client can detect this via status polling
- No notification is sent for failures (could be added if needed)

## Monitoring

Check logs for background processing:

```bash
# Successful processing
Recording {id} marked as processing. Starting background processing...
Recording stopped on Raspberry Pi. S3 Path: s3://...
Recording {id} completed with S3 path: s3://...

# Failed processing
Background processing failed for recording {id}: Error message
```
