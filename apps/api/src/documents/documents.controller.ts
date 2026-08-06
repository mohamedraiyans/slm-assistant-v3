import {
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { RequestUser } from '../auth/types';
import { DocumentsService } from './documents.service';

@Controller('documents')
@UseGuards(JwtAuthGuard)
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  @Get()
  list() {
    return this.documentsService.listDocuments();
  }

  @Post()
  @UseInterceptors(FileInterceptor('file'))
  upload(@UploadedFile() file: Express.Multer.File, @CurrentUser() user: RequestUser) {
    return this.documentsService.uploadDocument(file.originalname, file.buffer, user.id);
  }

  @Delete(':filename')
  async remove(@Param('filename') filename: string): Promise<{ ok: true }> {
    await this.documentsService.removeDocument(filename);
    return { ok: true };
  }

  @Get(':filename/file')
  async getFile(@Param('filename') filename: string, @Res() res: Response) {
    const buffer = await this.documentsService.readDocumentFile(filename);
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    res.send(buffer);
  }
}
