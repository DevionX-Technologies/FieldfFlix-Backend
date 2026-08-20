import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { RecordingService } from '../recording/service/recording.service';
import { Repository } from 'typeorm';
import { Recording } from '../recording/entities/recording.entity';
import { Camera } from '../camera/camera.entity';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);

  const recordingService = app.get(RecordingService);

  const recordingRepo: Repository<Recording> = app.get('RecordingRepository');
  const cameraRepo: Repository<Camera> = app.get('CameraRepository');

  console.log('Starting backfill for second channel recordings...');

  // Get all unique recordings
  const recordings = await recordingRepo.find({
    relations: ['camera'],
    where: {
      status: 'completed', // or ready? let's just query completed for now
    },
  });

  console.log(`Found ${recordings.length} completed recordings.`);

  for (const rec of recordings) {
    if (!rec.camera || !rec.camera.turfId || !rec.camera.court_number) {
      continue;
    }

    const courtCameras = await cameraRepo.find({
      where: {
        turfId: rec.camera.turfId,
        court_number: rec.camera.court_number,
      },
    });

    for (const otherCamera of courtCameras) {
      if (otherCamera.id === rec.camera.id) continue;

      // Check if recording already exists for this camera
      const existing = await recordingRepo.findOne({
        where: {
          cameraId: otherCamera.id,
          startTime: rec.startTime,
        },
      });

      if (!existing && rec.startTime && rec.endTime) {
        console.log(
          `Missing recording for camera ${otherCamera.id} on turf ${otherCamera.turfId} court ${otherCamera.court_number}. Requesting extraction...`,
        );
        try {
          await recordingService.requestOnDemandExtraction(
            {
              cameraId: otherCamera.id,
              startTime: rec.startTime.toISOString(),
              endTime: rec.endTime.toISOString(),
            },
            rec.userId,
          );
          console.log(
            `Successfully requested extraction for camera ${otherCamera.id}`,
          );
        } catch (e) {
          console.error(
            `Failed to request extraction for camera ${otherCamera.id}:`,
            e.message,
          );
        }
      }
    }
  }

  console.log('Backfill complete!');
  await app.close();
}

bootstrap().catch(console.error);
