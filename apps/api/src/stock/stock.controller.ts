import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import {
  adjustStockSchema,
  consumeStockSchema,
  createStockItemSchema,
  expiringQuerySchema,
  moveStockSchema,
  stockListQuerySchema,
  updateStockItemSchema,
  type AdjustStockInput,
  type ConsumeStockInput,
  type CreateStockItemInput,
  type ExpiringQuery,
  type MoveStockInput,
  type Paginated,
  type StockItemDto,
  type StockListQuery,
  type StockWriteResult,
  type UpdateStockItemInput,
} from '@kitchen/shared';
import { CurrentUser, type RequestUser } from '../auth/request-user.js';
import { ZodBody, ZodQuery } from '../common/zod-validation.pipe.js';
import { StockService } from './stock.service.js';

@Controller('stock')
export class StockController {
  constructor(private readonly stock: StockService) {}

  @Get()
  list(@ZodQuery(stockListQuerySchema) query: StockListQuery): Promise<Paginated<StockItemDto>> {
    return this.stock.list(query);
  }

  @Get('expiring')
  expiring(@ZodQuery(expiringQuerySchema) query: ExpiringQuery): Promise<{ items: StockItemDto[]; alertDays: number }> {
    return this.stock.expiring(query.days);
  }

  @Get(':id')
  get(@Param('id') id: string): Promise<StockItemDto> {
    return this.stock.get(id);
  }

  @Post()
  create(@ZodBody(createStockItemSchema) body: CreateStockItemInput, @CurrentUser() user: RequestUser): Promise<StockWriteResult> {
    return this.stock.create(body, user);
  }

  @Post(':id/consume')
  @HttpCode(200)
  consume(@Param('id') id: string, @ZodBody(consumeStockSchema) body: ConsumeStockInput, @CurrentUser() user: RequestUser): Promise<StockWriteResult> {
    return this.stock.consume(id, body, user);
  }

  @Post(':id/adjust')
  @HttpCode(200)
  adjust(@Param('id') id: string, @ZodBody(adjustStockSchema) body: AdjustStockInput, @CurrentUser() user: RequestUser): Promise<StockWriteResult> {
    return this.stock.adjust(id, body, user);
  }

  @Post(':id/open')
  @HttpCode(200)
  open(@Param('id') id: string): Promise<StockItemDto> {
    return this.stock.open(id);
  }

  @Post(':id/move')
  @HttpCode(200)
  move(@Param('id') id: string, @ZodBody(moveStockSchema) body: MoveStockInput): Promise<StockItemDto> {
    return this.stock.move(id, body.locationId);
  }

  @Patch(':id')
  update(@Param('id') id: string, @ZodBody(updateStockItemSchema) body: UpdateStockItemInput): Promise<StockItemDto> {
    return this.stock.update(id, body);
  }

  @Delete(':id')
  @HttpCode(200)
  discard(@Param('id') id: string, @CurrentUser() user: RequestUser, @Body() body?: { reason?: string }): Promise<StockWriteResult> {
    return this.stock.discard(id, user, typeof body?.reason === 'string' ? body.reason.slice(0, 160) : undefined);
  }
}
