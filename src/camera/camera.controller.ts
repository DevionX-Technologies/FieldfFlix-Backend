import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Put,
  Delete,
  UsePipes,
  ValidationPipe,
  Query,
  DefaultValuePipe,
  ParseIntPipe,
  UseGuards,
} from '@nestjs/common';
import { CameraService } from './camera.service';
import { Camera } from './camera.entity';
import { CreateCameraDto } from './dto/create-camera.dto';
import { UpdateCameraDto } from './dto/update-camera.dto';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBody,
  ApiParam,
  ApiQuery,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { Public } from 'src/decorators/public.decorator';

/**
 * Controller for managing Camera resources.
 */
@ApiTags('Cameras')
@ApiTags('Turfs')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('cameras')
@UsePipes(
  new ValidationPipe({
    transform: true, // Automatically transform payloads to be objects of the DTO types
    whitelist: true, // Remove properties not defined in the DTO
  }),
)
export class CameraController {
  constructor(private readonly cameraService: CameraService) {}

  /**
   * Create a new camera.
   * @param createCameraDto - The data for creating the camera.
   * @returns The created camera entity.
   */
  @Post()
  @ApiOperation({ summary: 'Create a new camera' })
  @ApiResponse({
    status: 201,
    description: 'The camera has been successfully created.',
    type: Camera,
  })
  @ApiResponse({ status: 400, description: 'Bad Request.' })
  @ApiBody({
    type: CreateCameraDto,
    examples: {
      example1: { value: { name: 'Camera 1', turfId: 'uuid-of-turf' } },
    },
  })
  create(@Body() createCameraDto: CreateCameraDto): Promise<Camera> {
    return this.cameraService.create(createCameraDto);
  }

  /**
   * Get all cameras with pagination and optional turf filter.
   * @param page - The page number.
   * @param limit - The number of items per page.
   * @param turfId - Optional Turf ID to filter cameras.
   * @returns A paginated list of camera entities.
   */
  @Get()
  @ApiOperation({ summary: 'Get all cameras with pagination' })
  @ApiQuery({
    name: 'page',
    required: false,
    description: 'Page number',
    type: Number,
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Items per page',
    type: Number,
  })
  @ApiQuery({
    name: 'turfId',
    required: false,
    description: 'Filter by Turf ID',
    type: String,
  })
  @ApiResponse({
    status: 200,
    description: 'Returns a paginated list of cameras.',
    isArray: true,
    type: Camera,
  })
  async findAll(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number,
    @Query('turfId') turfId?: string,
  ): Promise<{ data: Camera[]; total: number }> {
    return this.cameraService.findAll({ page, limit, turfId });
  }

  /**
   * Get a camera by ID. Public so the web QR-scan flow (which runs without
   * a JWT) can resolve the DB-backed `court_number` directly from the QR's
   * `cameraId`. Only exposes the safe fields — no Pi base URL etc.
   */
  @Public()
  @Get(':id')
  @ApiOperation({ summary: 'Get a camera by ID (public, scoped fields)' })
  @ApiParam({ name: 'id', description: 'ID of the camera to retrieve' })
  @ApiResponse({
    status: 200,
    description:
      'Returns id, name, turfId, and court_number for the camera. Safe to call without auth.',
    type: Camera,
  })
  @ApiResponse({ status: 404, description: 'Camera not found.' })
  async findOne(@Param('id') id: string): Promise<Partial<Camera>> {
    const cam = await this.cameraService.findOne(id);
    return {
      id: cam.id,
      name: cam.name,
      turfId: cam.turfId,
      court_number: cam.court_number,
    };
  }

  /**
   * Update a camera by ID.
   * @param id - The ID of the camera.
   * @param updateCameraDto - The data for updating the camera.
   */
  @Put(':id')
  @ApiOperation({ summary: 'Update a camera by ID' })
  @ApiParam({ name: 'id', description: 'ID of the camera to update' })
  @ApiResponse({
    status: 200,
    description: 'The camera has been successfully updated.',
  })
  @ApiResponse({ status: 404, description: 'Camera not found.' })
  @ApiBody({
    type: UpdateCameraDto,
    examples: { example1: { value: { name: 'Updated Camera Name' } } },
  })
  update(
    @Param('id') id: string,
    @Body() updateCameraDto: UpdateCameraDto,
  ): Promise<void> {
    return this.cameraService.update(id, updateCameraDto);
  }

  /**
   * Delete a camera by ID.
   * @param id - The ID of the camera.
   */
  @Delete(':id')
  @ApiOperation({ summary: 'Delete a camera by ID' })
  @ApiParam({ name: 'id', description: 'ID of the camera to delete' })
  @ApiResponse({
    status: 200,
    description: 'The camera has been successfully deleted.',
  })
  @ApiResponse({ status: 404, description: 'Camera not found.' })
  remove(@Param('id') id: string): Promise<void> {
    return this.cameraService.remove(id);
  }
}
