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
    it('should return payment module health string', () => {
      expect(appController.getHello()).toBe(
        'FieldFlicks — payment module (POST /payments/plan/create-order, /payments/verify).',
      );
    });
  });
});
