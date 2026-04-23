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
   * Get all cameras with pagination.
   * @param page - The page number.
   * @param limit - The number of items per page.
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
  @ApiResponse({
    status: 200,
    description: 'Returns a paginated list of cameras.',
    isArray: true,
    type: Camera,
  })
  async findAll(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number,
  ): Promise<{ data: Camera[]; total: number }> {
    return this.cameraService.findAll({ page, limit });
  }

  /**
   * Get a camera by ID.
   * @param id - The ID of the camera.
   * @returns The camera entity.
   * @throws NotFoundException if the camera is not found.
   */
  @Get(':id')
  @ApiOperation({ summary: 'Get a camera by ID' })
  @ApiParam({ name: 'id', description: 'ID of the camera to retrieve' })
  @ApiResponse({
    status: 200,
    description: 'Returns the camera with the specified ID.',
    type: Camera,
  })
  @ApiResponse({ status: 404, description: 'Camera not found.' })
  findOne(@Param('id') id: string): Promise<Camera> {
    return this.cameraService.findOne(id);
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
