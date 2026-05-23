import {
  Body,
  Controller,
  Delete,
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
import {
  CreateFlickShortDto,
  FlickShortCommentBodyDto,
  SetApprovedBodyDto,
} from './dto/flick-short.dto';

@Controller('flick-shorts')
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
export class FlickShortsController {
  constructor(private readonly service: FlickShortsService) {}

  @Get('public')
  @Public()
  listPublic(
    @Req() req: Request & { user?: ILocalLoginPayload },
    @Query('sport') sport?: string,
  ) {
    return this.service.listPublic(sport, req.user?.user_id);
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
    return this.service.setApproved(
      req.user.user_id,
      id,
      body.approved !== false,
    );
  }

  @Delete(':id')
  remove(
    @Req() req: Request & { user: ILocalLoginPayload },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.deleteAsAdmin(req.user.user_id, id);
  }

  @Post(':id/like')
  addLike(
    @Req() req: Request & { user: ILocalLoginPayload },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.addLike(req.user.user_id, id);
  }

  @Post(':id/view')
  @Public()
  addView(
    @Req() req: Request & { user?: ILocalLoginPayload },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.addView(id, req.user?.user_id);
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
