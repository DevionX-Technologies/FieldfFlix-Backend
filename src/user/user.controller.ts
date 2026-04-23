import {
  Controller,
  Get,
  Body,
  Patch,
  Param,
  Delete,
  Req,
  Header,
  UseInterceptors,
  NotFoundException,
  BadRequestException,
  UploadedFile,
  UseGuards,
  Put,
} from '@nestjs/common';
import { UserService } from './user.service';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { UpdateUserDto, UpdateUserFmcTokenDto } from './dto/user.dto';
import { Request } from 'express';
import { User } from './entities/user.entity';
import { FileInterceptor } from '@nestjs/platform-express';
import { STATUS_MSG } from 'src/constant/status-message.constants';
import { IStatusMessage } from 'src/interface/interface';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';

@ApiTags('Users')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('users')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Get()
  findAll() {
    return this.userService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.userService.findOne(id);
  }

  @Patch()
  update(
    @Req() req: Request,
    @Body() updateUserDto: UpdateUserDto,
  ): Promise<User> {
    return this.userService.update(req, updateUserDto);
  }

  @ApiOperation({
    summary: '**To upload profile pic**',
    description: 'To upload profile pic',
  })
  @ApiBearerAuth('access-token')
  @ApiConsumes('multipart/form-data')
  @Header('Content-Type', 'application/json')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
        },
      },
    },
  })
  @UseInterceptors(
    FileInterceptor('file', {
      fileFilter: (_req, file, callback) => {
        if (!file) {
          callback(new NotFoundException('File Not Found'), false);
        }
        if (
          file.mimetype.includes('image/jpeg') ||
          file.mimetype.includes('png')
        ) {
          callback(null, true);
        } else {
          callback(
            new BadRequestException(STATUS_MSG.ERROR.UPLOAD_PIC_ERROR),
            false,
          );
        }
      },
    }),
  )
  @Patch('/upload/profile/picture')
  async uploadProfilePic(
    @Req() req: any,
    @UploadedFile() file: Express.Multer.File,
  ): Promise<string> {
    if (!file) {
      throw new BadRequestException(STATUS_MSG.ERROR.NO_FILE_UPLOADED);
    }

    return this.userService.uploadProfilePic(req, file);
  }

  @Put('register/deviceId')
  async updateDeviceId(
    @Req() req: Request,
    @Body() updateUserFmcTokenDto: UpdateUserFmcTokenDto,
  ): Promise<IStatusMessage> {
    return this.userService.updateDeviceId(req, updateUserFmcTokenDto.deviceId);
  }

  @Delete()
  permanentlyDeleteUser(@Req() req: Request) {
    return this.userService.permanentlyDeleteUser(req);
  }
}
