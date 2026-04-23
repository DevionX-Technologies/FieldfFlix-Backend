const {
  APP_PORT,
  ENVIRONMENT,
  MUX_TOKEN_ID,
  MUX_TOKEN_SECRET,
  LAMBDA_API_KEY,
  MUX_WEBHOOK_SECRET,
  RAZORPAY_KEY_ID,
  RAZORPAY_KEY_SECRET,
} = process.env;

export const ENV = {
  PORT: APP_PORT,
  ENVIRONMENT: ENVIRONMENT,
  MUX_TOKEN_ID: MUX_TOKEN_ID,
  MUX_TOKEN_SECRET: MUX_TOKEN_SECRET,
  LAMBDA_API_KEY: LAMBDA_API_KEY,
  MUX_WEBHOOK_SECRET: MUX_WEBHOOK_SECRET,
  RAZORPAY_KEY_ID: RAZORPAY_KEY_ID,
  RAZORPAY_KEY_SECRET: RAZORPAY_KEY_SECRET,
};

/**
 * Load env-specific file first, then `.env`, so keys only in `.env` (e.g.
 * `OTP_DEBUG_CODE`) still apply when `ENVIRONMENT=production` — otherwise
 * only `.env.production` was read and local overrides were ignored.
 */
export default () => {
  const env = process.env.ENVIRONMENT;
  if (!env) {
    return { envFilePath: '.env' };
  }
  return { envFilePath: [`.env.${env}`, '.env'] };
};
