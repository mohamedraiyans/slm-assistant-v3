import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { GraphService } from './graph.service';

@Controller('graph')
@UseGuards(JwtAuthGuard)
export class GraphController {
  constructor(private readonly graph: GraphService) {}

  @Get()
  async data() {
    return { enabled: this.graph.enabled, ...(await this.graph.data()) };
  }

  /** Shows what the graph step would add for a question, without calling any LLM. */
  @Get('facts')
  async facts(@Query('q') q = '') {
    return { facts: await this.graph.factsFor(q) };
  }
}
