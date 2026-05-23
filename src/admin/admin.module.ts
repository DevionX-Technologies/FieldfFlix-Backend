import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RecordingModule } from 'src/recording/recording.module';
import { UserModule } from 'src/user/user.module';
import { AdminPhone } from './entities/admin-phone.entity';
import { AdminController } from './admin.controller';
import { AdminRoleService } from './admin-role.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([AdminPhone]),
    UserModule,
    RecordingModule,
  ],
  controllers: [AdminController],
  providers: [AdminRoleService],
  exports: [AdminRoleService, TypeOrmModule],
})
export class AdminModule {}
