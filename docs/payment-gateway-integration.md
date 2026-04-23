# Payment Gateway Integration - Razorpay

This document explains the payment gateway integration with Razorpay for video playback restrictions in the FieldFlicks backend.

## Overview

The payment system allows users to:

- Watch recordings for free up to 3 minutes
- Pay ₹240 per hour for extended access
- Access highlights only after payment
- Track payment history and manage refunds

## Architecture

### Core Components

1. **Payment Entity** (`src/payment/entities/payment.entity.ts`)

   - Tracks all payment transactions
   - Links payments to users, recordings, and media uploads
   - Stores Razorpay order and payment IDs

2. **Razorpay Service** (`src/common/service/razorpay.service.ts`)

   - Handles Razorpay API interactions
   - Creates orders, verifies payments, processes refunds
   - Converts between rupees and paise

3. **Payment Service** (`src/payment/payment.service.ts`)

   - Business logic for payment operations
   - Creates payment orders, verifies payments
   - Manages payment history and refunds

4. **Payment Restriction Service** (`src/payment/payment-restriction.service.ts`)

   - Enforces payment restrictions
   - Checks access permissions for recordings and highlights
   - Calculates payment amounts based on duration

5. **Recording Payment Service** (`src/recording/service/recording-payment.service.ts`)
   - Integrates payment restrictions with recording playback
   - Provides playback URLs with access control
   - Returns metadata with payment information

## Environment Variables

Add these environment variables to your `.env` file:

```env
# Razorpay Configuration
RAZORPAY_KEY_ID=your_razorpay_key_id
RAZORPAY_KEY_SECRET=your_razorpay_key_secret
```

## Database Migration

Run the migration to create the payments table:

```bash
npm run migration:run
```

## API Endpoints

### Payment Management

#### Create Payment Order

```http
POST /payments/create-order
Authorization: Bearer <jwt_token>
Content-Type: application/json

{
  "amount": 240,
  "payment_type": "recording_access",
  "recording_id": "123e4567-e89b-12d3-a456-426614174000",
  "description": "Payment for 1-hour video access"
}
```

#### Verify Payment

```http
POST /payments/verify
Authorization: Bearer <jwt_token>
Content-Type: application/json

{
  "razorpay_order_id": "order_1234567890",
  "razorpay_payment_id": "pay_1234567890",
  "razorpay_signature": "signature_1234567890"
}
```

#### Get Payment History

```http
GET /payments/history
Authorization: Bearer <jwt_token>
```

#### Check Recording Access

```http
GET /payments/check-access/{recordingId}
Authorization: Bearer <jwt_token>
```

### Recording Playback with Payment Restrictions

#### Get Recording Playback URL

```http
GET /recording-playback/{recordingId}/playback-url?duration=180
Authorization: Bearer <jwt_token>
```

Response:

```json
{
  "success": true,
  "data": {
    "playbackUrl": "https://stream.mux.com/playback_id.m3u8",
    "accessInfo": {
      "hasPaidAccess": false,
      "freeDuration": 180,
      "paymentRequired": true,
      "hourlyRate": 240
    }
  },
  "message": "Limited free access - payment required for extended playback"
}
```

#### Get Highlight Playback URL

```http
GET /recording-playback/highlights/{highlightId}/playback-url
Authorization: Bearer <jwt_token>
```

#### Create Payment Order for Recording

```http
GET /recording-playback/{recordingId}/create-payment?duration=3600
Authorization: Bearer <jwt_token>
```

## Payment Flow

### 1. Free Access (3 minutes)

- Users can watch any recording for up to 3 minutes without payment
- Frontend should track playback time and show payment prompt after 3 minutes

### 2. Payment Required

- For extended playback or highlight access, users must pay
- Create payment order → Process payment → Verify payment → Grant access

### 3. Payment Verification

- Frontend receives Razorpay payment details
- Send verification request to backend
- Backend verifies signature and updates payment status

## Frontend Integration

### Razorpay Frontend Integration

1. **Include Razorpay Script**

```html
<script src="https://checkout.razorpay.com/v1/checkout.js"></script>
```

2. **Create Payment Order**

```javascript
// Call your backend to create payment order
const response = await fetch('/payments/create-order', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    amount: 240,
    payment_type: 'recording_access',
    recording_id: 'recording_id',
    description: 'Payment for 1-hour video access',
  }),
});

const paymentOrder = await response.json();
```

3. **Open Razorpay Checkout**

```javascript
const options = {
  key: 'your_razorpay_key_id',
  amount: paymentOrder.data.amount * 100, // Convert to paise
  currency: 'INR',
  name: 'FieldFlicks',
  description: paymentOrder.data.description,
  order_id: paymentOrder.data.razorpay_order_id,
  handler: function (response) {
    // Verify payment on backend
    verifyPayment(response);
  },
  prefill: {
    name: 'User Name',
    email: 'user@example.com',
    contact: '9999999999',
  },
  theme: {
    color: '#3399cc',
  },
};

const rzp = new Razorpay(options);
rzp.open();
```

4. **Verify Payment**

```javascript
async function verifyPayment(razorpayResponse) {
  const response = await fetch('/payments/verify', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      razorpay_order_id: razorpayResponse.razorpay_order_id,
      razorpay_payment_id: razorpayResponse.razorpay_payment_id,
      razorpay_signature: razorpayResponse.razorpay_signature,
    }),
  });

  const result = await response.json();
  if (result.success) {
    // Payment verified, grant access
    showSuccessMessage('Payment successful! You now have access.');
    // Refresh playback or redirect to video
  } else {
    showErrorMessage('Payment verification failed');
  }
}
```

### Video Player Integration

1. **Track Playback Time**

```javascript
let playbackTime = 0;
const FREE_DURATION = 180; // 3 minutes in seconds

video.addEventListener('timeupdate', () => {
  playbackTime = video.currentTime;

  if (playbackTime >= FREE_DURATION && !hasPaidAccess) {
    // Show payment prompt
    showPaymentPrompt();
    video.pause();
  }
});
```

2. **Payment Prompt**

```javascript
function showPaymentPrompt() {
  const modal = document.createElement('div');
  modal.innerHTML = `
    <div class="payment-modal">
      <h3>Payment Required</h3>
      <p>You've watched 3 minutes for free. Pay ₹240 to continue watching.</p>
      <button onclick="createPaymentOrder()">Pay Now</button>
      <button onclick="closeModal()">Cancel</button>
    </div>
  `;
  document.body.appendChild(modal);
}
```

## Testing

### Test Payment Flow

1. **Create Test Recording**

```bash
# Use existing recording endpoints to create a test recording
```

2. **Test Free Access**

```bash
curl -X GET "http://localhost:3000/recording-playback/{recordingId}/playback-url?duration=120" \
  -H "Authorization: Bearer <jwt_token>"
```

3. **Test Payment Required**

```bash
curl -X GET "http://localhost:3000/recording-playback/{recordingId}/playback-url?duration=300" \
  -H "Authorization: Bearer <jwt_token>"
```

4. **Create Payment Order**

```bash
curl -X GET "http://localhost:3000/recording-playback/{recordingId}/create-payment?duration=3600" \
  -H "Authorization: Bearer <jwt_token>"
```

## Error Handling

### Common Error Responses

1. **Payment Required (403)**

```json
{
  "statusCode": 403,
  "message": "Payment required for extended playback",
  "error": "Forbidden",
  "freeDuration": 180,
  "paymentRequired": true,
  "hourlyRate": 240
}
```

2. **Recording Not Found (404)**

```json
{
  "statusCode": 404,
  "message": "Recording not found",
  "error": "Not Found"
}
```

3. **Payment Verification Failed (400)**

```json
{
  "statusCode": 400,
  "message": "Invalid payment signature",
  "error": "Bad Request"
}
```

## Security Considerations

1. **Payment Verification**

   - Always verify payment signatures on the backend
   - Never trust frontend payment data alone

2. **Access Control**

   - Check payment status before granting access
   - Implement proper JWT authentication

3. **Rate Limiting**

   - Implement rate limiting on payment endpoints
   - Prevent abuse of payment creation

4. **Logging**
   - Log all payment transactions
   - Monitor for suspicious activities

## Monitoring and Analytics

### Key Metrics to Track

1. **Payment Success Rate**
2. **Free-to-Paid Conversion Rate**
3. **Average Payment Amount**
4. **Payment Failure Reasons**
5. **User Payment History**

### Logging

All payment operations are logged with structured logging:

```typescript
this.logger.log(`Payment order created successfully: ${paymentId}`);
this.logger.error('Failed to verify payment signature', error);
```

## Troubleshooting

### Common Issues

1. **Razorpay Key Issues**

   - Verify `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` are correct
   - Check if keys are for the correct environment (test/production)

2. **Payment Verification Fails**

   - Ensure signature verification logic is correct
   - Check if payment was actually successful in Razorpay dashboard

3. **Migration Issues**

   - Run `npm run migration:run` to apply database changes
   - Check if all required tables are created

4. **Module Import Issues**
   - Ensure PaymentModule is imported in AppModule
   - Check if all dependencies are properly installed

## Support

For issues related to:

- **Razorpay Integration**: Check Razorpay documentation
- **Payment Logic**: Review PaymentService and PaymentRestrictionService
- **Database Issues**: Check migration files and entity definitions
- **API Endpoints**: Review Swagger documentation at `/api`
