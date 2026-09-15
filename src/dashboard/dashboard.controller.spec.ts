import { Test, TestingModule } from '@nestjs/testing';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

describe('DashboardController', () => {
  let controller: DashboardController;
  let serviceMock: any;

  beforeEach(async () => {
    serviceMock = {
      getHomeDashboard: jest.fn().mockResolvedValue({
        greeting: { userName: 'Player' },
        weeklySnapshot: { totalSessions: 2 },
      }),
      getAnalytics: jest.fn().mockResolvedValue({
        overview: { totalSessions: 2 },
        weeklyStats: [],
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [DashboardController],
      providers: [
        {
          provide: DashboardService,
          useValue: serviceMock,
        },
      ],
    }).compile();

    controller = module.get<DashboardController>(DashboardController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should return home dashboard', async () => {
    const result = await controller.getHomeDashboard({
      user: { id: 'user-1' },
    } as any);
    expect(serviceMock.getHomeDashboard).toHaveBeenCalledWith('user-1');
    expect(result.weeklySnapshot.totalSessions).toBe(2);
  });

  it('should return analytics', async () => {
    const result = await controller.getAnalytics({
      user: { id: 'user-1' },
    } as any);
    expect(serviceMock.getAnalytics).toHaveBeenCalledWith('user-1');
    expect(result.overview.totalSessions).toBe(2);
  });
});
