import { Test, TestingModule } from '@nestjs/testing';
import { FileServiceController } from './file-service.controller';
import { FileServiceService } from './file-service.service';

describe('FileServiceController', () => {
  let controller: FileServiceController;

  beforeEach(async () => {
    const mockFileServiceService = {};

    const module: TestingModule = await Test.createTestingModule({
      controllers: [FileServiceController],
      providers: [
        {
          provide: FileServiceService,
          useValue: mockFileServiceService,
        },
      ],
    }).compile();

    controller = module.get<FileServiceController>(FileServiceController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
