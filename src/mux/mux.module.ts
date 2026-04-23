import { Module } from '@nestjs/common';
import { MuxController } from './mux.controller';
import { MuxService } from './mux.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Recording } from 'src/recording/entities/recording.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Recording])],
  controllers: [MuxController],
  providers: [MuxService],
  exports: [MuxService],
})
export class MuxModule {}
