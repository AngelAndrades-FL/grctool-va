import { useState } from 'react';
import { Box, Button, Paper, Stack, Typography } from '@mui/material';
import { DataGrid, GridActionsCellItem, useGridApiRef, type GridColDef } from '@mui/x-data-grid';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import type { ResponsibleRole } from '@shared/types';
import { roleIdFromLabel } from '@shared/roles';
import { useEvidence } from '@/api/queries';
import { useAppState } from '@/state/AppState';

export interface ResponsibleRolesSectionProps {
  roles: ResponsibleRole[];
  onChange: (roles: ResponsibleRole[]) => void;
}

const DRAFT_ID = '__new__';
const EMPTY_DRAFT: ResponsibleRole = { id: DRAFT_ID, label: '', name: '', email: '' };

/** Editable list of responsible roles and their default contacts; changes are saved with the rest of Settings. */
export function ResponsibleRolesSection({ roles, onChange }: ResponsibleRolesSectionProps) {
  const { data: evidence } = useEvidence();
  const { notify } = useAppState();
  const apiRef = useGridApiRef();
  /** A blank row at the top of the grid; it becomes a role once it has a name. */
  const [draft, setDraft] = useState<ResponsibleRole | null>(null);

  const labelTaken = (label: string, exceptId?: string) =>
    roles.some((r) => r.id !== exceptId && r.label.trim().toLowerCase() === label.trim().toLowerCase());

  const remove = (role: ResponsibleRole) => {
    if (role.id === DRAFT_ID) {
      setDraft(null);
      return;
    }
    const used = Object.values(evidence ?? {}).filter((r) => r.ownership.responsibleRole === role.id).length;
    const note = used
      ? ` ${used} control(s) use it and will keep the value, shown as "previously entered".`
      : '';
    if (window.confirm(`Delete the role "${role.label}"?${note}`)) onChange(roles.filter((r) => r.id !== role.id));
  };

  const startAdd = () => {
    setDraft((current) => current ?? EMPTY_DRAFT);
    apiRef.current?.setPage(0);
    setTimeout(() => apiRef.current?.startCellEditMode({ id: DRAFT_ID, field: 'label' }), 50);
  };

  const columns: GridColDef<ResponsibleRole>[] = [
    {
      field: 'label',
      headerName: 'Responsible role',
      flex: 2,
      minWidth: 260,
      editable: true,
      renderCell: ({ row, value }) =>
        row.id === DRAFT_ID && !value ? <em>New role — double-click to name it</em> : (value as string),
    },
    { field: 'name', headerName: 'Name', flex: 1.5, minWidth: 160, editable: true },
    { field: 'email', headerName: 'Email', flex: 1.5, minWidth: 200, editable: true },
    {
      field: 'actions',
      type: 'actions',
      headerName: '',
      width: 56,
      getActions: ({ row }) => [
        <GridActionsCellItem key="delete" icon={<DeleteIcon />} label="Delete role" onClick={() => remove(row)} />,
      ],
    },
  ];

  return (
    <Paper variant="outlined" sx={{ p: 3 }}>
      <Stack direction="row" sx={{ alignItems: 'flex-start', justifyContent: 'space-between' }} spacing={2}>
        <Box>
          <Typography variant="h6" gutterBottom>
            Responsible roles
          </Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
            The roles offered on each control, with a default name and email filled in when one is chosen. Double-click
            a cell to edit it. Use Add role to put a new row at the top of the grid, name it, then fill in the contact.
            The role id written to the SSP is set when a role is created and does not change if you rename it.
          </Typography>
        </Box>
        <Button variant="outlined" size="small" startIcon={<AddIcon />} onClick={startAdd} sx={{ flexShrink: 0 }}>
          Add role
        </Button>
      </Stack>

      <DataGrid<ResponsibleRole>
        apiRef={apiRef}
        rows={draft ? [draft, ...roles] : roles}
        columns={columns}
        getRowId={(r) => r.id}
        showToolbar
        density="compact"
        disableRowSelectionOnClick
        hideFooterSelectedRowCount
        processRowUpdate={(next, previous) => {
          const label = next.label.trim();
          if (next.id === DRAFT_ID) {
            if (!label) {
              setDraft(next);
              return next;
            }
            if (labelTaken(label)) throw new Error(`A role named "${label}" already exists.`);
            const id = roleIdFromLabel(label, roles.map((r) => r.id));
            onChange([{ id, label, name: next.name.trim(), email: next.email.trim() }, ...roles]);
            setDraft(null);
            return next;
          }
          if (!label) throw new Error('A role needs a name.');
          if (labelTaken(label, next.id)) throw new Error(`A role named "${label}" already exists.`);
          const updated = { ...next, label, name: next.name.trim(), email: next.email.trim() };
          onChange(roles.map((r) => (r.id === previous.id ? updated : r)));
          return updated;
        }}
        onProcessRowUpdateError={(error) => notify(error instanceof Error ? error.message : 'Could not update the role', 'error')}
        initialState={{ pagination: { paginationModel: { pageSize: 25 } } }}
        pageSizeOptions={[25, 50, 100]}
        sx={{ height: 560 }}
      />
    </Paper>
  );
}
