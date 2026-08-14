import { Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from 'src/common/decorators';
import { QueryNotificationsDto } from './dto/notification.dto';
import { NotificationsService } from './notifications.service';

/**
 * Every route is scoped to the caller's own inbox — there is no "read someone
 * else's notifications" endpoint, so no permission check beyond authentication
 * is needed or wanted.
 */
@ApiTags('notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly service: NotificationsService) {}

  @Get()
  @ApiOperation({ summary: 'Your notifications, newest first' })
  findMine(@CurrentUser('sub') userId: string, @Query() query: QueryNotificationsDto) {
    return this.service.findForUser(userId, query);
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Number of unread notifications, for a badge' })
  unreadCount(@CurrentUser('sub') userId: string) {
    return this.service.countUnread(userId);
  }

  @Post(':id/read')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Mark one notification read' })
  markRead(@Param('id') id: string, @CurrentUser('sub') userId: string) {
    return this.service.markRead(id, userId);
  }

  @Post('read-all')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark every notification read' })
  markAllRead(@CurrentUser('sub') userId: string) {
    return this.service.markAllRead(userId);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete one of your notifications' })
  remove(@Param('id') id: string, @CurrentUser('sub') userId: string) {
    return this.service.remove(id, userId);
  }
}
