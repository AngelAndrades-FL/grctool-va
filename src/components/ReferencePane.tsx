import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Chip,
  Divider,
  List,
  ListItem,
  ListItemText,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableRow,
  Typography,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import type { ControlNode } from '@/domain/catalogIndex';
import { baselineLabel, overlayDivergence } from '@/domain/baseline';
import { useAppState } from '@/state/AppState';
import { LinkChip } from './routerLinks';

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Accordion defaultExpanded disableGutters square elevation={0} sx={{ '&:before': { display: 'none' } }}>
      <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ minHeight: 40, '& .MuiAccordionSummary-content': { my: 0.75 } }}>
        <Typography variant="subtitle2">{title}</Typography>
      </AccordionSummary>
      <AccordionDetails sx={{ pt: 0 }}>{children}</AccordionDetails>
    </Accordion>
  );
}

function ControlLink({ id }: { id: string }) {
  return (
    <LinkChip
      to="/control/$controlId"
      params={{ controlId: id }}
      label={id}
      size="small"
      variant="outlined"
      clickable
      sx={{ height: 22, fontSize: 11 }}
    />
  );
}

/** Everything on this pane comes from the catalog and is never editable. */
export function ReferencePane({ node }: { node: ControlNode }) {
  const { mode } = useAppState();
  const overlay = node.vaOverlay;
  const divergence = overlayDivergence(node.control);

  return (
    <Box sx={{ height: '100%', overflowY: 'auto' }}>
      <Box sx={{ p: 2, pb: 1 }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', mb: 0.5 }}>
          <Typography variant="h6">{node.id}</Typography>
          {node.status !== 'active' && (
            <Chip label={node.status.replace(/_/g, ' ')} size="small" color="warning" sx={{ height: 20, fontSize: 11 }} />
          )}
          <Chip label={baselineLabel(node.control, mode)} size="small" variant="outlined" sx={{ height: 20, fontSize: 11 }} />
          {node.priorityCode && (
            <Chip label={node.priorityCode} size="small" variant="outlined" sx={{ height: 20, fontSize: 11 }} />
          )}
          <Chip
            label={node.designation.replace(/_/g, ' ')}
            size="small"
            variant="outlined"
            sx={{ height: 20, fontSize: 11 }}
          />
          {node.controlTypes.map((t) => (
            <Chip key={t} label={t} size="small" variant="outlined" sx={{ height: 20, fontSize: 11 }} />
          ))}
        </Stack>
        <Typography variant="body1" sx={{ fontWeight: 500 }}>
          {node.name}
        </Typography>
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          {node.familyId} — {node.familyName}
        </Typography>
      </Box>

      {divergence.length > 0 && (
        <Alert severity="info" sx={{ mx: 2, mb: 1, py: 0 }}>
          VA overlay and 800-53B allocate this control differently at: {divergence.join(', ')}.
        </Alert>
      )}

      <Divider />

      {node.plainEnglish && (
        <Section title="In plain English">
          <Typography variant="body2">{node.plainEnglish}</Typography>
        </Section>
      )}

      <Section title="Control statement">
        <Typography variant="body2">{node.statement || '—'}</Typography>
      </Section>

      {(node.discussion || node.supplementalGuidance) && (
        <Section title="Discussion">
          {node.supplementalGuidance && (
            <Box sx={{ mb: node.discussion ? 1.5 : 0 }}>
              <Typography variant="overline" sx={{ color: 'text.secondary', lineHeight: 1.5, display: 'block' }}>
                Supplemental guidance
              </Typography>
              <Typography variant="body2" sx={{ whiteSpace: 'pre-line' }}>
                {node.supplementalGuidance}
              </Typography>
            </Box>
          )}
          {node.discussion && (
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              {node.discussion}
            </Typography>
          )}
        </Section>
      )}

      {node.assessmentObjectives.length > 0 && (
        <Section title={`Assessment objectives (${node.assessmentObjectives.length})`}>
          <List dense disablePadding>
            {node.assessmentObjectives.map((objective, i) => (
              <ListItem key={objective} disableGutters sx={{ alignItems: 'flex-start', py: 0.25 }}>
                <ListItemText
                  primary={
                    <Typography variant="body2">
                      <strong>{i + 1}.</strong> {objective}
                    </Typography>
                  }
                />
              </ListItem>
            ))}
          </List>
        </Section>
      )}

      {node.parameters.length > 0 && (
        <Section title={`Organization-defined parameters (${node.parameters.length})`}>
          <Table size="small">
            <TableBody>
              {node.parameters.map((p) => (
                <TableRow key={p.parameterId}>
                  <TableCell sx={{ width: 140, verticalAlign: 'top', px: 0, borderBottom: 'none' }}>
                    <Typography variant="caption" sx={{ fontFamily: 'monospace' }}>
                      {p.parameterId}
                    </Typography>
                  </TableCell>
                  <TableCell sx={{ px: 0, borderBottom: 'none' }}>
                    <Typography variant="body2">{p.description}</Typography>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Section>
      )}

      {overlay && (
        <Section title="VA 6500 overlay">
          <Stack spacing={1.5}>
            {overlay.va_baseline_allocation && (
              <Box>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                  Baseline allocation
                </Typography>
                <Stack direction="row" spacing={1} sx={{ mt: 0.5, flexWrap: 'wrap' }}>
                  {(['low', 'moderate', 'high'] as const).map((level) => (
                    <Chip
                      key={level}
                      size="small"
                      variant="outlined"
                      label={`${level}: ${overlay.va_baseline_allocation?.[level] ?? 'Not Selected'}`}
                      sx={{ height: 20, fontSize: 11 }}
                    />
                  ))}
                </Stack>
              </Box>
            )}

            {overlay.va_odp_values && overlay.va_odp_values.length > 0 && (
              <Box>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                  VA-defined parameter values
                </Typography>
                <Table size="small">
                  <TableBody>
                    {overlay.va_odp_values.map((v) => (
                      <TableRow key={v.parameter}>
                        <TableCell sx={{ width: 200, verticalAlign: 'top', px: 0, borderBottom: 'none' }}>
                          <Typography variant="body2" sx={{ fontWeight: 500 }}>
                            {v.parameter}
                          </Typography>
                        </TableCell>
                        <TableCell sx={{ px: 0, borderBottom: 'none' }}>
                          <Typography variant="body2">{v.value}</Typography>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Box>
            )}

            {overlay.va_implementation_guidance && (
              <Box>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                  Implementation guidance
                </Typography>
                <Typography variant="body2">{overlay.va_implementation_guidance}</Typography>
              </Box>
            )}

            {overlay.va_specific_requirements && overlay.va_specific_requirements.length > 0 && (
              <Box>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                  VA-specific requirements
                </Typography>
                <List dense disablePadding>
                  {overlay.va_specific_requirements.map((req) => (
                    <ListItem key={req} disableGutters sx={{ py: 0.1 }}>
                      <ListItemText primary={<Typography variant="body2">• {req}</Typography>} />
                    </ListItem>
                  ))}
                </List>
              </Box>
            )}

            {overlay.mapping_notes && (
              <Box>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                  Mapping notes
                </Typography>
                <Typography variant="body2" sx={{ fontStyle: 'italic' }}>
                  {overlay.mapping_notes}
                </Typography>
              </Box>
            )}
          </Stack>
        </Section>
      )}

      {node.evidenceRequired.length > 0 && (
        <Section title={`Required evidence (${node.evidenceRequired.length})`}>
          <Stack spacing={1}>
            {node.evidenceRequired.map((req) => (
              <Box key={req.evidence_type}>
                <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    {req.evidence_type}
                  </Typography>
                  {req.satisfies_va_overlay && !req.satisfies_nist && (
                    <Chip label="VA only" size="small" color="info" variant="outlined" sx={{ height: 17, fontSize: 10 }} />
                  )}
                </Stack>
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                  {req.description}
                </Typography>
              </Box>
            ))}
          </Stack>
        </Section>
      )}

      {(node.relatedControls.length > 0 || node.crossReferences.length > 0) && (
        <Section title="Related controls">
          <Stack spacing={1.5}>
            {node.relatedControls.length > 0 && (
              <Box>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                  Related
                </Typography>
                <Stack direction="row" spacing={0.5} sx={{ mt: 0.5, flexWrap: 'wrap', gap: 0.5 }}>
                  {node.relatedControls.map((id) => (
                    <ControlLink key={id} id={id} />
                  ))}
                </Stack>
              </Box>
            )}
            {node.crossReferences.map((ref) => (
              <Box key={ref.control_id}>
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                  <ControlLink id={ref.control_id} />
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                    shares: {ref.shared_evidence_types?.join(', ') || '—'}
                  </Typography>
                </Stack>
                <Typography variant="body2" sx={{ mt: 0.25 }}>
                  {ref.relationship_description}
                </Typography>
              </Box>
            ))}
          </Stack>
        </Section>
      )}
    </Box>
  );
}
