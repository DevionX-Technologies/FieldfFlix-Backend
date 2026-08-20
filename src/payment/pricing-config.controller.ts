import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { PricingConfigService } from './pricing-config.service';
import { Public } from 'src/auth/decorators/public.decorator';

@ApiTags('Pricing')
@Controller('pricing')
export class PricingConfigController {
  constructor(private readonly pricingService: PricingConfigService) {}

  @Public()
  @Get('config')
  @ApiOperation({ summary: 'Get current pricing configuration' })
  @ApiResponse({
    status: 200,
    description: 'Returns the active pricing configuration.',
  })
  getConfig() {
    const config = this.pricingService.getConfig();
    return {
      success: true,
      data: config,
      message: 'Pricing configuration retrieved successfully',
    };
  }
}
