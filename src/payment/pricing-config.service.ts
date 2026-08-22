import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PricingConfigEntity } from './entities/pricing-config.entity';

@Injectable()
export class PricingConfigService implements OnModuleInit {
  private readonly logger = new Logger(PricingConfigService.name);

  // In-memory cache for fast synchronous access by pricing utils
  private cachedConfig: PricingConfigEntity | null = null;

  constructor(
    @InjectRepository(PricingConfigEntity)
    private readonly pricingRepo: Repository<PricingConfigEntity>,
  ) {}

  async onModuleInit() {
    await this.refreshCache();
  }

  /**
   * Fetches the config from the database and updates the in-memory cache.
   * If no config exists, it creates a default one.
   */
  async refreshCache(): Promise<PricingConfigEntity> {
    let config = await this.pricingRepo.findOne({ where: { id: 'default' } });

    if (!config) {
      this.logger.log('No pricing config found, creating default...');
      config = this.pricingRepo.create({
        id: 'default',
        cricket_hourly_rate: 300,
        cricket_half_hourly_rate: 150,
        pickleball_hourly_rate: 200,
        pickleball_half_hourly_rate: 100,
        padel_hourly_rate: 250,
        padel_half_hourly_rate: 125,
        default_hourly_rate: 250,
        default_half_hourly_rate: 125,
        highlight_base_price: 100,
        shorts_base_price: 50,
        gst_rate: 0.18,
      });
      config = await this.pricingRepo.save(config);
    }

    // Ensure all numeric values are actually numbers (TypeORM sometimes returns strings for decimals)
    config.cricket_hourly_rate = Number(config.cricket_hourly_rate);
    config.cricket_half_hourly_rate = Number(
      config.cricket_half_hourly_rate ?? config.cricket_hourly_rate / 2,
    );
    config.pickleball_hourly_rate = Number(config.pickleball_hourly_rate);
    config.pickleball_half_hourly_rate = Number(
      config.pickleball_half_hourly_rate ?? config.pickleball_hourly_rate / 2,
    );
    config.padel_hourly_rate = Number(config.padel_hourly_rate);
    config.padel_half_hourly_rate = Number(
      config.padel_half_hourly_rate ?? config.padel_hourly_rate / 2,
    );
    config.default_hourly_rate = Number(config.default_hourly_rate);
    config.default_half_hourly_rate = Number(
      config.default_half_hourly_rate ?? config.default_hourly_rate / 2,
    );
    config.highlight_base_price = Number(config.highlight_base_price);
    config.shorts_base_price = Number(config.shorts_base_price);
    config.gst_rate = Number(config.gst_rate);

    this.cachedConfig = config;
    return config;
  }

  /**
   * Retrieves the current pricing config.
   * Uses the cached version if available for fast synchronous access.
   */
  getConfig(): PricingConfigEntity {
    if (!this.cachedConfig) {
      // Fallback if accessed before init (should rarely happen)
      return {
        id: 'default',
        cricket_hourly_rate: 300,
        cricket_half_hourly_rate: 150,
        pickleball_hourly_rate: 200,
        pickleball_half_hourly_rate: 100,
        padel_hourly_rate: 250,
        padel_half_hourly_rate: 125,
        default_hourly_rate: 250,
        default_half_hourly_rate: 125,
        highlight_base_price: 100,
        shorts_base_price: 50,
        gst_rate: 0.18,
        created_at: new Date(),
        updated_at: new Date(),
      };
    }
    return this.cachedConfig;
  }

  /**
   * Updates the pricing config and refreshes the cache.
   */
  async updateConfig(
    updates: Partial<
      Omit<PricingConfigEntity, 'id' | 'created_at' | 'updated_at'>
    >,
  ): Promise<PricingConfigEntity> {
    let config = await this.pricingRepo.findOne({ where: { id: 'default' } });
    if (!config) {
      config = this.pricingRepo.create({ id: 'default' });
    }

    Object.assign(config, updates);
    await this.pricingRepo.save(config);

    return this.refreshCache();
  }
}
