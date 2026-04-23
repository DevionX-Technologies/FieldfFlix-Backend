/* eslint-disable no-console */
const REQUIRED_ENV_VARS = [
  'DB_HOST',
  'DB_PORT',
  'DB_USER',
  'DB_PASSWORD',
  'DB_DATABASE',
  'APP_NAME',
  'ENVIRONMENT',
  'AWS_REGION',
  'MUX_TOKEN_ID',
  'MUX_TOKEN_SECRET',
];

export const formatLogMessage = (
  message: string,
  context?: Record<string, unknown>,
): string =>
  JSON.stringify({
    timestamp: new Date().toISOString(),
    message,
    ...(context ?? {}),
  });

export const validateEnvironmentVariables = (): void => {
  const missing = REQUIRED_ENV_VARS.filter((envVar) => !process.env[envVar]);
  if (missing.length > 0) {
    const errorMessage = `Missing required environment variables: ${missing.join(
      ', ',
    )}`;
    console.error(
      formatLogMessage('Environment validation failed', { missing }),
    );
    throw new Error(errorMessage);
  }
};
