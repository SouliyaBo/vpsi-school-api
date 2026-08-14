import { Controller, Get, Module } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { Connection } from 'mongoose';
import { Public } from 'src/common/decorators';

/**
 * Liveness and readiness for orchestrators and load balancers.
 *
 * Public and exempt from rate limiting — a probe must not be throttled out, and
 * requiring a token to check whether the service is up defeats the purpose.
 */
@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  @Public()
  @SkipThrottle()
  @Get()
  @ApiOperation({ summary: 'Liveness probe' })
  live() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  @Public()
  @SkipThrottle()
  @Get('ready')
  @ApiOperation({
    summary: 'Readiness probe',
    description: 'Reports `degraded` when MongoDB is not in the connected state.',
  })
  async ready() {
    // 1 = connected, per Mongoose's readyState enum.
    const isConnected = this.connection.readyState === 1;
    return {
      status: isConnected ? 'ok' : 'degraded',
      database: isConnected ? 'connected' : 'disconnected',
      timestamp: new Date().toISOString(),
    };
  }
}

@Module({ controllers: [HealthController] })
export class HealthModule {}
