import { Plus, Sigma, Trash2 } from 'lucide-react';
import { ExpertMathField } from '@/components/expert/ExpertMathField';
import { Button } from '@/components/ui/button';
import { EXPERT_RICH_TEXT_COPY } from '@/config/expert-rich-text';
import { layout } from '@/config/layout';
import { useGridRichTextEditor } from '@/hooks/use-grid-rich-text-editor';

interface ExpertRichTextEditorProps {
  value: string;
  onChange: (value: string) => void;
  label: string;
  onValidityChange?: (valid: boolean) => void;
}

export function ExpertRichTextEditor({
  value,
  onChange,
  label,
  onValidityChange,
}: ExpertRichTextEditorProps) {
  const editor = useGridRichTextEditor(value, onChange, onValidityChange);
  const styles = layout.expertRichText;
  const copy = EXPERT_RICH_TEXT_COPY;

  return (
    <div className={styles.editor}>
      {editor.segments.map((segment, index) => (
        <div key={segment.id} className={styles.segment}>
          <div className={styles.segmentBody}>
            {segment.kind === 'math' ? (
              <ExpertMathField
                value={segment.value}
                onChange={(next) => editor.update(segment.id, next)}
                label={copy.mathLabel(label, index)}
                onValidityChange={(ready) => editor.setMathValidity(segment.id, ready)}
              />
            ) : (
              <label className={styles.textLabel}>
                {copy.textLabel(label, index)}
                <textarea
                  value={segment.value}
                  onChange={(event) => editor.update(segment.id, event.target.value)}
                  className={styles.textarea}
                />
              </label>
            )}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-compact"
            aria-label={copy.remove}
            onClick={() => editor.remove(segment.id)}
          >
            <Trash2 aria-hidden="true" />
          </Button>
        </div>
      ))}
      <div className={styles.actions}>
        <Button type="button" variant="outline" size="compact" onClick={() => editor.add('text')}>
          <Plus aria-hidden="true" />
          {copy.addText}
        </Button>
        <Button type="button" variant="outline" size="compact" onClick={() => editor.add('math')}>
          <Sigma aria-hidden="true" />
          {copy.addMath}
        </Button>
      </div>
    </div>
  );
}
