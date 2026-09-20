import { Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { createLocationSchema, updateLocationSchema, type CreateLocationInput, type LocationNode, type UpdateLocationInput } from '@kitchen/shared';
import { ZodBody } from '../common/zod-validation.pipe.js';
import { LocationsService } from './locations.service.js';

@Controller('locations')
export class LocationsController {
  constructor(private readonly locations: LocationsService) {}

  @Get()
  tree(): Promise<LocationNode[]> {
    return this.locations.tree();
  }

  @Get(':id')
  get(@Param('id') id: string): Promise<LocationNode> {
    return this.locations.get(id);
  }

  @Post()
  create(@ZodBody(createLocationSchema) body: CreateLocationInput): Promise<LocationNode> {
    return this.locations.create(body);
  }

  @Patch(':id')
  update(@Param('id') id: string, @ZodBody(updateLocationSchema) body: UpdateLocationInput): Promise<LocationNode> {
    return this.locations.update(id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id') id: string): Promise<void> {
    return this.locations.remove(id);
  }

  @Post(':id/move-contents')
  @HttpCode(200)
  moveContents(@Param('id') id: string): Promise<{ moved: number; targetId: string }> {
    return this.locations.moveContentsToParent(id);
  }
}
