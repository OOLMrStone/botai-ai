import { PipelineConsole } from '@/components/pipeline/PipelineConsole';
import { b2bMetadata } from '@/config/b2b';
import { PIPELINE_COPY } from '@/config/pipeline-console';

export const metadata = b2bMetadata(PIPELINE_COPY.loginTitle, PIPELINE_COPY.chooseRunHint);

export default function PipelineConsolePage() {
  return <PipelineConsole />;
}
