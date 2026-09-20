import { Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { createProductSchema, mergeProductSchema, productListQuerySchema, updateProductSchema, type CreateProductInput, type MergeProductInput, type Paginated, type ProductDto, type ProductListQuery, type UpdateProductInput } from '@kitchen/shared';
import { ApiError } from '../common/api-error.js';
import { ZodBody, ZodQuery } from '../common/zod-validation.pipe.js';
import { ProductsService } from './products.service.js';

@Controller('products')
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Get()
  list(@ZodQuery(productListQuerySchema) query: ProductListQuery): Promise<Paginated<ProductDto>> {
    return this.products.list(query);
  }

  @Get('check-duplicates')
  checkDuplicates(@Query('name') name = '', @Query('brand') brand?: string, @Query('excludeId') excludeId?: string): Promise<Array<{ product: ProductDto; score: number }>> {
    return this.products.checkDuplicates(name, brand ?? null, excludeId);
  }

  @Get('by-barcode/:barcode')
  async byBarcode(@Param('barcode') barcode: string): Promise<ProductDto> {
    const product = await this.products.findByBarcode(barcode);
    if (!product) throw ApiError.notFound('Code-barres inconnu', { barcode });
    return product;
  }

  @Get(':id')
  get(@Param('id') id: string): Promise<ProductDto> {
    return this.products.get(id);
  }

  @Get(':id/duplicates')
  async duplicates(@Param('id') id: string): Promise<Array<{ product: ProductDto; score: number }>> {
    const product = await this.products.get(id);
    return this.products.checkDuplicates(product.name, product.brand, id);
  }

  @Post()
  create(@ZodBody(createProductSchema) body: CreateProductInput): Promise<ProductDto> {
    return this.products.create(body);
  }

  @Patch(':id')
  update(@Param('id') id: string, @ZodBody(updateProductSchema) body: UpdateProductInput): Promise<ProductDto> {
    return this.products.update(id, body);
  }

  @Post(':id/merge')
  @HttpCode(200)
  merge(@Param('id') id: string, @ZodBody(mergeProductSchema) body: MergeProductInput): Promise<ProductDto> {
    return this.products.merge(id, body.targetId);
  }
}
