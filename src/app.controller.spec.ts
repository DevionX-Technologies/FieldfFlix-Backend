import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('root', () => {
    it('should return recording updates health string', () => {
      expect(appController.getHello()).toBe(
        'FieldFlicks — recording updates (Mux signed playback, share deep links, /recording/:id/highlights, /payments/plan/active).',
      );
    });
  });
});
