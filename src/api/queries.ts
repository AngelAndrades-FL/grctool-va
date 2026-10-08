import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useMemo } from 'react';
import type { AiEvaluateRequest, AppSettings, EvidenceMap, EvidenceRecord, ExportRequest } from '@shared/types';
import { api } from './client';
import { buildIndex, type CatalogIndex } from '@/domain/catalogIndex';
import { resolveSharedArtifacts } from '@/domain/sharedArtifacts';

export const queryKeys = {
  workspace: ['workspace'] as const,
  catalog: ['catalog'] as const,
  evidence: ['evidence'] as const,
  settings: ['settings'] as const,
};

/** The catalog is immutable at runtime, so it is parsed and indexed exactly once. */
export function useCatalogIndex(): UseQueryResult<CatalogIndex> {
  return useQuery({
    queryKey: queryKeys.catalog,
    queryFn: async () => buildIndex(await api.loadCatalog()),
    staleTime: Infinity,
    gcTime: Infinity,
  });
}

export function useWorkspace() {
  return useQuery({ queryKey: queryKeys.workspace, queryFn: api.getWorkspace, staleTime: Infinity });
}

export function useEvidence(): UseQueryResult<EvidenceMap> {
  return useQuery({ queryKey: queryKeys.evidence, queryFn: api.loadEvidence, staleTime: 30_000 });
}

export function useEvidenceRecord(controlId: string | undefined): EvidenceRecord | undefined {
  const { data } = useEvidence();
  return controlId ? data?.[controlId] : undefined;
}

export function useSettings(): UseQueryResult<AppSettings> {
  return useQuery({ queryKey: queryKeys.settings, queryFn: api.loadSettings, staleTime: Infinity });
}

export function useSaveSettings() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: api.saveSettings,
    onSuccess: (saved) => {
      client.setQueryData(queryKeys.settings, saved);
      void client.invalidateQueries({ queryKey: queryKeys.evidence });
    },
  });
}

/** Optimistic save so autosave never makes the form feel laggy. */
export function useSaveEvidence() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (records: EvidenceRecord[]) => api.saveEvidence(records),
    onMutate: async (records) => {
      await client.cancelQueries({ queryKey: queryKeys.evidence });
      const previous = client.getQueryData<EvidenceMap>(queryKeys.evidence);
      client.setQueryData<EvidenceMap>(queryKeys.evidence, (current) => {
        const next = { ...(current ?? {}) };
        for (const record of records) next[record.controlId] = record;
        return next;
      });
      return { previous };
    },
    onError: (_error, _records, context) => {
      if (context?.previous) client.setQueryData(queryKeys.evidence, context.previous);
    },
  });
}

export function useDeleteEvidence() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: api.deleteEvidence,
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.evidence }),
  });
}

export function useAiEvaluate() {
  return useMutation({ mutationFn: (req: AiEvaluateRequest) => api.aiEvaluate(req) });
}

export function useAiRevise() {
  return useMutation({ mutationFn: api.aiRevise });
}

export function useAiRelatedDraft() {
  return useMutation({ mutationFn: api.aiRelatedDraft });
}

export function useAiSuggestOdp() {
  return useMutation({ mutationFn: api.aiSuggestOdp });
}

export function useExportFile() {
  return useMutation({ mutationFn: (req: ExportRequest) => api.exportFile(req) });
}

export function useAddAttachments() {
  return useMutation({ mutationFn: api.addAttachments });
}

export function useRunScript() {
  return useMutation({ mutationFn: api.runScript });
}

/** Run a backup/restore action, then refetch everything it may have changed. */
export function useDataAction(action: () => Promise<{ cancelled: boolean }>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: action,
    onSuccess: (result) => {
      if (!result.cancelled) void client.invalidateQueries();
    },
  });
}

/** Everything the shell needs in one shot, with a single combined loading flag. */
export function useWorkspaceData() {
  const catalog = useCatalogIndex();
  const evidence = useEvidence();
  const settings = useSettings();

  return useMemo(
    () => ({
      index: catalog.data,
      /** Includes artifacts linked from other controls; for display and metrics only. */
      evidence: resolveSharedArtifacts(evidence.data ?? {}),
      /** What is stored; use for editing, saving and exporting the SSP. */
      rawEvidence: evidence.data ?? {},
      settings: settings.data,
      isLoading: catalog.isLoading || evidence.isLoading || settings.isLoading,
      error: catalog.error ?? evidence.error ?? settings.error,
    }),
    [catalog.data, catalog.isLoading, catalog.error, evidence.data, evidence.isLoading, evidence.error, settings.data, settings.isLoading, settings.error],
  );
}
