import { Test, TestingModule } from '@nestjs/testing';
import { FileServiceService } from './file-service.service';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { AWSS3Bucket } from 'src/constant/providers.constant';

// Mock the @aws-sdk/s3-request-presigner module
jest.mock('@aws-sdk/s3-request-presigner', () => ({
  ...jest.requireActual('@aws-sdk/s3-request-presigner'), // Import and retain default behavior
  getSignedUrl: jest.fn(), // Mock only getSignedUrl
}));

describe('FileServiceService', () => {
  let service: FileServiceService;
  let mockS3Client: S3Client;
  const mockGetSignedUrl = getSignedUrl as jest.MockedFunction<
    typeof getSignedUrl
  >;

  beforeEach(async () => {
    // Reset mock before each test if it was called
    mockGetSignedUrl.mockReset();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FileServiceService,
        {
          provide: AWSS3Bucket, // Use the actual injection token
          useValue: { send: jest.fn() }, // Mock S3Client, send might not be directly used by getSignedUrlFromS3 but good practice
        },
      ],
    }).compile();

    service = module.get<FileServiceService>(FileServiceService);
    mockS3Client = module.get<S3Client>(AWSS3Bucket);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getSignedUrlFromS3', () => {
    const testKey = 'test-file.jpg';
    const testBucketName = 'test-bucket';
    const expectedSignedUrl = 'https://s3.example.com/signed-url';

    it('should return a signed URL on success', async () => {
      mockGetSignedUrl.mockResolvedValue(expectedSignedUrl);

      const result = await service.getSignedUrlFromS3(testKey, testBucketName);

      expect(result).toBe(expectedSignedUrl);
      expect(mockGetSignedUrl).toHaveBeenCalledTimes(1);
      expect(mockGetSignedUrl).toHaveBeenCalledWith(
        mockS3Client, // Expect the S3 client instance
        expect.any(GetObjectCommand), // Expect a GetObjectCommand
        { expiresIn: 300 }, // 60 * 5 = 300 seconds
      );

      // Optionally, check the GetObjectCommand params
      const command = mockGetSignedUrl.mock.calls[0][1] as GetObjectCommand;
      expect(command.input.Bucket).toBe(testBucketName);
      expect(command.input.Key).toBe(testKey);
      // The 'Expires' param on GetObjectCommand itself is for other purposes, not presigning duration here.
    });

    it('should throw an error if getSignedUrl fails', async () => {
      const errorMessage = 'S3 error';
      mockGetSignedUrl.mockRejectedValue(new Error(errorMessage));

      await expect(
        service.getSignedUrlFromS3(testKey, testBucketName),
      ).rejects.toThrow(errorMessage);
      expect(mockGetSignedUrl).toHaveBeenCalledTimes(1);
    });
  });
});
