import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { SalesService } from '../application/sales.service';
import { CreateDocumentDto } from './dto/create-document.dto';

/**
 * Internal document engine endpoints.
 *
 * These remain available for debugging / internal use.
 * Public-facing endpoints should prefer `POST /api/sales`.
 */
@Controller('documents')
@ApiTags('Documents')
export class DocumentsController {
  constructor(private readonly salesService: SalesService) {}

  @Post()
  @ApiOperation({ summary: 'Create compliance document (DRAFT)' })
  @ApiResponse({ status: 201, description: 'Document created' })
  async createDocument(@Body() body: CreateDocumentDto) {
    return this.salesService.createDocument(body);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get document details' })
  @ApiResponse({ status: 200, description: 'Document details' })
  async getDocument(@Param('id') id: string) {
    return this.salesService.getDocument(id);
  }

  @Get('merchants/:merchantId')
  @ApiOperation({ summary: 'List documents by merchant' })
  @ApiResponse({ status: 200, description: 'Document list' })
  async listDocuments(@Param('merchantId') merchantId: string) {
    return this.salesService.listDocuments(merchantId);
  }

  @Post(':id/validate')
  @ApiOperation({ summary: 'Validate document before submission' })
  @ApiResponse({ status: 200, description: 'Validation result' })
  async validateDocument(@Param('id') id: string) {
    return this.salesService.validateDocument(id);
  }

  @Post(':id/prepare')
  @ApiOperation({ summary: 'Prepare document for submission' })
  @ApiResponse({ status: 200, description: 'Prepared' })
  async prepareDocument(@Param('id') id: string) {
    return this.salesService.prepareDocument(id);
  }

  @Post(':id/submit')
  @ApiOperation({ summary: 'Submit document to eTIMS' })
  @ApiResponse({ status: 200, description: 'Submission result' })
  async submitDocument(@Param('id') id: string) {
    return this.salesService.submitDocument(id);
  }
}
