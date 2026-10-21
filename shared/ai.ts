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
  AzureOverlay,
  ControlDesignation,
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
{{responsibility_context}}
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
5. Follow the responsibility context if one is given. For a hybrid control, state which parts the
   provider (Microsoft Azure, VAEC) provides, cite its authorization or CRM, and describe what this
   system provides. Cite relevant Azure Policy definitions as the enforcing mechanism or evidence
   source where they fit. Do not claim a policy is assigned unless the narrative says so;
   use a bracketed placeholder instead, and list what the author must supply in "notes".

Respond with a single JSON object and nothing else (no prose, no code fences):
{
  "revisedNarrative": "<the revised narrative; use \\n between paragraphs>",
  "notes": ["<what you changed, or what the author still needs to supply>"]
}`;

const AZURE_POLICY_PROMPT_LIMIT = 15;

function isAutomatedPolicy(effects: string): boolean {
  return effects
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .some((e) => e && e !== 'manual' && e !== 'disabled');
}

const ORIGINATION_LABEL: Record<ControlDesignation, string> = {
  common: 'Common (provided by a common control provider)',
  hybrid: 'Hybrid (shared between a provider and this system)',
  system_specific: 'System-specific (implemented by this system)',
  inherited: 'Inherited',
};

const MENTIONS_PROVIDER = /\b(azure|microsoft|vaec)\b/i;
const CITES_AUTHORIZATION = /\b(fedramp|p-?ato|ato|authori[sz]ation|authori[sz]ed|crm|customer responsibility)\b/i;
const STATES_ASSIGNED = /\b(assign(?:ed|ment)?|deploy(?:ed)?|enforc(?:ed|es)|enabled)\b/i;

/** Automated Azure policies the narrative names and says are in place. */
function assignedPolicies(narrative: string, overlay?: AzureOverlay) {
  if (!overlay || !STATES_ASSIGNED.test(narrative)) return [];
  const text = narrative.toLowerCase();
  return overlay.policies.filter((p) => isAutomatedPolicy(p.effects) && text.includes(p.name.toLowerCase()));
}

function responsibilityContext(origination?: ControlDesignation, overlay?: AzureOverlay, applied = false): string {
  if (!origination && !overlay) return '';
  const lines = ['', '## Responsibility context'];
  if (origination) lines.push(`Origination recorded by the author: ${ORIGINATION_LABEL[origination]}`);
  if (overlay) {
    const owner =
      overlay.ownership === 'shared'
        ? 'SHARED: Microsoft provides part of this control on the Azure platform and the customer provides the rest.'
        : 'CUSTOMER: the customer owns this control; Azure only offers policies that help assess it.';
    const shown = overlay.policies.slice(0, AZURE_POLICY_PROMPT_LIMIT);
    lines.push(
      `Microsoft Azure ownership: ${owner}`,
      "Source: Microsoft's Azure Policy regulatory-compliance mapping for NIST SP 800-53 Rev 5. It is guidance, not the formal FedRAMP or VAEC customer responsibility matrix (CRM).",
      applied
        ? 'The author has accepted this mapping for the control.'
        : 'The author has NOT accepted this mapping; the recorded origination takes precedence.',
      'Mapped Azure Policy definitions (effects in parentheses; "Manual" means an attestation only):',
      shown.length
        ? shown.map((p) => `- ${p.name} (${p.effects})${p.description ? `: ${p.description}` : ''}`).join('\n')
        : '(no Azure Policy definitions map to this control)',
    );
    if (overlay.policies.length > shown.length) lines.push(`(${overlay.policies.length - shown.length} more not listed)`);
  }
  if (origination === 'hybrid') {
    lines.push(
      'Rule (hybrid): a part of the control provided by Microsoft Azure, VAEC or another provider counts as met ONLY when the narrative names the provider and cites its authorization (e.g. FedRAMP P-ATO or VAEC ATO) or its CRM. A provider part the narrative does not mention is NOT met; never assume it silently. This system\'s own part must still be fully described.',
    );
  }
  if (origination === 'system_specific' && overlay?.policies.some((p) => isAutomatedPolicy(p.effects))) {
    lines.push(
      'Rule (system-specific): an Azure Policy that the narrative names AND states is assigned (ideally with its scope) is acceptable as the enforcing mechanism or evidence for the objectives it covers. A policy that is only mapped, not stated as assigned, is not evidence. Manual policies are attestations only.',
    );
  }
  return `${lines.join('\n')}\n`;
}

export function renderRevisePrompt(req: AiReviseRequest): string {
  const vars: Record<string, string> = {
    responsibility_context: responsibilityContext(req.origination, req.azureOverlay, req.azureApplied),
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
  if (req.azureOverlay) {
    const { ownership, policies } = req.azureOverlay;
    const hybrid = req.origination ? req.origination === 'hybrid' : ownership === 'shared';
    const mentionsAzure = MENTIONS_PROVIDER.test(req.narrative);
    const automated = policies.filter((p) => isAutomatedPolicy(p.effects));
    if (!req.azureApplied && req.origination) {
      notes.push(
        `Microsoft maps this control as ${ownership === 'shared' ? 'Shared' : 'Customer'}, but it is recorded as ${ORIGINATION_LABEL[req.origination]}; confirm the origination against the formal CRM.`,
      );
    }
    if (hybrid) {
      if (!mentionsAzure) {
        notes.push('This is a hybrid control but the narrative does not mention Microsoft Azure or VAEC: state what the provider provides, cite its authorization or CRM, and describe what this system provides.');
        paragraphs.push('Provider responsibility: Microsoft Azure / VAEC provides [describe the part provided by the platform] under [FedRAMP P-ATO or VAEC ATO / CRM reference]; this system provides [describe the part this system implements].');
      } else if (!CITES_AUTHORIZATION.test(req.narrative)) {
        notes.push('The narrative names the provider but does not cite its authorization or CRM; an assessor will not accept the provider part without it.');
        paragraphs.push('Provider authorization: [cite the FedRAMP P-ATO, VAEC ATO or CRM entry that covers the provider part].');
      } else {
        notes.push('Hybrid control: confirm the narrative clearly separates the provider part from what this system provides.');
      }
    } else if (ownership === 'customer') {
      notes.push('This control is the customer\'s to implement; Azure provides no part of it, so the narrative must describe this system\'s own implementation.');
    }
    if (automated.length) {
      notes.push(
        `Azure Policy can assess this control (e.g. ${automated.slice(0, 3).map((p) => p.name).join('; ')}). If assigned, name the policy and its scope as the enforcing mechanism and attach its compliance report as evidence.`,
      );
      if (!assignedPolicies(req.narrative, req.azureOverlay).length) {
        paragraphs.push(`Azure Policy: [if assigned, name the policy, e.g. "${automated[0].name}", its scope and where compliance is reviewed].`);
      }
    } else if (policies.length) {
      notes.push('Mapped Azure policies are manual attestations only; they cannot show the control operating, so describe the real mechanism and evidence.');
    }
  }
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
{{responsibility_context}}
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
   and a reference to the evidence that proves each assertion.
5. Apply any rules in the responsibility context when deciding objectives and gaps.`;

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

export const INHERITED_PROMPT_TEMPLATE = `You are a senior federal security control assessor reviewing a System Security
Plan implementation statement for a control that this system fully INHERITS from another system or provider.

## Control
{{control_id}} — {{control_name}}

## Submitted implementation narrative
"""
{{narrative}}
"""

## Your task
Check ONE thing: does the narrative declare the source of the inheritance, i.e. name the specific
system, provider or authorization (ATO / FedRAMP package) the control is inherited from?
Do not assess the control's mechanics, assessment objectives, organization-defined values,
evidence artifacts, ownership or dates; none of them apply to an inherited control.
- verdict "satisfied" with score 100 when a source is named.
- verdict "insufficient_detail" with score 0 when no source is named; say in "gaps" that the source must be named.
- Optionally note in "gaps" if the narrative does not say whether the control is fully inherited or hybrid.`;

export const INHERITED_RESPONSE_FORMAT = `

## Response format
Respond with a single JSON object and nothing else (no prose, no code fences):
{
  "verdict": "satisfied" | "insufficient_detail",
  "score": <0 or 100>,
  "objectives": [],
  "strengths": ["<the source that was declared>"],
  "gaps": ["<what is missing>"],
  "revisedNarrative": "<narrative naming the source, or an empty string if it already does>"
}`;

/** Heuristic: the narrative names something it is inherited from, beyond a bare placeholder. */
function declaresInheritanceSource(narrative: string): boolean {
  const withoutPlaceholders = narrative.replace(/\[[^\]]*\]/g, ' ');
  return /\b(?:inherit(?:ed|s)?|provided|supplied|leveraged)\s+(?:from|by|through)\s+\S{3,}/i.test(withoutPlaceholders);
}

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
  if (req.inherited) template = INHERITED_PROMPT_TEMPLATE;
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
    responsibility_context: req.inherited ? '' : responsibilityContext(req.origination, req.azureOverlay, !!req.azureOverlay),
  };
  let rendered = template.replace(/\{\{(\w+)\}\}/g, (match, key: string) => vars[key] ?? match);
  if (req.inherited) return rendered + INHERITED_RESPONSE_FORMAT;
  // Templates saved before this placeholder existed still get the context.
  if (vars.responsibility_context && !template.includes('{{responsibility_context}}')) {
    const at = rendered.indexOf('## Response format');
    rendered = at >= 0 ? `${rendered.slice(0, at)}${vars.responsibility_context.trimStart()}\n${rendered.slice(at)}` : rendered + vars.responsibility_context;
  }
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
  if (req.inherited) {
    const named = declaresInheritanceSource(narrative);
    const response: AssessmentResponse = {
      verdict: named ? 'satisfied' : 'insufficient_detail',
      score: named ? 100 : 0,
      objectives: [],
      strengths: named ? ['The narrative declares the source of the inherited control.'] : [],
      gaps: named ? [] : ['The narrative does not name the system, provider or authorization this control is inherited from.'],
      revisedNarrative: '',
    };
    return evaluationFromResponse(req, req.promptOverride ?? renderPrompt(template, req), JSON.stringify(response, null, 2), promptVersion);
  }
  const words = narrative ? narrative.split(/\s+/).length : 0;
  const narrativeKeywords = keywords(narrative);
  const renderedPrompt = req.promptOverride ?? renderPrompt(template, req);
  const policiesInPlace = req.origination === 'system_specific' ? assignedPolicies(narrative, req.azureOverlay) : [];

  const objectiveCoverage: ObjectiveCoverage[] = req.assessmentObjectives.map((objective, index) => {
    const needed = [...keywords(objective)];
    const matched = needed.filter((k) => narrativeKeywords.has(k));
    const ratio = needed.length === 0 ? 0 : matched.length / needed.length;
    const viaPolicy =
      words >= 25 && ratio < 0.34
        ? policiesInPlace.find((p) => {
            const policyKeywords = keywords(`${p.name} ${p.description}`);
            return needed.length > 0 && needed.filter((k) => policyKeywords.has(k) || narrativeKeywords.has(k)).length / needed.length >= 0.34;
          })
        : undefined;
    const covered = (words >= 25 && ratio >= 0.34) || !!viaPolicy;
    const authorNote = req.objectiveResponses?.[index]?.note.trim();
    const answer = viaPolicy
      ? `Met. The narrative states that Azure Policy "${viaPolicy.name}" is assigned, which serves as the mechanism or evidence for this objective.`
      : covered
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

  const responsibilityGaps: string[] = [];
  const hybridProviderCited = MENTIONS_PROVIDER.test(narrative) && CITES_AUTHORIZATION.test(narrative);
  if (req.origination === 'hybrid' && req.azureOverlay) {
    if (!MENTIONS_PROVIDER.test(narrative))
      responsibilityGaps.push('Hybrid control: the narrative never mentions Microsoft Azure or VAEC, so the provider part is unaccounted for.');
    else if (!CITES_AUTHORIZATION.test(narrative))
      responsibilityGaps.push('Hybrid control: the narrative names the provider but does not cite its authorization (FedRAMP P-ATO, VAEC ATO) or CRM.');
  }

  const score = Math.round(
    objectiveScore * 0.35 + specificityScore * 0.2 + evidenceScore * 0.2 + odpScore * 0.15 + lengthScore * 0.1,
  ) - responsibilityGaps.length * 15;

  const gaps: string[] = [...responsibilityGaps];
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
  if (req.origination === 'hybrid' && req.azureOverlay && hybridProviderCited)
    strengths.push('The narrative names the provider and cites its authorization for the provider part.');
  for (const p of policiesInPlace) strengths.push(`The narrative names assigned Azure Policy "${p.name}" as a mechanism.`);
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
    responsibilityGaps.length
      ? 'Provider responsibility: Microsoft Azure / VAEC provides [describe the provider part] under [FedRAMP P-ATO or VAEC ATO / CRM reference]; this system provides [describe this system\'s part].'
      : '',
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
