import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { Public } from 'src/decorators/public.decorator';
import { Request } from 'express';
import { ILocalLoginPayload } from 'src/auth/strategy/jwt.strategy';
import { FlickShortsService } from './flick-shorts.service';
import { CreateFlickShortDto, FlickShortCommentBodyDto, SetApprovedBodyDto } from './dto/flick-short.dto';

@Controller('flick-shorts')
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
export class FlickShortsController {
  constructor(private readonly service: FlickShortsService) {}

  @Get('public')
  @Public()
  listPublic(@Query('sport') sport?: string) {
    return this.service.listPublic(sport);
  }

  @Get('admin')
  listAdmin(@Req() req: Request & { user: ILocalLoginPayload }) {
    return this.service.listAllForAdmin(req.user.user_id);
  }

  @Post()
  create(
    @Req() req: Request & { user: ILocalLoginPayload },
    @Body() body: CreateFlickShortDto,
  ) {
    return this.service.create(req.user.user_id, body);
  }

  @Patch(':id/approve')
  approve(
    @Req() req: Request & { user: ILocalLoginPayload },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: SetApprovedBodyDto,
  ) {
    return this.service.setApproved(req.user.user_id, id, body.approved !== false);
  }

  @Post(':id/like')
  addLike(
    @Req() req: Request & { user: ILocalLoginPayload },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.addLike(req.user.user_id, id);
  }

  @Post(':id/comment')
  addComment(
    @Req() req: Request & { user: ILocalLoginPayload },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: FlickShortCommentBodyDto,
  ) {
    return this.service.addComment(req.user.user_id, id, body);
  }
}
