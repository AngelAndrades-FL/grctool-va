import { useMemo, useState } from 'react';
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  Collapse,
  Divider,
  IconButton,
  Paper,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import SmartToyIcon from '@mui/icons-material/SmartToy';
import ThumbUpIcon from '@mui/icons-material/ThumbUp';
import WarningIcon from '@mui/icons-material/Warning';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import RefreshIcon from '@mui/icons-material/Refresh';
import EditNoteIcon from '@mui/icons-material/EditNote';
import type { AiEvaluation, ObjectiveCoverage } from '@shared/types';
import { scoreColour } from '@/theme';

interface AiPanelProps {
  evaluation: AiEvaluation | null;
  isEvaluating?: boolean;
  onEvaluate?: () => void;
  onEditPrompt?: () => void;
}

function VerdictChip({ verdict }: { verdict: string }) {
  const verdictInfo: Record<string, { label: string; color: 'success' | 'warning' | 'error' | 'info' }> = {
    satisfied: { label: 'Satisfied', color: 'success' },
    other_than_satisfied: { label: 'Other than satisfied', color: 'warning' },
    insufficient_detail: { label: 'Insufficient detail', color: 'error' },
  };
  const info = verdictInfo[verdict] || { label: verdict, color: 'info' };
  return <Chip label={info.label} color={info.color} size="small" variant="outlined" />;
}

function ObjectiveRow({ objective }: { objective: ObjectiveCoverage }) {
  const [expanded, setExpanded] = useState(false);
  const covered = objective.covered;
  return (
    <Box key={objective.objective} sx={{ mb: 1.5, pb: 1.5, borderBottom: '1px solid', borderColor: 'divider' }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start', flex: 1 }}>
          {covered ? (
            <CheckCircleIcon sx={{ color: 'success.main', flexShrink: 0, mt: 0.5 }} />
          ) : (
            <WarningIcon sx={{ color: 'warning.main', flexShrink: 0, mt: 0.5 }} />
          )}
          <Typography variant="body2" sx={{ flex: 1 }}>
            {objective.objective}
          </Typography>
        </Stack>
        <Chip label={covered ? 'Covered' : 'Gap'} size="small" color={covered ? 'success' : 'warning'} />
      </Stack>
    </Box>
  );
}

export function AiPanel({ evaluation, isEvaluating = false, onEvaluate, onEditPrompt }: AiPanelProps) {
  const [expandGaps, setExpandGaps] = useState(true);
  const [expandStrengths, setExpandStrengths] = useState(true);
  const [expandRewrite, setExpandRewrite] = useState(false);

  const score = useMemo(() => {
    if (!evaluation) return 0;
    return Math.round(evaluation.score);
  }, [evaluation]);

  // No evaluation yet
  if (!evaluation && !isEvaluating) {
    return (
      <Box sx={{ p: 2, textAlign: 'center' }}>
        <SmartToyIcon sx={{ fontSize: 40, color: 'text.secondary', mb: 1 }} />
        <Typography variant="body2" color="text.secondary">
          No evaluation yet. Submit narratives and artifacts to enable AI scoring.
        </Typography>
        <Stack direction="row" spacing={1} sx={{ justifyContent: 'center', mt: 2 }}>
          {onEvaluate && (
            <Button startIcon={<SmartToyIcon />} onClick={onEvaluate}>
              Evaluate with AI
            </Button>
          )}
          {onEditPrompt && (
            <Button startIcon={<EditNoteIcon />} onClick={onEditPrompt}>
              Edit prompt
            </Button>
          )}
        </Stack>
      </Box>
    );
  }

  // Evaluating
  if (isEvaluating || !evaluation) {
    return (
      <Box sx={{ p: 2, textAlign: 'center' }}>
        <CircularProgress size={40} />
        <Typography variant="body2" sx={{ mt: 2, color: 'text.secondary' }}>
          Evaluating narrative against objectives...
        </Typography>
      </Box>
    );
  }

  // Show evaluation
  return (
    <Stack spacing={2} sx={{ p: 2 }}>
      {/* Header with score and verdict */}
      <Paper sx={{ p: 2, bgcolor: 'action.hover', borderRadius: 1 }}>
        <Stack spacing={2}>
          {/* Title + re-eval button */}
          <Stack direction="row" spacing={2} sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <SmartToyIcon sx={{ color: 'primary.main' }} />
              <Typography variant="h6">AI Assessment</Typography>
            </Stack>
            <Stack direction="row" spacing={0.5}>
              {onEditPrompt && (
                <Tooltip title="Edit prompt and re-evaluate">
                  <IconButton size="small" onClick={onEditPrompt}>
                    <EditNoteIcon />
                  </IconButton>
                </Tooltip>
              )}
              {onEvaluate && (
                <Tooltip title="Re-evaluate">
                  <IconButton size="small" onClick={onEvaluate}>
                    <RefreshIcon />
                  </IconButton>
                </Tooltip>
              )}
            </Stack>
          </Stack>

          {/* Score + metadata */}
          <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
            {/* Circular score */}
            <Box sx={{ position: 'relative', width: 60, height: 60 }}>
              <CircularProgress
                variant="determinate"
                value={Math.min(score, 100)}
                sx={{ color: scoreColour(score) }}
                size={60}
              />
              <Box
                sx={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Typography variant="caption" sx={{ fontWeight: 'bold', fontSize: 14 }}>
                  {score}%
                </Typography>
              </Box>
            </Box>

            {/* Label + verdict */}
            <Stack>
              <Typography variant="caption" color="text.secondary">
                Coverage Score
              </Typography>
              <VerdictChip verdict={evaluation.verdict} />
            </Stack>

            <Divider orientation="vertical" flexItem />

            {/* Timestamp + prompt version */}
            <Box>
              <Typography variant="caption" color="text.secondary">
                Evaluated {new Date(evaluation.at).toLocaleDateString()}
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ fontSize: 11 }}>
                Prompt v{evaluation.promptVersion}
              </Typography>
            </Box>
          </Stack>
        </Stack>
      </Paper>

      {/* Objective Coverage */}
      <Box>
        <Typography variant="subtitle2" sx={{ mb: 1.5, display: 'flex', alignItems: 'center', gap: 1 }}>
          <CheckCircleIcon sx={{ fontSize: 18 }} />
          Objective Coverage ({evaluation.objectiveCoverage.filter((o) => o.covered).length}/
          {evaluation.objectiveCoverage.length})
        </Typography>
        <Paper sx={{ p: 1.5, bgcolor: 'background.default' }}>
          {evaluation.objectiveCoverage.map((oc) => (
            <ObjectiveRow key={oc.objective} objective={oc} />
          ))}
        </Paper>
      </Box>

      {/* Gaps */}
      {evaluation.gaps.length > 0 && (
        <Box>
          <Button
            fullWidth
            onClick={() => setExpandGaps(!expandGaps)}
            sx={{ justifyContent: 'space-between', textTransform: 'none', mb: 1 }}
          >
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <WarningIcon sx={{ fontSize: 18, color: 'warning.main' }} />
              <Typography variant="subtitle2">
                {evaluation.gaps.length} Gap{evaluation.gaps.length === 1 ? '' : 's'} Identified
              </Typography>
            </Stack>
            <ExpandMoreIcon sx={{ transform: expandGaps ? 'rotate(180deg)' : 'rotate(0deg)' }} />
          </Button>
          <Collapse in={expandGaps}>
            <Paper
              sx={{
                p: 1.5,
                bgcolor: (theme) => (theme.palette.mode === 'light' ? '#fff3e0' : '#5f3c1f'),
                borderLeft: '4px solid',
                borderColor: 'warning.main',
              }}
            >
              <ul style={{ margin: 0, paddingLeft: 20 }}>
                {evaluation.gaps.map((gap, idx) => (
                  <li key={idx}>
                    <Typography variant="body2" sx={{ mb: 0.5 }}>
                      {gap}
                    </Typography>
                  </li>
                ))}
              </ul>
            </Paper>
          </Collapse>
        </Box>
      )}

      {/* Strengths */}
      {evaluation.strengths.length > 0 && (
        <Box>
          <Button
            fullWidth
            onClick={() => setExpandStrengths(!expandStrengths)}
            sx={{ justifyContent: 'space-between', textTransform: 'none', mb: 1 }}
          >
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <ThumbUpIcon sx={{ fontSize: 18, color: 'success.main' }} />
              <Typography variant="subtitle2">
                {evaluation.strengths.length} Strength{evaluation.strengths.length === 1 ? '' : 's'}
              </Typography>
            </Stack>
            <ExpandMoreIcon sx={{ transform: expandStrengths ? 'rotate(180deg)' : 'rotate(0deg)' }} />
          </Button>
          <Collapse in={expandStrengths}>
            <Paper
              sx={{
                p: 1.5,
                bgcolor: (theme) => (theme.palette.mode === 'light' ? '#e8f5e9' : '#1b5e20'),
                borderLeft: '4px solid',
                borderColor: 'success.main',
              }}
            >
              <ul style={{ margin: 0, paddingLeft: 20 }}>
                {evaluation.strengths.map((strength, idx) => (
                  <li key={idx}>
                    <Typography variant="body2" sx={{ mb: 0.5 }}>
                      {strength}
                    </Typography>
                  </li>
                ))}
              </ul>
            </Paper>
          </Collapse>
        </Box>
      )}

      {/* Suggested Rewrite */}
      {evaluation.suggestedRewrite && (
        <Box>
          <Button
            fullWidth
            onClick={() => setExpandRewrite(!expandRewrite)}
            sx={{ justifyContent: 'space-between', textTransform: 'none', mb: 1 }}
          >
            <Typography variant="subtitle2">Suggested Rewrite</Typography>
            <ExpandMoreIcon sx={{ transform: expandRewrite ? 'rotate(180deg)' : 'rotate(0deg)' }} />
          </Button>
          <Collapse in={expandRewrite}>
            <Paper
              sx={{
                p: 1.5,
                bgcolor: (theme) => (theme.palette.mode === 'light' ? '#e1f5fe' : '#01579b'),
                borderLeft: '4px solid',
                borderColor: 'info.main',
                fontFamily: 'monospace',
                fontSize: 11,
                maxHeight: 300,
                overflow: 'auto',
              }}
            >
              <Typography variant="body2" component="pre" sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {evaluation.suggestedRewrite}
              </Typography>
            </Paper>
          </Collapse>
        </Box>
      )}

      {/* Debug info */}
      <Typography variant="caption" color="text.secondary" sx={{ mt: 1 }}>
        Input hash: {evaluation.inputHash}
      </Typography>
    </Stack>
  );
}
