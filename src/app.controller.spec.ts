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
    it('should return live date and version on root', () => {
      const out = appController.getHello();
      // Includes the build-provenance suffix injected at boot, so match by
      // prefix rather than equality. CI builds always populate BUILD_SHA via
      // --build-arg; local dev sees `sha=unknown`.
      expect(out).toMatch(/^flickshorts submit unlocked/);
      expect(out).toContain('version=');
      expect(out).toContain('sha=');
      expect(out).toContain('built=');
      expect(out).toContain('booted=');
    });
  });
});
