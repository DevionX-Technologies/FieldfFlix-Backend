import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { TurfsService } from './turfs.service';
import {
  CreateTurfAmenitiesDto,
  CreateTurfDto,
  DeletingTurfImageDto,
  GetTurfsQueryDto,
  InsertsTurfImageDto,
  UpdateTurfDto,
} from './dto/turfs.dto';
import { Public } from 'src/decorators/public.decorator';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { Pagination } from 'tekvo-nest-typeorm-paginate';
import { TurfEntity } from './entities/turfs.entity';

@ApiTags('Turfs')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('turfs')
export class TurfsController {
  constructor(private readonly turfsService: TurfsService) {}

  @Post()
  @ApiOperation({ summary: 'Create new turf' })
  async createNewTurf(@Body() createTurfDto: CreateTurfDto) {
    return await this.turfsService.createNewTurf(createTurfDto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete turf by ID' })
  async removeTurfById(@Param('id') id: string) {
    return await this.turfsService.removeTurfById(id);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update turf by ID' })
  async modifyTurfById(
    @Param('id') id: string,
    @Body(ValidationPipe) updateTurfDto: UpdateTurfDto,
  ) {
    return await this.turfsService.modifyTurfById(id, updateTurfDto);
  }

  @Put(':turfId/amenities/:id')
  @ApiOperation({ summary: 'Update turf amenities' })
  async modifyTurfAmenitiesById(
    @Param('turfId') turfId: string,
    @Param('id') id: string,
    @Body() updateTurfAmenitiesDto: CreateTurfAmenitiesDto,
  ) {
    return await this.turfsService.modifyTurfAmenitiesById(
      turfId,
      id,
      updateTurfAmenitiesDto,
    );
  }

  @Get()
  @Public()
  @ApiOperation({ summary: 'Get all turfs with filters' })
  async retrieveTurfsByQuery(
    @Query(ValidationPipe) query: GetTurfsQueryDto,
  ): Promise<Pagination<TurfEntity> | []> {
    return await this.turfsService.getTurfsBaseOnQuery(query);
  }

  @Public()
  @Get(':turfId')
  @ApiOperation({ summary: 'Get turfs by id' })
  async retrieveTurfById(@Param('turfId') turfId: string) {
    return await this.turfsService.retrieveTurfById(turfId);
  }

  @Delete('images')
  @ApiOperation({ summary: 'Delete turf images' })
  async removeTurfImages(
    @Query() deletingTurfImageDto: DeletingTurfImageDto[],
  ) {
    return this.turfsService.removeTurfImages(deletingTurfImageDto);
  }

  @Post('images')
  @ApiOperation({ summary: 'Insert turf images' })
  async insertsTurfImagesInDb(
    @Body(ValidationPipe) insertsTurfImageDto: InsertsTurfImageDto,
  ) {
    return this.turfsService.insertsTurfImagesInDb(insertsTurfImageDto);
  }
}
