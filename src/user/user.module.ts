import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserService } from './user.service';
import { UserController } from './user.controller';
import { User } from './entities/user.entity';
import { FileServiceModule } from 'src/file-service/file-service.module';
import { CommonModule } from 'src/common/common.module';
import { UserDevicesTokenEntity } from './entities/user-devices-token.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, UserDevicesTokenEntity]),
    CommonModule,

    FileServiceModule,
  ],
  controllers: [UserController],
  providers: [UserService],
  exports: [UserService, TypeOrmModule],
})
export class UserModule {}
