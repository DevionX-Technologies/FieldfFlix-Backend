import { HttpStatus } from '@nestjs/common';

/**
 *
 * @description creating custom status message
 * @status_msg ERROR.
 * @status_msg SUCCESS
 *
 */

export const STATUS_MSG = {
  ERROR: {
    INVALID_CREDENTIALS: {
      status: HttpStatus.UNAUTHORIZED,
      message:
        'The provided username or password is incorrect. Please check your credentials and try again.',
      type: 'INVALID_CREDENTIALS',
    },

    FAILED_UPLOAD_PROFILE_PIC: {
      statusCode: HttpStatus.BAD_REQUEST,
      message: 'Failed to upload profile pic',
      type: 'FAILED_UPLOAD_PROFILE_PIC',
    },

    NO_FILE_UPLOADED: {
      statusCode: HttpStatus.BAD_REQUEST,
      message: 'No file uploaded!',
      type: 'NO_FILE_UPLOADED',
    },

    UPLOAD_PIC_ERROR: {
      statusCode: HttpStatus.BAD_REQUEST,
      message: 'PLEASE_UPLOAD_ONLY_PNG_AND_JPEG_FILE',
      type: 'UPLOAD_PIC_ERROR',
    },

    INVALID_OTP: {
      status: HttpStatus.UNAUTHORIZED,
      message:
        'The OTP code you entered is incorrect. Please enter the correct OTP.',
      type: 'INVALID_OTP',
    },

    INVALID_PHONE_NUMBER: {
      status: HttpStatus.BAD_REQUEST,
      message:
        'The phone number format is invalid. Please enter a valid phone number with country code.',
      type: 'INVALID_PHONE_NUMBER',
    },

    INVALID_EMAIL: {
      status: HttpStatus.BAD_REQUEST,
      message:
        'The email address format is invalid. Please enter a valid email address.',
      type: 'INVALID_EMAIL',
    },

    INVALID_USER: {
      status: HttpStatus.UNAUTHORIZED,
      message:
        'The user account does not exist or has been deactivated. Please check your details.',
      type: 'INVALID_USER',
    },
    INVALID_OTP_EXPIRED: {
      status: HttpStatus.UNAUTHORIZED,
      message:
        'The OTP code has expired. Please request a new OTP to continue.',
      type: 'INVALID_OTP_EXPIRED',
    },
    INVALID_OTP_NOT_FOUND: {
      status: HttpStatus.UNAUTHORIZED,
      message:
        'No OTP code was found for this request. Please generate a new OTP.',
      type: 'INVALID_OTP_NOT_FOUND',
    },
    INVALID_OTP_EXPIRED_OR_NOT_FOUND: {
      status: HttpStatus.UNAUTHORIZED,
      message:
        'The OTP code has either expired or was not found. Please request a new OTP to proceed.',
      type: 'INVALID_OTP_EXPIRED_OR_NOT_FOUND',
    },
  },

  SUCCESS: {
    OTP_SENT: {
      status: HttpStatus.OK,
      message: 'OTP sent successfully',
      type: 'OTP_SENT',
    },
    ADD_DEVICE_ID: {
      status: HttpStatus.CREATED,
      message: 'Device ID added successfully',
      type: 'ADD_DEVICE_ID',
    },
  },
};
