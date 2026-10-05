import { useCallback, useMemo, useRef, useState } from 'react';
import { useForm } from '@tanstack/react-form';
import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  IconButton,
  Link,
  MenuItem,
  Paper,
  Stack,
  Switch,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CloudDoneIcon from '@mui/icons-material/CloudDone';
import SyncIcon from '@mui/icons-material/Sync';
import UndoIcon from '@mui/icons-material/Undo';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import HubOutlinedIcon from '@mui/icons-material/HubOutlined';
import { DateTime } from 'luxon';
import { IMPLEMENTATION_STATUSES, RESPONSIBLE_ROLES, type Artifact, type AiEvaluateRequest, type AiReviseRequest, type EvidenceRecord, type ImplementationStatus } from '@shared/types';
import { renderPrompt, DEFAULT_PROMPT_TEMPLATE } from '@shared/ai';
import { frequencySuggestions, suggestsRecurringEvidence } from '@shared/recurring';
import type { ControlNode } from '@/domain/catalogIndex';
import { seedRecord } from '@/domain/records';
import { validateEvidenceRules } from '@/domain/evidenceSchema';
import { computeCompleteness, atoMinDate } from '@/domain/completeness';
import { useSaveEvidence, useSettings, useAiEvaluate } from '@/api/queries';
import { useAppState } from '@/state/AppState';
import { scoreColour, statusColour } from '@/theme';
import { RichTextEditor } from './RichTextEditor';
import { AiReviseDialog } from './AiReviseDialog';
import { RelatedControlsDrawer } from './RelatedControlsDrawer';
import { ArtifactsPanel } from './ArtifactsPanel';
import { PoamAttachments } from './PoamAttachments';
import { AiPanel } from './AiPanel';

const STATUS_LABEL: Record<ImplementationStatus, string> = {
  not_started: 'Not started',
  planned: 'Planned',
  partially_implemented: 'Partially implemented',
  implemented: 'Implemented',
  inherited: 'Inherited',
  not_applicable: 'Not applicable',
  alternative_implementation: 'Alternative implementation',
};

const ORIGINATIONS: Array<{ value: EvidenceRecord['origination']; label: string; description: string }> = [
  { value: 'common', label: 'Common', description: 'Provided organization-wide and shared across systems.' },
  { value: 'hybrid', label: 'Hybrid', description: 'Partly provided externally, partly implemented by this system.' },
  { value: 'system_specific', label: 'System-specific', description: 'Implemented entirely by this system.' },
  { value: 'inherited', label: 'Inherited', description: 'Fully provided by another system or service (e.g., hosting platform).' },
];

function SectionCard({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Typography variant="subtitle2" gutterBottom>
        {title}
      </Typography>
      {subtitle && (
        <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 1.5 }}>
          {subtitle}
        </Typography>
      )}
      <Stack spacing={2} sx={{ mt: subtitle ? 0 : 1 }}>
        {children}
      </Stack>
    </Paper>
  );
}

function isoToDate(value: string | null): DateTime | null {
  return value ? DateTime.fromISO(value) : null;
}

export function EvidenceForm({ node, record }: { node: ControlNode; record?: EvidenceRecord }) {
  const saveEvidence = useSaveEvidence();
  const aiEvaluate = useAiEvaluate();
  const { data: settings } = useSettings();
  const { notify } = useAppState();
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const initial = useMemo(() => seedRecord(node, record), [node, record]);
  const baseline = useRef(initial);

  const persist = useCallback(
    (values: EvidenceRecord) => {
      saveEvidence.mutate([{ ...values, updatedAt: new Date().toISOString() }], {
        onSuccess: (result) => setSavedAt(result.savedAt),
        onError: (error) => notify(error instanceof Error ? error.message : 'Save failed', 'error'),
      });
    },
    [saveEvidence, notify],
  );

  const [promptDialogOpen, setPromptDialogOpen] = useState(false);
  const [promptDraft, setPromptDraft] = useState('');
  const [reviseRequest, setReviseRequest] = useState<AiReviseRequest | null>(null);
  const [relatedOpen, setRelatedOpen] = useState(false);
  // Lexical only reads its initial state once, so an accepted revision remounts the editor.
  const [narrativeEditorKey, setNarrativeEditorKey] = useState(0);

  const form = useForm({
    defaultValues: initial,
    listeners: {
      onChangeDebounceMs: 1200,
      onChange: ({ formApi }) => persist(formApi.state.values),
    },
    onSubmit: ({ value }) => persist(value),
  });

  const buildAiRequest = useCallback((): AiEvaluateRequest => {
    const narrative = form.state.values.narrative.implementation.text;
    return {
      controlId: node.id,
      controlName: node.name,
      narrative,
      controlStatement: node.statement,
      discussion: node.discussion,
      assessmentObjectives: node.assessmentObjectives,
      objectiveResponses: node.assessmentObjectives.map((_o, i) => {
        const answer = form.state.values.objectiveResponses.find((r) => r.objectiveIndex === i);
        return { met: answer?.met ?? null, note: answer?.note ?? '' };
      }),
      requiredEvidenceTypes: node.evidenceRequired?.map((e) => e.evidence_type) ?? [],
      providedEvidenceTypes: form.state.values.artifacts.map((a) => a.evidenceType),
      vaOdpValues: form.state.values.odpResponses.map((o) => ({ parameter: o.label, value: o.value })),
      vaSpecificRequirements: node.vaOverlay?.va_specific_requirements ?? [],
    };
  }, [form.state.values, node]);

  const runEvaluate = useCallback(
    (promptOverride?: string) => {
      if (!settings) {
        notify('Settings not loaded', 'error');
        return;
      }

      const req: AiEvaluateRequest = { ...buildAiRequest(), promptOverride };

      aiEvaluate.mutate(req, {
        onSuccess: (evaluation) => {
          evaluation.objectiveCoverage.forEach((answer, position) => {
            const objectiveIndex = answer.objectiveIndex ?? position;
            const row = form.state.values.objectiveResponses.findIndex((r) => r.objectiveIndex === objectiveIndex);
            if (row === -1) return;
            form.setFieldValue(`objectiveResponses[${row}].met`, answer.covered);
            form.setFieldValue(`objectiveResponses[${row}].note`, answer.rationale);
          });
          form.setFieldValue('aiEvaluations', [...form.state.values.aiEvaluations, evaluation]);

          const met = evaluation.objectiveCoverage.filter((o) => o.covered).length;
          saveEvidence.mutate([{ ...form.state.values, updatedAt: new Date().toISOString() }], {
            onSuccess: (result) => {
              setSavedAt(result.savedAt);
              notify(
                evaluation.objectiveCoverage.length
                  ? `AI assessment answered ${evaluation.objectiveCoverage.length} objective(s): ${met} met`
                  : 'Evaluation saved',
                'success',
              );
            },
            onError: (error) => notify(error instanceof Error ? error.message : 'Save failed', 'error'),
          });
        },
        onError: (error) => {
          notify(error instanceof Error ? error.message : 'Evaluation failed', 'error');
        },
      });
    },
    [buildAiRequest, settings, aiEvaluate, form.state.values, saveEvidence, notify],
  );

  const handleEvaluate = useCallback(() => runEvaluate(undefined), [runEvaluate]);

  const handleOpenPromptEditor = useCallback(() => {
    const template = settings?.promptTemplate ?? DEFAULT_PROMPT_TEMPLATE;
    setPromptDraft(renderPrompt(template, buildAiRequest()));
    setPromptDialogOpen(true);
  }, [settings, buildAiRequest]);

  const handleEvaluateWithEditedPrompt = useCallback(() => {
    setPromptDialogOpen(false);
    runEvaluate(promptDraft);
  }, [promptDraft, runEvaluate]);

  const ruleErrors = validateEvidenceRules(form.state.values) ?? {};
  const completeness = computeCompleteness(node, form.state.values);
  const minEvidenceDate = atoMinDate(settings?.lastAtoDate);
  const recurringSuggested = useMemo(
    () => suggestsRecurringEvidence(`${node.statement} ${node.discussion}`),
    [node.statement, node.discussion],
  );

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Box sx={{ flexGrow: 1, overflowY: 'auto', p: 2 }}>
        <Stack spacing={2}>
          <SectionCard title="Status and applicability">
            <form.Field name="implementationStatus">
              {(field) => (
                <TextField
                  select
                  fullWidth
                  label="Implementation status"
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value as ImplementationStatus)}
                >
                  {IMPLEMENTATION_STATUSES.map((status) => (
                    <MenuItem key={status} value={status}>
                      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                        <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: statusColour(status) }} />
                        <span>{STATUS_LABEL[status]}</span>
                      </Stack>
                    </MenuItem>
                  ))}
                </TextField>
              )}
            </form.Field>

            <form.Field name="origination">
              {(field) => (
                <TextField
                  select
                  fullWidth
                  label="Control origination"
                  helperText={`Catalog designation: ${node.designation.replace(/_/g, ' ')}`}
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value as EvidenceRecord['origination'])}
                  slotProps={{
                    select: {
                      renderValue: (value) => ORIGINATIONS.find((o) => o.value === value)?.label ?? String(value),
                    },
                  }}
                >
                  {ORIGINATIONS.map((o) => (
                    <MenuItem key={o.value} value={o.value} sx={{ display: 'block', whiteSpace: 'normal', maxWidth: 380 }}>
                      <Typography variant="body2">{o.label}</Typography>
                      <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                        {o.description}
                      </Typography>
                    </MenuItem>
                  ))}
                </TextField>
              )}
            </form.Field>

            <form.Field name="inScope">
              {(field) => (
                <FormControlLabel
                  control={
                    <Switch checked={field.state.value} onChange={(e) => field.handleChange(e.target.checked)} />
                  }
                  label={<Typography variant="body2">In scope for this system</Typography>}
                />
              )}
            </form.Field>

            <form.Subscribe selector={(state) => state.values.implementationStatus}>
              {(status) =>
                status === 'not_applicable' || !form.state.values.inScope ? (
                  <form.Field name="naJustification">
                    {(field) => (
                      <TextField
                        fullWidth
                        multiline
                        minRows={2}
                        label="Not-applicable justification"
                        required
                        error={Boolean(ruleErrors.naJustification)}
                        helperText={ruleErrors.naJustification ?? 'Assessors will read this in place of an implementation statement.'}
                        value={field.state.value}
                        onChange={(e) => field.handleChange(e.target.value)}
                      />
                    )}
                  </form.Field>
                ) : null
              }
            </form.Subscribe>
          </SectionCard>

          <SectionCard
            title="Implementation narrative"
            subtitle="Describe the control as it actually operates — who performs it, using what, how often, and how it is evidenced."
          >
            <form.Field name="narrative.implementation">
              {(field) => (
                <>
                <RichTextEditor
                  key={narrativeEditorKey}
                  valueJson={field.state.value.json}
                  fallbackText={field.state.value.text}
                  onChange={(json, text) => field.handleChange({ json, text })}
                  placeholder="The Information System Owner reviews all privileged accounts semi-annually using…"
                  minHeight={200}
                  helperText="Assessors generally expect 60+ words for a substantive control"
                  template={
                    node.statementVerbatim || node.statement
                      ? {
                          label: 'Control statement',
                          title: `Load the ${node.id} control statement as a template — address each element and fill in every [Assignment]`,
                          text: node.statementVerbatim || node.statement,
                        }
                      : undefined
                  }
                  actions={[
                    {
                      key: 'ai-check',
                      label: 'Check with AI',
                      title: 'Evaluate this narrative against the control statement and supplemental guidance, and get a revised draft',
                      icon: <AutoAwesomeIcon fontSize="small" />,
                      onClick: () =>
                        setReviseRequest({
                          controlId: node.id,
                          controlName: node.name,
                          controlStatement: node.statement,
                          supplementalGuidance: node.supplementalGuidance || node.discussion,
                          statementTemplate: node.statementVerbatim || node.statement,
                          narrative: field.state.value.text,
                        }),
                    },
                    {
                      key: 'related-controls',
                      label: 'Related Controls',
                      title: 'Show the implementation narratives of related controls and draft text for this control from them',
                      icon: <HubOutlinedIcon fontSize="small" />,
                      onClick: () => setRelatedOpen(true),
                    },
                  ]}
                />
                <RelatedControlsDrawer
                  open={relatedOpen}
                  node={node}
                  currentNarrative={field.state.value.text}
                  onClose={() => setRelatedOpen(false)}
                />
                <AiReviseDialog
                  request={reviseRequest}
                  onClose={() => setReviseRequest(null)}
                  onAccept={(json, text) => {
                    field.handleChange({ json, text });
                    setNarrativeEditorKey((k) => k + 1);
                    notify('Narrative replaced with the revised version', 'success');
                  }}
                />
                </>
              )}
            </form.Field>
          </SectionCard>

          <SectionCard
            title="Evidence artifacts"
            subtitle="Attach the proof. Mark an artifact as recurring when it must be re-collected on a cadence; earlier cycles are kept."
          >
            <form.Field name="artifacts">
              {(field) => (
                <ArtifactsPanel
                  controlId={node.id}
                  familyId={node.familyId}
                  evidenceRequired={node.evidenceRequired}
                  artifacts={field.state.value}
                  currentUser={settings?.currentUser ?? ''}
                  suggestRecurring={recurringSuggested}
                  onChange={(artifacts: Artifact[]) => {
                    const before = new Map(field.state.value.map((a) => [a.id, a]));
                    field.handleChange(artifacts);
                    const changed = artifacts.filter((a) => {
                      const prior = before.get(a.id);
                      return (
                        a.recurrence &&
                        (!prior ||
                          JSON.stringify([prior.recurrence?.frequencyType, prior.recurrence?.frequencyDetail, prior.evidenceType, prior.title]) !==
                            JSON.stringify([a.recurrence.frequencyType, a.recurrence.frequencyDetail, a.evidenceType, a.title]))
                      );
                    });
                    if (changed.length === 0) return;
                    let updated = 0;
                    form.state.values.odpResponses.forEach((param, index) => {
                      const [suggestion] = frequencySuggestions(param.label, changed, true);
                      if (suggestion && suggestion.text !== param.value.trim()) {
                        form.setFieldValue(`odpResponses[${index}].value`, suggestion.text);
                        updated += 1;
                      }
                    });
                    if (updated) notify(`Updated ${updated} organization-defined value(s) from recurring evidence`, 'info');
                  }}
                />
              )}
            </form.Field>
          </SectionCard>

          {initial.odpResponses.length > 0 && (
            <SectionCard
              title="Organization-defined values"
              subtitle="These are the blanks the control leaves to the organization. An assessor will look for each one."
            >
              {initial.odpResponses.map((param, index) => (
                <form.Field key={param.parameterId} name={`odpResponses[${index}].value`}>
                  {(field) => (
                    <form.Subscribe selector={(state) => state.values.artifacts}>
                      {(artifacts) => {
                        const suggestions = frequencySuggestions(param.label, artifacts);
                        const matched = suggestions.find((s) => s.text === field.state.value.trim());
                        const offered = !matched ? suggestions[0] : undefined;
                        return (
                          <TextField
                            fullWidth
                            label={param.label}
                            value={field.state.value}
                            onChange={(e) => field.handleChange(e.target.value)}
                            helperText={
                              matched ? (
                                `From recurring evidence: “${matched.artifactTitle}”`
                              ) : offered ? (
                                <>
                                  From recurring evidence: “{offered.artifactTitle}” uses “{offered.text}” —{' '}
                                  <Link component="button" type="button" variant="caption" onClick={() => field.handleChange(offered.text)}>
                                    use this
                                  </Link>
                                </>
                              ) : undefined
                            }
                            slotProps={{
                              input: {
                                endAdornment: (
                                  <Chip
                                    label={param.source === 'va' ? 'VA' : 'NIST'}
                                    size="small"
                                    variant="outlined"
                                    sx={{ height: 18, fontSize: 10 }}
                                  />
                                ),
                              },
                            }}
                          />
                        );
                      }}
                    </form.Subscribe>
                  )}
                </form.Field>
              ))}
            </SectionCard>
          )}

          {initial.objectiveResponses.length > 0 && (
            <SectionCard
              title="Assessment objectives"
              subtitle="The 800-53A determination statements an assessor tests; every one must be met for the control to pass. Running the AI assessment answers each objective — Met or Not met with an explanation — and fills in this section; those answers drive the AI's rating of this control, and answered objectives count toward its completeness score. Review each answer, correct it where needed, and note where the supporting evidence lives."
            >
              {initial.objectiveResponses.map((objective, index) => (
                <Box key={objective.objectiveIndex}>
                  <Stack direction="row" spacing={1.5} sx={{ alignItems: 'flex-start' }}>
                    <form.Field name={`objectiveResponses[${index}].met`}>
                      {(field) => (
                        <ToggleButtonGroup
                          exclusive
                          size="small"
                          value={field.state.value}
                          onChange={(_e, next: boolean | null) => field.handleChange(next)}
                          sx={{ flexShrink: 0 }}
                        >
                          <ToggleButton value={true} color="success" sx={{ px: 1, py: 0.25 }}>
                            Met
                          </ToggleButton>
                          <ToggleButton value={false} color="error" sx={{ px: 1, py: 0.25 }}>
                            Not met
                          </ToggleButton>
                        </ToggleButtonGroup>
                      )}
                    </form.Field>
                    <Typography variant="body2" sx={{ pt: 0.5 }}>
                      <strong>{index + 1}.</strong> {node.assessmentObjectives[index]}
                    </Typography>
                  </Stack>
                  <form.Field name={`objectiveResponses[${index}].note`}>
                    {(field) => (
                      <TextField
                        fullWidth
                        size="small"
                        multiline
                        placeholder="Answer the objective and note where the evidence for it lives — or run the AI assessment to draft an answer."
                        sx={{ mt: 1 }}
                        value={field.state.value}
                        onChange={(e) => field.handleChange(e.target.value)}
                      />
                    )}
                  </form.Field>
                </Box>
              ))}
            </SectionCard>
          )}

          <SectionCard title="Ownership">
            <Stack direction="row" spacing={2}>
              <form.Field name="ownership.responsibleRole">
                {(field) => (
                  <TextField
                    select
                    fullWidth
                    label="Responsible role"
                    value={field.state.value}
                    onChange={(e) => field.handleChange(e.target.value)}
                  >
                    <MenuItem value="">
                      <em>Not assigned</em>
                    </MenuItem>
                    {RESPONSIBLE_ROLES.map((role) => (
                      <MenuItem key={role.id} value={role.id}>
                        {role.label}
                      </MenuItem>
                    ))}
                    {field.state.value && !RESPONSIBLE_ROLES.some((r) => r.id === field.state.value) && (
                      <MenuItem value={field.state.value}>{field.state.value} (previously entered)</MenuItem>
                    )}
                  </TextField>
                )}
              </form.Field>
              <form.Field name="ownership.owner">
                {(field) => (
                  <TextField
                    fullWidth
                    label="Named owner"
                    value={field.state.value}
                    onChange={(e) => field.handleChange(e.target.value)}
                  />
                )}
              </form.Field>
              <form.Field name="ownership.poc">
                {(field) => (
                  <TextField
                    fullWidth
                    label="Point of contact"
                    value={field.state.value}
                    onChange={(e) => field.handleChange(e.target.value)}
                  />
                )}
              </form.Field>
            </Stack>
          </SectionCard>

          <SectionCard
            title="Dates"
            subtitle="Evidence-as-of drives the staleness warnings and the pre-ATO evidence check."
          >
            <Stack direction="row" spacing={2} sx={{ flexWrap: 'wrap', gap: 2 }}>
              {(
                [
                  ['dates.implementedOn', 'Implemented on'],
                  ['dates.evidenceAsOf', 'Evidence as of'],
                  ['dates.lastReviewedOn', 'Last reviewed'],
                  ['dates.nextReviewDue', 'Next review due'],
                ] as const
              ).map(([name, label]) => (
                <form.Field key={name} name={name}>
                  {(field) => (
                    <DatePicker
                      label={label}
                      value={isoToDate(field.state.value)}
                      onChange={(value) => field.handleChange(value?.isValid ? value.toISODate() : null)}
                      minDate={minEvidenceDate}
                      slotProps={{ textField: { size: 'small', sx: { minWidth: 180 } }, field: { clearable: true } }}
                    />
                  )}
                </form.Field>
              ))}
            </Stack>
          </SectionCard>

          <SectionCard title="Finding / POA&amp;M">
            <form.Field name="poam.hasFinding">
              {(field) => (
                <FormControlLabel
                  control={
                    <Switch
                      checked={field.state.value}
                      onChange={(e) => {
                        field.handleChange(e.target.checked);
                        if (!e.target.checked) {
                          form.setFieldValue('poam.findingId', '');
                          form.setFieldValue('poam.severity', '');
                          form.setFieldValue('poam.dueDate', null);
                          form.setFieldValue('poam.remediationPlan', '');
                        }
                      }}
                    />
                  }
                  label={<Typography variant="body2">This control has an open finding</Typography>}
                />
              )}
            </form.Field>

            <form.Subscribe selector={(state) => state.values.poam.hasFinding}>
              {(hasFinding) =>
                hasFinding ? (
                  <Stack spacing={2}>
                    <Stack direction="row" spacing={2}>
                      <form.Field name="poam.findingId">
                        {(field) => (
                          <TextField
                            fullWidth
                            label="Finding id"
                            value={field.state.value}
                            onChange={(e) => field.handleChange(e.target.value)}
                          />
                        )}
                      </form.Field>
                      <form.Field name="poam.severity">
                        {(field) => (
                          <TextField
                            select
                            fullWidth
                            label="Severity"
                            value={field.state.value}
                            onChange={(e) => field.handleChange(e.target.value as EvidenceRecord['poam']['severity'])}
                          >
                            {(['low', 'moderate', 'high', 'critical'] as const).map((s) => (
                              <MenuItem key={s} value={s}>
                                {s}
                              </MenuItem>
                            ))}
                          </TextField>
                        )}
                      </form.Field>
                      <form.Field name="poam.dueDate">
                        {(field) => (
                          <DatePicker
                            label="Due"
                            value={isoToDate(field.state.value)}
                            onChange={(value) => field.handleChange(value?.isValid ? value.toISODate() : null)}
                            minDate={minEvidenceDate}
                            slotProps={{ textField: { size: 'small', sx: { minWidth: 180 } } }}
                          />
                        )}
                      </form.Field>
                    </Stack>
                    <form.Field name="poam.remediationPlan">
                      {(field) => (
                        <TextField
                          fullWidth
                          multiline
                          minRows={2}
                          label="Remediation plan"
                          error={Boolean(ruleErrors['poam.remediationPlan'])}
                          helperText={ruleErrors['poam.remediationPlan']}
                          value={field.state.value}
                          onChange={(e) => field.handleChange(e.target.value)}
                        />
                      )}
                    </form.Field>
                    <form.Field name="poam.artifactIds">
                      {(field) => (
                        <PoamAttachments
                          controlId={node.id}
                          familyId={node.familyId}
                          artifactIds={field.state.value}
                          artifacts={form.state.values.artifacts}
                          currentUser={settings?.currentUser ?? ''}
                          onArtifactIdsChange={(ids) => field.handleChange(ids)}
                          onArtifactsChange={(next) => form.setFieldValue('artifacts', next)}
                        />
                      )}
                    </form.Field>
                  </Stack>
                ) : null
              }
            </form.Subscribe>
          </SectionCard>

          <SectionCard title="AI Assessment">
            <AiPanel
              evaluation={form.state.values.aiEvaluations?.[form.state.values.aiEvaluations.length - 1] ?? null}
              isEvaluating={aiEvaluate.isPending}
              onEvaluate={handleEvaluate}
              onEditPrompt={handleOpenPromptEditor}
            />
          </SectionCard>
        </Stack>
      </Box>

      <Divider />
      <Stack
        direction="row"
        spacing={2}
        sx={{ alignItems: 'center', px: 2, py: 1, bgcolor: 'background.paper', flexShrink: 0 }}
      >
        <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
          <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: scoreColour(completeness) }} />
          <Typography variant="caption">{completeness}% complete</Typography>
        </Stack>

        <Box sx={{ flexGrow: 1 }} />

        {saveEvidence.isPending ? (
          <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
            <SyncIcon fontSize="small" color="action" />
            <Typography variant="caption">Saving…</Typography>
          </Stack>
        ) : savedAt ? (
          <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
            <CloudDoneIcon fontSize="small" color="success" />
            <Typography variant="caption">Saved {DateTime.fromISO(savedAt).toFormat('HH:mm:ss')}</Typography>
          </Stack>
        ) : (
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            Autosaves as you type
          </Typography>
        )}

        <Tooltip title="Revert to last loaded state">
          <IconButton size="small" onClick={() => form.reset(baseline.current)}>
            <UndoIcon fontSize="small" />
          </IconButton>
        </Tooltip>

        <Button
          size="small"
          variant="contained"
          startIcon={<CheckCircleIcon />}
          onClick={() => {
            form.setFieldValue('implementationStatus', 'implemented');
            form.setFieldValue('dates.lastReviewedOn', DateTime.now().toISODate());
            void form.handleSubmit();
            notify(`${node.id} marked implemented`, 'success');
          }}
        >
          Mark complete
        </Button>
      </Stack>

      <Dialog open={promptDialogOpen} onClose={() => setPromptDialogOpen(false)} fullWidth maxWidth="md">
        <DialogTitle>Edit prompt for {node.id}</DialogTitle>
        <DialogContent>
          <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 1.5 }}>
            This is the fully rendered prompt for the current narrative and evidence. Edit it and evaluate to send
            your version instead of the saved template.
          </Typography>
          <TextField
            fullWidth
            multiline
            minRows={16}
            maxRows={24}
            value={promptDraft}
            onChange={(e) => setPromptDraft(e.target.value)}
            sx={{ '& textarea': { fontFamily: 'monospace', fontSize: 12 } }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPromptDialogOpen(false)}>Cancel</Button>
          <Button onClick={handleOpenPromptEditor}>Reset to template</Button>
          <Button variant="contained" startIcon={<CheckCircleIcon />} onClick={handleEvaluateWithEditedPrompt}>
            Evaluate with this prompt
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
