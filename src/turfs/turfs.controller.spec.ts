import { Test, TestingModule } from '@nestjs/testing';
import { TurfsController } from './turfs.controller';
import { TurfsService } from './turfs.service';

describe('TurfsController', () => {
  let controller: TurfsController;

  beforeEach(async () => {
    const mockTurfsService = {};

    const module: TestingModule = await Test.createTestingModule({
      controllers: [TurfsController],
      providers: [
        {
          provide: TurfsService,
          useValue: mockTurfsService,
        },
      ],
    }).compile();

    controller = module.get<TurfsController>(TurfsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
