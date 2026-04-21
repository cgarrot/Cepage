import { Global, Module } from '@nestjs/common';
import { GraphModule } from '../graph/graph.module';
import { ConnectorService } from './connector.service';

@Global()
@Module({
  imports: [GraphModule],
  providers: [ConnectorService],
  exports: [ConnectorService],
})
export class ConnectorsModule {}
