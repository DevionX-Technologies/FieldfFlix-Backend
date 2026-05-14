import { Test, TestingModule } from '@nestjs/testing';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

describe('HealthController', () => {
  let healthController: HealthController;
  let healthService: HealthService;

  beforeEach(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        {
          provide: HealthService,
          useValue: {
            check: jest.fn().mockResolvedValue({ status: 'ok' }),
          },
        },
      ],
    }).compile();

    healthController = moduleRef.get<HealthController>(HealthController);
    healthService = moduleRef.get<HealthService>(HealthService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('check', () => {
    it('should return health status', async () => {
      // Arrange
      const expectedResult = {
        status: 'ok',
        service: 'FieldFlicks',
        probe: 'fieldflicks-health-probe-2026-05-14',
      };

      // Act
      const result = await healthController.check();

      // Assert
      expect(result).toEqual(expectedResult);
      expect(healthService.check).toHaveBeenCalled();
    });
  });
});
