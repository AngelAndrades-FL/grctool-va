import { useEffect, useState } from 'react';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Typography,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import type { AiReviseRequest, AiRevision } from '@shared/types';
import { useAiRevise } from '@/api/queries';
import { RichTextEditor, linesToEditorState } from './RichTextEditor';

export interface AiReviseDialogProps {
  /** Non-null opens the dialog and starts a revision for this request. */
  request: AiReviseRequest | null;
  onClose: () => void;
  onAccept: (json: string, text: string) => void;
}

/** Shows an AI-revised narrative in an editable editor; accepting replaces the original, cancelling discards it. */
export function AiReviseDialog({ request, onClose, onAccept }: AiReviseDialogProps) {
  const revise = useAiRevise();
  const [revision, setRevision] = useState<AiRevision | null>(null);
  const [edited, setEdited] = useState<{ json: string; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = (req: AiReviseRequest) => {
    setRevision(null);
    setEdited(null);
    setError(null);
    revise.mutate(req, {
      onSuccess: (result) => {
        setRevision(result);
        setEdited({ json: linesToEditorState(result.revisedNarrative), text: result.revisedNarrative });
      },
      onError: (err) => setError(err instanceof Error ? err.message : 'The AI check failed.'),
    });
  };

  useEffect(() => {
    // Only a new request should trigger a new revision.
    if (request) run(request);
  }, [request]);

  return (
    <Dialog open={Boolean(request)} onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle sx={{ pb: 1 }}>Check with AI — {request?.controlId}</DialogTitle>
      <DialogContent dividers>
        {revise.isPending && (
          <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', py: 4, justifyContent: 'center' }}>
            <CircularProgress size={20} />
            <Typography variant="body2">Evaluating the narrative against the control statement…</Typography>
          </Stack>
        )}

        {error && (
          <Alert
            severity="error"
            action={
              request && (
                <Button size="small" onClick={() => run(request)}>
                  Retry
                </Button>
              )
            }
          >
            {error}
          </Alert>
        )}

        {revision && edited && (
          <Stack spacing={2}>
            {revision.notes.length > 0 && (
              <Alert severity="info" variant="outlined">
                <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                  Assessor notes
                </Typography>
                <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
                  {revision.notes.map((note) => (
                    <li key={note}>
                      <Typography variant="body2">{note}</Typography>
                    </li>
                  ))}
                </Box>
              </Alert>
            )}

            <RichTextEditor
              key={revision.renderedPrompt}
              label="Revised narrative — edit as needed before accepting"
              valueJson={edited.json}
              fallbackText={edited.text}
              onChange={(json, text) => setEdited({ json, text })}
              minHeight={260}
              helperText="Fill in every [bracketed] placeholder with your organization's actual values."
            />

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
                  {revision.renderedPrompt}
                </Typography>
              </AccordionDetails>
            </Accordion>
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          disabled={!edited?.text.trim()}
          onClick={() => {
            if (!edited) return;
            onAccept(edited.json, edited.text);
            onClose();
          }}
        >
          Accept and replace narrative
        </Button>
      </DialogActions>
    </Dialog>
  );
}
