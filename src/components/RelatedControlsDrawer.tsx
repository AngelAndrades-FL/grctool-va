import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  CircularProgress,
  Divider,
  Drawer,
  IconButton,
  LinearProgress,
  Paper,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import CloseIcon from '@mui/icons-material/Close';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import type { AiRelatedDraft, RelatedDraftElement, RelatedNarrative } from '@shared/types';
import { formatRelatedDraft } from '@shared/ai';
import type { ControlNode } from '@/domain/catalogIndex';
import { useAiRelatedDraft, useCatalogIndex, useEvidence } from '@/api/queries';
import { useAppState } from '@/state/AppState';
import { RichTextEditor, linesToEditorState } from './RichTextEditor';
import { LinkChip } from './routerLinks';

export interface RelatedControlsDrawerProps {
  open: boolean;
  node: ControlNode;
  currentNarrative: string;
  onClose: () => void;
}

const normalize = (text: string) => text.replace(/\s+/g, ' ').trim().toLowerCase();

/** Folds one step's elements into the running set, merging text for an element that was already drafted. */
function mergeElements(into: RelatedDraftElement[], incoming: RelatedDraftElement[]): void {
  for (const el of incoming) {
    const existing = el.element ? into.find((e) => normalize(e.element) === normalize(el.element)) : undefined;
    if (existing) {
      existing.draft = `${existing.draft}\n${el.draft}`;
      existing.sources = [...new Set([...existing.sources, ...el.sources])];
    } else {
      into.push({ ...el, sources: [...el.sources] });
    }
  }
}

export function RelatedControlsDrawer({ open, node, currentNarrative, onClose }: RelatedControlsDrawerProps) {
  const { data: index } = useCatalogIndex();
  const { data: evidence } = useEvidence();
  const { notify } = useAppState();
  const generate = useAiRelatedDraft();
  const [draft, setDraft] = useState<AiRelatedDraft | null>(null);
  const [edited, setEdited] = useState<{ json: string; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number; controlId: string } | null>(null);
  const runToken = useRef(0);
  const running = progress !== null;

  useEffect(() => {
    runToken.current++;
    setDraft(null);
    setEdited(null);
    setError(null);
    setProgress(null);
  }, [node.id]);

  const related = useMemo<RelatedNarrative[]>(() => {
    const ids = [...new Set([...node.relatedControls, ...node.crossReferences.map((r) => r.control_id)])].filter(
      (id) => id !== node.id,
    );
    return ids.map((id) => ({
      controlId: id,
      controlName: index?.nodeById.get(id)?.name ?? '',
      narrative: evidence?.[id]?.narrative.implementation.text.trim() ?? '',
    }));
  }, [node, index, evidence]);

  const withNarrative = related.filter((r) => r.narrative);

  /** Submits one related narrative at a time; each step sees the current narrative plus everything drafted so far. */
  const run = async () => {
    setError(null);
    const token = ++runToken.current;
    const cancelled = () => runToken.current !== token;
    const total = withNarrative.length;
    const elements: RelatedDraftElement[] = [];
    const gapSets: string[][] = [];
    const prompts: string[] = [];
    let failure: string | null = null;

    for (let i = 0; i < total && !cancelled(); i++) {
      const step = withNarrative[i]!;
      setProgress({ done: i, total, controlId: step.controlId });
      const working = [currentNarrative.trim(), formatRelatedDraft({ elements })].filter(Boolean).join('\n\n');
      try {
        const result = await generate.mutateAsync({
          controlId: node.id,
          controlName: node.name,
          controlStatement: node.statement,
          statementTemplate: node.statementVerbatim || node.statement,
          supplementalGuidance: node.supplementalGuidance || node.discussion,
          currentNarrative: working,
          related: [step],
        });
        if (cancelled()) break;
        mergeElements(elements, result.elements);
        gapSets.push(result.gaps);
        prompts.push(`===== Step ${i + 1} of ${total}: ${step.controlId} =====\n${result.renderedPrompt}`);
      } catch (err) {
        failure = err instanceof Error ? err.message : 'Draft generation failed.';
        break;
      }
    }

    if (cancelled()) return;
    setProgress(null);
    if (failure) setError(`${failure}${elements.length ? ' Showing the draft built so far.' : ''}`);
    if (!gapSets.length) return;
    // An element is a gap only if no related narrative supported it.
    const [first = [], ...rest] = gapSets;
    const gaps = first.filter((g) => rest.every((set) => set.some((s) => normalize(s) === normalize(g))));
    const result: AiRelatedDraft = { elements, gaps, renderedPrompt: prompts.join('\n\n') };
    const text = formatRelatedDraft(result);
    setDraft(result);
    setEdited({ json: linesToEditorState(text), text });
  };

  const stop = () => {
    runToken.current++;
    setProgress(null);
  };

  const copy = async () => {
    if (!edited?.text.trim()) return;
    await navigator.clipboard.writeText(edited.text);
    notify('Draft copied to the clipboard', 'success');
  };

  return (
    <Drawer anchor="left" open={open} onClose={onClose} slotProps={{ paper: { sx: { width: { xs: '100%', sm: 600 } } } }}>
      <Stack direction="row" sx={{ alignItems: 'center', px: 2, py: 1.5 }}>
        <Box sx={{ flexGrow: 1 }}>
          <Typography variant="subtitle1">Related controls — {node.id}</Typography>
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            {related.length} related control(s), {withNarrative.length} with an implementation narrative
          </Typography>
        </Box>
        <IconButton onClick={onClose} aria-label="Close related controls">
          <CloseIcon />
        </IconButton>
      </Stack>
      <Divider />

      <Box sx={{ overflowY: 'auto', p: 2 }}>
        <Stack spacing={2}>
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Stack spacing={1.5}>
              <Typography variant="subtitle2">Draft from related narratives</Typography>
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                Uses AI to draft text for {node.id} from what the related controls already implement. Related
                narratives are submitted one at a time alongside the current narrative and the draft built so far, so
                each step builds on the last. Elements no related narrative supports are listed as gaps.
              </Typography>
              <Stack direction="row" spacing={1}>
                <Button
                  size="small"
                  variant="contained"
                  startIcon={running ? <CircularProgress size={16} color="inherit" /> : <AutoAwesomeIcon />}
                  disabled={running || withNarrative.length === 0}
                  onClick={() => void run()}
                >
                  {draft ? 'Regenerate' : 'Generate partial narrative'}
                </Button>
                {running && (
                  <Button size="small" onClick={stop}>
                    Stop
                  </Button>
                )}
              </Stack>
              {progress && (
                <Box>
                  <LinearProgress variant="determinate" value={(progress.done / progress.total) * 100} />
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                    Step {progress.done + 1} of {progress.total}: reviewing {progress.controlId}
                  </Typography>
                </Box>
              )}
              {withNarrative.length === 0 && (
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                  None of the related controls has an implementation narrative yet.
                </Typography>
              )}
              {error && <Alert severity="error">{error}</Alert>}

              {draft && edited && (
                <>
                  {draft.elements.length === 0 && (
                    <Alert severity="info" variant="outlined">
                      The related narratives do not address any element of the {node.id} control statement.
                    </Alert>
                  )}
                  <RichTextEditor
                    key={draft.renderedPrompt + draft.elements.length}
                    label="Generated partial narrative"
                    valueJson={edited.json}
                    fallbackText={edited.text}
                    onChange={(json, text) => setEdited({ json, text })}
                    minHeight={180}
                    helperText="Review, then copy and paste the parts you want into the Implementation narrative. Nothing is added automatically."
                    actions={[
                      {
                        key: 'copy',
                        label: 'Copy',
                        title: 'Copy the generated text to the clipboard',
                        icon: <ContentCopyIcon fontSize="small" />,
                        onClick: () => void copy(),
                        disabled: !edited.text.trim(),
                      },
                    ]}
                  />
                  {draft.gaps.length > 0 && (
                    <Alert severity="warning" variant="outlined">
                      <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                        Not covered by related narratives
                      </Typography>
                      <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
                        {draft.gaps.map((gap) => (
                          <li key={gap}>
                            <Typography variant="body2">{gap}</Typography>
                          </li>
                        ))}
                      </Box>
                    </Alert>
                  )}
                  <Accordion disableGutters elevation={0} variant="outlined">
                    <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                      <Typography variant="caption">Prompt sent</Typography>
                    </AccordionSummary>
                    <AccordionDetails>
                      <Typography
                        component="pre"
                        variant="caption"
                        sx={{ whiteSpace: 'pre-wrap', fontFamily: 'monospace', m: 0, maxHeight: 260, overflowY: 'auto' }}
                      >
                        {draft.renderedPrompt}
                      </Typography>
                    </AccordionDetails>
                  </Accordion>
                </>
              )}
            </Stack>
          </Paper>

          {related.length === 0 && (
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              The catalog lists no related controls for {node.id}.
            </Typography>
          )}

          {related.map((r) => (
            <Paper key={r.controlId} variant="outlined" sx={{ p: 1.5 }}>
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1 }}>
                <Tooltip title={`Open ${r.controlId}`}>
                  <LinkChip
                    to="/control/$controlId"
                    params={{ controlId: r.controlId }}
                    label={r.controlId}
                    size="small"
                    variant="outlined"
                    clickable
                    onClick={onClose}
                    sx={{ height: 22, fontSize: 11 }}
                  />
                </Tooltip>
                <Typography variant="body2" noWrap sx={{ fontWeight: 500 }}>
                  {r.controlName}
                </Typography>
              </Stack>
              {r.narrative ? (
                <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                  {r.narrative}
                </Typography>
              ) : (
                <Typography variant="caption" sx={{ color: 'text.secondary', fontStyle: 'italic' }}>
                  No implementation narrative written yet.
                </Typography>
              )}
            </Paper>
          ))}
        </Stack>
      </Box>
    </Drawer>
  );
}
