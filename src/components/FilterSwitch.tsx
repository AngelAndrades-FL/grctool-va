import { FormControlLabel, Stack, Switch, Tooltip, Typography } from '@mui/material';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';

export interface FilterSwitchProps {
  label: string;
  help: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}

/** A list filter toggle with the explanation of what it does attached to it. */
export function FilterSwitch({ label, help, checked, onChange }: FilterSwitchProps) {
  return (
    <FormControlLabel
      control={<Switch size="small" checked={checked} onChange={(e) => onChange(e.target.checked)} />}
      label={
        <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
          <Typography variant="caption">{label}</Typography>
          <Tooltip title={help}>
            <InfoOutlinedIcon sx={{ fontSize: 15, color: 'text.secondary' }} />
          </Tooltip>
        </Stack>
      }
    />
  );
}
