import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import type {
  RecitationReferenceSummary,
  RecitationWordTiming,
} from '@slm/shared-types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { RequestUser } from '../auth/types';
import {
  FeatureGuard,
  RequireFeature,
} from '../features/require-feature.guard';
import { RecitationService } from './recitation.service';

// A long surah at a typical 64-128 kbps is tens of megabytes.
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

@Controller('recitation/references')
@UseGuards(JwtAuthGuard, FeatureGuard)
@RequireFeature('recitation')
export class RecitationController {
  constructor(private readonly recitation: RecitationService) {}

  @Get()
  list(): Promise<RecitationReferenceSummary[]> {
    return this.recitation.listReferences();
  }

  @Post()
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
    }),
  )
  upload(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: Record<string, unknown>,
    @CurrentUser() user: RequestUser,
  ): Promise<RecitationReferenceSummary> {
    return this.recitation.uploadReference(file, body ?? {}, user.id);
  }

  @Get(':id/audio')
  async audio(
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
  ): Promise<void> {
    const { path, mimeType } = await this.recitation.getAudio(id);
    // sendFile handles HTTP Range requests, which the browser's audio element needs
    // to seek — and which phase 2 relies on to play back a single word's time slice.
    res.sendFile(path, { headers: { 'Content-Type': mimeType } }, (error) => {
      // Once bytes are flowing, an error is almost always the browser aborting the
      // request mid-seek, which is normal. Before that, the file is missing on disk.
      if (error && !res.headersSent) {
        res
          .status(404)
          .json({ statusCode: 404, message: 'Audio file missing' });
      }
    });
  }

  @Get(':id/words')
  words(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<RecitationWordTiming[]> {
    return this.recitation.listWords(id);
  }

  @Post(':id/reprocess')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  reprocess(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<RecitationReferenceSummary> {
    return this.recitation.reprocessReference(id);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<{ ok: true }> {
    await this.recitation.removeReference(id);
    return { ok: true };
  }
}
