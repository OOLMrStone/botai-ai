import { ExpertDiagramDescription } from '@/components/expert/ExpertDiagramDescription';
import { ExpertRichTextEditor } from '@/components/expert/ExpertRichTextEditor';
import type { ExpertStepBlock } from '@/config/expert';
import { EXPERT_UI_COPY } from '@/config/expert-ui';
import { layout } from '@/config/layout';
import { useExpertStepText } from '@/hooks/use-expert-step-text';

export function ExpertStepTextEditor({
  block,
  onChange,
  onValidityChange,
}: {
  block: ExpertStepBlock;
  onChange: (value: string) => void;
  onValidityChange: (valid: boolean) => void;
}) {
  const editor = useExpertStepText(
    block.lines.join('\n'),
    block.diagram,
    onChange,
    onValidityChange,
  );

  return (
    <div className={layout.expert.editorSection}>
      {editor.parts.map((part) => {
        const field = (
          <ExpertRichTextEditor
            value={part.value}
            onChange={(value) => editor.update(part.id, value)}
            label={EXPERT_UI_COPY.recognizedText}
            onValidityChange={(valid) => editor.setValidity(part.id, valid)}
          />
        );

        return part.kind === 'description' ? (
          <ExpertDiagramDescription key={part.id}>{field}</ExpertDiagramDescription>
        ) : (
          <div key={part.id}>{field}</div>
        );
      })}
    </div>
  );
}
