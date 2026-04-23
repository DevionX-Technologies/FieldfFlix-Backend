import { Test, TestingModule } from '@nestjs/testing';
import { HealthService } from './health.service';
import { HealthCheckService, HealthCheckResult } from '@nestjs/terminus';

describe('HealthService', () => {
  let healthService: HealthService;
  let healthCheckService: HealthCheckService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HealthService,
        {
          provide: HealthCheckService,
          useValue: {
            check: jest.fn(),
          },
        },
      ],
    }).compile();

    healthService = module.get<HealthService>(HealthService);
    healthCheckService = module.get<HealthCheckService>(HealthCheckService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(healthService).toBeDefined();
  });

  it('should return a health check result', async () => {
    const mockHealthCheckResult: HealthCheckResult = {
      status: 'ok',
      details: {},
    };
    jest
      .spyOn(healthCheckService, 'check')
      .mockResolvedValue(mockHealthCheckResult);

    const result = await healthService.check();

    expect(healthCheckService.check).toHaveBeenCalledWith([]);
    expect(result).toBe(mockHealthCheckResult);
  });
});
