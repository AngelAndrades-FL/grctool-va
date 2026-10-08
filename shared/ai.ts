/**
 * Deterministic stand-in for an LLM assessor. Renders the (user-editable) prompt
 * template, then scores the narrative with heuristics over the control's
 * assessment objectives, required evidence types and VA ODP values.
 *
 * Swap `evaluate()` for a real model call; the request/response contract and the
 * prompt template are already in place.
 */
import type {
  AiEvaluateRequest,
  AiEvaluation,
  AiOdpSuggestions,
  AiOdpSuggestRequest,
  AiRelatedDraft,
  AiRelatedDraftRequest,
  AiReviseRequest,
  AiRevision,
  ObjectiveCoverage,
  RelatedDraftElement,
} from './types.js';

export const REVISE_PROMPT_TEMPLATE = `You are a senior federal security control assessor (NIST SP 800-53A) helping a
system owner write the System Security Plan implementation statement for one control.

## Control
{{control_id}} — {{control_name}}

### Control statement (verbatim, NIST SP 800-53 Rev 5)
{{statement_template}}

### Supplemental guidance
{{supplemental_guidance}}

### Control summary
{{control_statement}}

## Current implementation narrative
"""
{{narrative}}
"""

## Your task
1. Evaluate the narrative against EVERY lettered/numbered element of the control
   statement. Note which elements are addressed, which are vague, and which are missing.
2. Make sure every [Assignment: ...] and [Selection: ...] blank is answered with a
   concrete organization-defined value; where the narrative does not supply one, leave a
   clearly bracketed placeholder for the author to fill in. Never invent values.
3. Use the supplemental guidance to judge what an assessor will expect to see.
4. Return a revised narrative organized by control element, written in present tense,
   naming the responsible role, the mechanism or tool, the frequency, and the evidence
   that proves each statement. Keep every accurate detail from the original narrative.

Respond with a single JSON object and nothing else (no prose, no code fences):
{
  "revisedNarrative": "<the revised narrative; use \\n between paragraphs>",
  "notes": ["<what you changed, or what the author still needs to supply>"]
}`;

export function renderRevisePrompt(req: AiReviseRequest): string {
  const vars: Record<string, string> = {
    control_id: req.controlId,
    control_name: req.controlName,
    statement_template: req.statementTemplate || req.controlStatement || '(none)',
    supplemental_guidance: req.supplementalGuidance || '(none)',
    control_statement: req.controlStatement || '(none)',
    narrative: req.narrative.trim() || '(empty)',
  };
  return REVISE_PROMPT_TEMPLATE.replace(/\{\{(\w+)\}\}/g, (match, key: string) => vars[key] ?? match);
}

/**
 * Deterministic stand-in for a model revision: maps the narrative's sentences onto the
 * control statement's elements and leaves bracketed placeholders for anything missing.
 */
export function revise(req: AiReviseRequest): AiRevision {
  const renderedPrompt = renderRevisePrompt(req);
  const sentences = req.narrative
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const used = new Set<number>();
  const notes: string[] = [];

  const elements = (req.statementTemplate || req.controlStatement)
    .split('\n')
    .map((line) => /^(\s*)(\S+\.)\s+(.*)$/.exec(line) ?? [line, '', '', line.trim()])
    .filter((m) => m[3]);

  const blankText = (text: string) =>
    text.replace(/\[(Assignment|Selection)[^:]*:\s*([^\]]+)\]/g, (_m, _kind, what: string) => `[specify ${what.trim()}]`);

  const paragraphs = elements.map((m) => {
    const [, indent, label, text] = m;
    const needed = [...keywords(text)];
    const matched = sentences
      .map((s, i) => ({ i, score: needed.filter((k) => keywords(s).has(k)).length }))
      .filter((x) => x.score >= Math.max(1, Math.ceil(needed.length * 0.25)) && !used.has(x.i))
      .sort((a, b) => b.score - a.score)
      .slice(0, 2);
    matched.forEach((x) => used.add(x.i));

    const heading = label ? `${indent}${label} ` : '';
    if (matched.length) {
      const body = matched.sort((a, b) => a.i - b.i).map((x) => sentences[x.i]).join(' ');
      const blanks = text.match(/\[(Assignment|Selection)[^\]]*\]/g) ?? [];
      if (blanks.length && !/\d/.test(body)) {
        notes.push(`${label || 'Statement'} is addressed but does not state the organization-defined value(s): ${blanks.join('; ')}.`);
      }
      return `${heading}${body}`;
    }
    notes.push(`${label || 'Statement'} is not addressed in the current narrative.`);
    return `${heading}[Describe how the system meets: "${blankText(text)}" — name the responsible role, the mechanism or tool, and the evidence.]`;
  });

  const leftovers = sentences.filter((_s, i) => !used.has(i));
  if (leftovers.length) {
    paragraphs.push(`Additional implementation detail: ${leftovers.join(' ')}`);
    notes.push('Sentences that did not map to a specific control element were kept under "Additional implementation detail".');
  }
  if (!sentences.length) notes.unshift('The narrative was empty, so the revision is an outline built from the control statement.');
  if (req.supplementalGuidance) {
    notes.push('Review the supplemental guidance for the account types, roles and conditions an assessor will expect to see named.');
  }

  return { revisedNarrative: paragraphs.join('\n'), notes, renderedPrompt };
}

export const DEFAULT_PROMPT_TEMPLATE = `You are a senior federal security control assessor (NIST SP 800-53A) reviewing a
System Security Plan implementation statement. You have assessed hundreds of FISMA
packages and you are rigorous but constructive.

## Control under assessment
{{control_id}} — {{control_name}}

### Control statement
{{control_statement}}

### Discussion
{{discussion}}

### Assessment objectives (800-53A determination statements, with the author's self-assessment)
{{assessment_objectives}}

### Organization-defined parameter values that MUST be reflected
{{va_odp_values}}

### Agency-specific requirements
{{va_specific_requirements}}

### Evidence types required for this control
{{required_evidence_types}}

### Evidence artifacts currently attached
{{provided_evidence_types}}

## Submitted implementation narrative
"""
{{narrative}}
"""

## Your task
1. Answer EVERY assessment objective as an assessor would: decide whether it is met,
   and reply to its determination question in one to three sentences that cite what in
   the narrative or evidence supports the decision (or what is missing). Treat the
   author's self-assessment and notes as claims to verify, not as proof.
2. Identify concrete gaps: missing ODP values, missing "who/what/when/how often",
   unsupported assertions, and required evidence types with no matching artifact.
3. Call out genuine strengths so the author knows what to keep.
4. Rewrite the narrative as an experienced assessor would expect to read it —
   present tense, specific actors and systems, explicit frequencies and thresholds,
   and a reference to the evidence that proves each assertion.`;

/**
 * Appended to every rendered assessment prompt (including user-edited templates) so the
 * reply can be parsed and written back to the control's assessment objectives.
 */
export const ASSESSMENT_RESPONSE_FORMAT = `

## Response format
Respond with a single JSON object and nothing else (no prose, no code fences):
{
  "verdict": "satisfied" | "other_than_satisfied" | "insufficient_detail",
  "score": <integer 0-100, your confidence that the control would be assessed as satisfied>,
  "objectives": [
    { "index": <objective number as listed above>, "met": true | false, "response": "<answer to the determination question>" }
  ],
  "strengths": ["<strength>"],
  "gaps": ["<gap>"],
  "revisedNarrative": "<rewritten implementation narrative>"
}
Include exactly one entry in "objectives" for every assessment objective listed above.`;

export interface AssessmentResponse {
  verdict: AiEvaluation['verdict'];
  score: number;
  objectives: Array<{ index: number; met: boolean; response: string }>;
  strengths: string[];
  gaps: string[];
  revisedNarrative: string;
}

const VERDICTS: AiEvaluation['verdict'][] = ['satisfied', 'other_than_satisfied', 'insufficient_detail'];

/**
 * Validates a model's JSON reply and maps it onto the control's objectives. Objectives the
 * model skipped come back as not met so nothing is silently marked satisfied.
 */
export function parseAssessmentResponse(
  raw: string,
  objectives: string[],
): Pick<AiEvaluation, 'verdict' | 'score' | 'objectiveCoverage' | 'strengths' | 'gaps' | 'suggestedRewrite'> {
  const json = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  let data: Partial<AssessmentResponse>;
  try {
    data = JSON.parse(json) as Partial<AssessmentResponse>;
  } catch {
    throw new Error('The AI response was not valid JSON.');
  }
  if (!data || typeof data !== 'object' || !Array.isArray(data.objectives)) {
    throw new Error('The AI response did not include an "objectives" list.');
  }

  const byIndex = new Map<number, { met: boolean; response: string }>();
  for (const o of data.objectives) {
    if (typeof o?.index === 'number' && typeof o.met === 'boolean') {
      byIndex.set(o.index, { met: o.met, response: String(o.response ?? '').trim() });
    }
  }
  const strings = (v: unknown) => (Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : []);

  return {
    verdict: VERDICTS.includes(data.verdict as AiEvaluation['verdict']) ? (data.verdict as AiEvaluation['verdict']) : 'other_than_satisfied',
    score: Math.max(0, Math.min(100, Math.round(Number(data.score) || 0))),
    objectiveCoverage: objectives.map((objective, i) => {
      const answer = byIndex.get(i + 1);
      return {
        objectiveIndex: i,
        objective,
        covered: answer?.met ?? false,
        rationale: answer?.response || 'The AI response did not address this objective.',
      };
    }),
    strengths: strings(data.strengths),
    gaps: strings(data.gaps),
    suggestedRewrite: typeof data.revisedNarrative === 'string' ? data.revisedNarrative : '',
  };
}

export function renderPrompt(template: string, req: AiEvaluateRequest): string {
  const vars: Record<string, string> = {
    control_id: req.controlId,
    control_name: req.controlName,
    control_statement: req.controlStatement || '(none)',
    discussion: req.discussion || '(none)',
    assessment_objectives: req.assessmentObjectives.length
      ? req.assessmentObjectives
          .map((o, i) => {
            const answer = req.objectiveResponses?.[i];
            const mark = answer?.met === true ? 'met' : answer?.met === false ? 'not met' : 'not yet assessed';
            const note = answer?.note.trim() ? `; note: ${answer.note.trim()}` : '';
            return `${i + 1}. ${o}\n   (author: ${mark}${note})`;
          })
          .join('\n')
      : '(none published for this control)',
    va_odp_values: req.vaOdpValues.length
      ? req.vaOdpValues.map((v) => `- ${v.parameter}: ${v.value}`).join('\n')
      : '(none)',
    va_specific_requirements: req.vaSpecificRequirements.length
      ? req.vaSpecificRequirements.map((v) => `- ${v}`).join('\n')
      : '(none)',
    required_evidence_types: req.requiredEvidenceTypes.length
      ? req.requiredEvidenceTypes.map((v) => `- ${v}`).join('\n')
      : '(none)',
    provided_evidence_types: req.providedEvidenceTypes.length
      ? req.providedEvidenceTypes.map((v) => `- ${v}`).join('\n')
      : '(no artifacts attached)',
    narrative: req.narrative || '(empty)',
  };
  const rendered = template.replace(/\{\{(\w+)\}\}/g, (match, key: string) => vars[key] ?? match);
  return rendered.includes('## Response format') ? rendered : rendered + ASSESSMENT_RESPONSE_FORMAT;
}

const STOP_WORDS = new Set([
  'determine','if','the','a','an','and','or','are','is','of','to','for','in','on','by','with','that','this',
  'be','been','system','organization','organizational','defined','whether','each','from','their','such',
]);

function keywords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 3 && !STOP_WORDS.has(w)),
  );
}

function hash(input: string): string {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** Narratives that merely restate the control statement score poorly. */
function specificitySignals(text: string): { hits: string[]; misses: string[] } {
  const hits: string[] = [];
  const misses: string[] = [];
  const checks: Array<[RegExp, string, string]> = [
    [
      /\b(daily|weekly|monthly|quarterly|semi-?annual|annually|every \d+|within \d+\s*(hour|day|minute))/i,
      'states an explicit frequency or timeline',
      'no explicit frequency or timeline is stated',
    ],
    [
      /\b(ISO|ISSO|CIO|system administrator|administrator|owner|officer|team|help desk|analyst)\b/i,
      'names the responsible role',
      'no responsible role is named',
    ],
    [
      /\b(configured|enforced|automatically|script|group policy|GPO|SCCM|Active Directory|SIEM|MDM|tool|agent)\b/i,
      'identifies the enforcing mechanism or tooling',
      'the enforcing mechanism or tool is not identified',
    ],
    [
      /\b(evidence|screenshot|report|log|export|ticket|record|artifact|attachment)\b/i,
      'points to supporting evidence',
      'does not point to any supporting evidence',
    ],
    [/\d/, 'includes concrete numeric values', 'contains no concrete numeric values (thresholds, counts, days)'],
  ];
  for (const [re, hit, miss] of checks) {
    if (re.test(text)) hits.push(hit);
    else misses.push(miss);
  }
  return { hits, misses };
}

export function evaluate(req: AiEvaluateRequest, template: string, promptVersion: number): AiEvaluation {
  const narrative = req.narrative.trim();
  const words = narrative ? narrative.split(/\s+/).length : 0;
  const narrativeKeywords = keywords(narrative);
  const renderedPrompt = req.promptOverride ?? renderPrompt(template, req);

  const objectiveCoverage: ObjectiveCoverage[] = req.assessmentObjectives.map((objective, index) => {
    const needed = [...keywords(objective)];
    const matched = needed.filter((k) => narrativeKeywords.has(k));
    const ratio = needed.length === 0 ? 0 : matched.length / needed.length;
    const covered = words >= 25 && ratio >= 0.34;
    const authorNote = req.objectiveResponses?.[index]?.note.trim();
    const answer = covered
      ? `Met. The narrative addresses this objective (${matched.length}/${needed.length} key concepts present: ${matched.slice(0, 5).join(', ')}).`
      : needed.length === 0
        ? 'Not met. The objective could not be matched to the narrative automatically; review it manually.'
        : `Not met. The narrative does not demonstrate this — only ${matched.length}/${needed.length} key concepts appear. Missing: ${needed
            .filter((k) => !narrativeKeywords.has(k))
            .slice(0, 6)
            .join(', ')}.`;
    return {
      objectiveIndex: index,
      objective,
      covered,
      rationale: authorNote ? `${answer} Evidence noted by the author: ${authorNote}` : answer,
    };
  });

  const { hits, misses } = specificitySignals(narrative);

  const missingEvidence = req.requiredEvidenceTypes.filter(
    (t) => !req.providedEvidenceTypes.some((p) => p.toLowerCase() === t.toLowerCase()),
  );
  const missingOdp = req.vaOdpValues.filter((v) => {
    const tokens = [...keywords(v.value)].slice(0, 4);
    return tokens.length > 0 && !tokens.some((t) => narrativeKeywords.has(t));
  });

  const coveredCount = objectiveCoverage.filter((o) => o.covered).length;
  const objectiveScore =
    objectiveCoverage.length === 0 ? (words >= 40 ? 60 : 20) : (coveredCount / objectiveCoverage.length) * 100;
  const lengthScore = Math.min(100, (words / 120) * 100);
  const specificityScore = (hits.length / 5) * 100;
  const evidenceScore =
    req.requiredEvidenceTypes.length === 0
      ? 100
      : ((req.requiredEvidenceTypes.length - missingEvidence.length) / req.requiredEvidenceTypes.length) * 100;
  const odpScore =
    req.vaOdpValues.length === 0 ? 100 : ((req.vaOdpValues.length - missingOdp.length) / req.vaOdpValues.length) * 100;

  const score = Math.round(
    objectiveScore * 0.35 + specificityScore * 0.2 + evidenceScore * 0.2 + odpScore * 0.15 + lengthScore * 0.1,
  );

  const gaps: string[] = [];
  if (words === 0) gaps.push('No implementation narrative has been written.');
  else if (words < 40) gaps.push(`Narrative is only ${words} words — too thin to demonstrate implementation.`);
  for (const o of objectiveCoverage.filter((x) => !x.covered))
    gaps.push(`Assessment objective not demonstrably addressed: "${o.objective}"`);
  for (const m of misses) gaps.push(`The narrative ${m}.`);
  for (const t of missingEvidence) gaps.push(`Required evidence type "${t}" has no attached artifact.`);
  for (const v of missingOdp)
    gaps.push(`Organization-defined value for "${v.parameter}" (${v.value}) is not reflected in the narrative.`);

  const strengths: string[] = [];
  for (const h of hits) strengths.push(`The narrative ${h}.`);
  if (coveredCount > 0) strengths.push(`${coveredCount} of ${objectiveCoverage.length} assessment objectives are addressed.`);
  if (req.providedEvidenceTypes.length > 0)
    strengths.push(`${req.providedEvidenceTypes.length} evidence artifact(s) are attached and mapped.`);
  if (strengths.length === 0) strengths.push('No strengths identified yet — start with who performs the control, how, and how often.');

  const verdict: AiEvaluation['verdict'] =
    words < 40 ? 'insufficient_detail' : score >= 75 ? 'satisfied' : 'other_than_satisfied';

  const roleHint = /\b(ISO|ISSO|CIO|administrator|owner)\b/i.exec(narrative)?.[0] ?? '[responsible role]';
  const freqHint =
    req.vaOdpValues.find((v) => /frequen|period|day|annual|quarter/i.test(v.parameter))?.value ?? '[defined frequency]';

  const suggestedRewrite = [
    `${req.controlName} is implemented for this system as follows.`,
    narrative
      ? `${narrative.replace(/\s+/g, ' ').trim()}`
      : `[Describe the control as currently operating — do not restate the control statement.]`,
    ``,
    `Responsibility: ${roleHint} performs and maintains this control.`,
    `Frequency: ${freqHint}.`,
    req.vaOdpValues.length
      ? `Organization-defined values applied: ${req.vaOdpValues.map((v) => `${v.parameter} = ${v.value}`).join('; ')}.`
      : '',
    req.requiredEvidenceTypes.length
      ? `Evidence: ${req.requiredEvidenceTypes.map((t) => `${t}${missingEvidence.includes(t) ? ' (NOT YET ATTACHED)' : ' (attached)'}`).join('; ')}.`
      : '',
    missingOdp.length
      ? `Still to address: ${missingOdp.map((v) => v.parameter).join(', ')}.`
      : '',
  ]
    .filter(Boolean)
    .join('\n');

  // Emit the reply in the same JSON contract a real model must follow, then parse it back.
  const response: AssessmentResponse = {
    verdict,
    score: Math.max(0, Math.min(100, score)),
    objectives: objectiveCoverage.map((o, i) => ({ index: i + 1, met: o.covered, response: o.rationale })),
    strengths,
    gaps,
    revisedNarrative: suggestedRewrite,
  };
  return evaluationFromResponse(req, renderedPrompt, JSON.stringify(response, null, 2), promptVersion);
}

/** Turns a model's JSON reply into a stored evaluation. Throws when the reply cannot be parsed. */
export function evaluationFromResponse(
  req: AiEvaluateRequest,
  renderedPrompt: string,
  rawResponse: string,
  promptVersion: number,
): AiEvaluation {
  return {
    id: globalThis.crypto.randomUUID(),
    at: new Date().toISOString(),
    promptVersion,
    inputHash: hash(`${req.controlId}|${req.narrative.trim()}|${renderedPrompt.length}`),
    ...parseAssessmentResponse(rawResponse, req.assessmentObjectives),
    renderedPrompt,
    rawResponse,
  };
}

/** Parses a model's JSON revision reply. */
export function parseRevisionResponse(raw: string): Pick<AiRevision, 'revisedNarrative' | 'notes'> {
  const json = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  let data: { revisedNarrative?: unknown; notes?: unknown };
  try {
    data = JSON.parse(json) as typeof data;
  } catch {
    throw new Error('The AI response was not valid JSON.');
  }
  if (typeof data?.revisedNarrative !== 'string' || !data.revisedNarrative.trim()) {
    throw new Error('The AI response did not include a revised narrative.');
  }
  return {
    revisedNarrative: data.revisedNarrative.trim(),
    notes: Array.isArray(data.notes) ? data.notes.filter((n): n is string => typeof n === 'string') : [],
  };
}

/* ------------------------------------------------- related-controls draft */

export const DEFAULT_RELATED_NARRATIVE_MAX_CHARS = 12000;

export const RELATED_DRAFT_PROMPT_TEMPLATE = `You are a senior federal security control assessor (NIST SP 800-53A) helping a
system owner draft part of the System Security Plan implementation statement for ONE target control,
using implementation narratives already written for related controls.

## Target control
{{control_id}} — {{control_name}}

### Control statement (verbatim, NIST SP 800-53 Rev 5)
{{statement_template}}

### Supplemental guidance
{{supplemental_guidance}}

## Target control's current narrative (may be empty)
"""
{{current_narrative}}
"""

## Implementation narratives of related controls
{{related_narratives}}

## Your task
1. Work element by element through the target control statement (each lettered/numbered item).
2. For each element, decide whether any related narrative describes a mechanism, role, tool,
   process, frequency or artifact that genuinely helps satisfy THAT element. Ignore content that is
   only topically similar but does not meet the element's requirement.
3. Where it does, write a short, targeted implementation statement for the TARGET control that
   explains how that existing implementation satisfies the element. Write in present tense, name
   the responsible role and the mechanism, and reference the related control id (e.g. "as described
   in AC-2"). Do NOT summarize the related narratives; only carry over facts that answer the element.
4. Answer [Assignment: ...] / [Selection: ...] blanks only with values stated in the related
   narratives; otherwise leave a bracketed placeholder. Never invent values.
5. Skip elements the related narratives do not support and list them under "gaps".
6. Do not repeat what the target control's current narrative already says.

Respond with a single JSON object and nothing else (no prose, no code fences):
{
  "elements": [
    {
      "element": "<the statement element, quoted verbatim including its label, e.g. a.1.>",
      "draft": "<targeted implementation text for this element>",
      "sources": ["<related control id>"]
    }
  ],
  "gaps": ["<statement element not supported by the related narratives>"]
}`;

export function renderRelatedDraftPrompt(req: AiRelatedDraftRequest): string {
  const maxChars = req.maxNarrativeChars && req.maxNarrativeChars > 0 ? req.maxNarrativeChars : DEFAULT_RELATED_NARRATIVE_MAX_CHARS;
  const related = req.related
    .filter((r) => r.narrative.trim())
    .map((r) => {
      const text = r.narrative.trim();
      const clipped = text.length > maxChars ? `${text.slice(0, maxChars)}…` : text;
      return `### ${r.controlId} — ${r.controlName}\n"""\n${clipped}\n"""`;
    })
    .join('\n\n');
  const vars: Record<string, string> = {
    control_id: req.controlId,
    control_name: req.controlName,
    statement_template: req.statementTemplate || req.controlStatement || '(none)',
    supplemental_guidance: req.supplementalGuidance || '(none)',
    current_narrative: req.currentNarrative.trim() || '(empty)',
    related_narratives: related || '(none)',
  };
  return RELATED_DRAFT_PROMPT_TEMPLATE.replace(/\{\{(\w+)\}\}/g, (match, key: string) => vars[key] ?? match);
}

export function parseRelatedDraftResponse(raw: string): Pick<AiRelatedDraft, 'elements' | 'gaps'> {
  const json = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  let data: { elements?: unknown; gaps?: unknown };
  try {
    data = JSON.parse(json) as typeof data;
  } catch {
    throw new Error('The AI response was not valid JSON.');
  }
  if (!Array.isArray(data?.elements)) throw new Error('The AI response did not include any drafted elements.');
  const elements = data.elements
    .map((e): RelatedDraftElement | null => {
      const item = e as { element?: unknown; draft?: unknown; sources?: unknown };
      if (typeof item?.draft !== 'string' || !item.draft.trim()) return null;
      return {
        element: typeof item.element === 'string' ? item.element.trim() : '',
        draft: item.draft.trim(),
        sources: Array.isArray(item.sources) ? item.sources.filter((s): s is string => typeof s === 'string') : [],
      };
    })
    .filter((e): e is RelatedDraftElement => e !== null);
  return {
    elements,
    gaps: Array.isArray(data.gaps) ? data.gaps.filter((g): g is string => typeof g === 'string') : [],
  };
}

/** Deterministic stand-in: matches related-narrative sentences to each statement element by keyword overlap. */
export function draftFromRelated(req: AiRelatedDraftRequest): AiRelatedDraft {
  const renderedPrompt = renderRelatedDraftPrompt(req);
  const sentences = req.related.flatMap((r) =>
    r.narrative
      .replace(/\s+/g, ' ')
      .split(/(?<=[.!?])\s+/)
      .map((text) => text.trim())
      .filter(Boolean)
      .map((text) => ({ controlId: r.controlId, text, words: keywords(text) })),
  );

  const elements: RelatedDraftElement[] = [];
  const gaps: string[] = [];
  for (const line of (req.statementTemplate || req.controlStatement).split('\n')) {
    const element = line.trim();
    if (!element) continue;
    const needed = [...keywords(element)];
    if (!needed.length) continue;
    const matched = sentences
      .map((s) => ({ s, score: needed.filter((k) => s.words.has(k)).length }))
      .filter((x) => x.score >= Math.max(2, Math.ceil(needed.length * 0.3)))
      .sort((a, b) => b.score - a.score)
      .slice(0, 2);
    if (!matched.length) {
      gaps.push(element);
      continue;
    }
    const sources = [...new Set(matched.map((m) => m.s.controlId))];
    elements.push({
      element,
      draft: matched.map((m) => `${m.s.text} (as described in ${m.s.controlId})`).join(' '),
      sources,
    });
  }
  return { elements, gaps, renderedPrompt };
}

/** Plain-text rendering of a draft, one block per statement element, for copying into the narrative. */
export function formatRelatedDraft(draft: Pick<AiRelatedDraft, 'elements'>): string {
  return draft.elements
    .map((e) =>
      [
        e.element ? `Addresses: ${e.element}` : '',
        e.draft,
        e.sources.length ? `Related controls: ${e.sources.join(', ')}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
    )
    .join('\n\n');
}

/* ------------------------------------------------ organization-defined values */

export const ODP_SUGGEST_PROMPT_TEMPLATE = `You are a senior federal security control assessor (NIST SP 800-53A) helping a
system owner fill in the organization-defined parameter values of ONE control, using only information
the owner has already recorded for that control.

## Control
{{control_id}} — {{control_name}}

### Control statement (verbatim, NIST SP 800-53 Rev 5)
{{statement_template}}

## Information recorded for this control
### Implementation narrative
"""
{{narrative}}
"""

### Ownership
{{ownership}}

### Evidence artifacts
{{artifacts}}

## Values to fill
{{parameters}}

## Your task
1. For each value above, look for an answer stated explicitly in the information recorded for this
   control (narrative, ownership, artifacts). Match by meaning, not by wording.
2. Suggest a value only when the recorded information states it. Quote or closely paraphrase it and keep
   it short enough to drop into a form field (a role, a number of days, a frequency, a list of events).
3. Never invent, assume or generalize. If a value is not stated, leave it out of the response.
4. For each suggestion give "basis": a few words saying where it came from (e.g. "narrative, element b").

Respond with a single JSON object and nothing else (no prose, no code fences):
{
  "suggestions": [
    { "parameterId": "<id from the list above>", "value": "<value>", "basis": "<where it was found>" }
  ]
}`;

export function renderOdpSuggestPrompt(req: AiOdpSuggestRequest): string {
  const vars: Record<string, string> = {
    control_id: req.controlId,
    control_name: req.controlName,
    statement_template: req.statementTemplate || '(none)',
    narrative: req.narrative.trim() || '(empty)',
    ownership:
      [req.responsibleRole && `Responsible role: ${req.responsibleRole}`, req.owner && `Owner: ${req.owner}`]
        .filter(Boolean)
        .join('\n') || '(none)',
    artifacts: req.artifacts.length
      ? req.artifacts
          .map((a) => `- ${a.title || a.evidenceType} (${a.evidenceType})${a.frequency ? `, recurs ${a.frequency}` : ''}`)
          .join('\n')
      : '(none)',
    parameters: req.parameters.map((p) => `- ${p.parameterId}: ${p.label}`).join('\n'),
  };
  return ODP_SUGGEST_PROMPT_TEMPLATE.replace(/\{\{(\w+)\}\}/g, (match, key: string) => vars[key] ?? match);
}

export function parseOdpSuggestResponse(raw: string, req: Pick<AiOdpSuggestRequest, 'parameters'>): AiOdpSuggestions {
  const json = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  let data: { suggestions?: unknown };
  try {
    data = JSON.parse(json) as typeof data;
  } catch {
    throw new Error('The AI response was not valid JSON.');
  }
  if (!Array.isArray(data?.suggestions)) throw new Error('The AI response did not include a suggestions list.');
  const known = new Set(req.parameters.map((p) => p.parameterId));
  const seen = new Set<string>();
  const suggestions = data.suggestions.flatMap((s) => {
    const item = s as { parameterId?: unknown; value?: unknown; basis?: unknown };
    if (typeof item?.parameterId !== 'string' || !known.has(item.parameterId) || seen.has(item.parameterId)) return [];
    if (typeof item.value !== 'string' || !item.value.trim()) return [];
    seen.add(item.parameterId);
    return [
      {
        parameterId: item.parameterId,
        value: item.value.trim(),
        basis: typeof item.basis === 'string' ? item.basis.trim() : '',
      },
    ];
  });
  return { suggestions };
}
