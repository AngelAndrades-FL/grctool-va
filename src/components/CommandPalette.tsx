import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import {
  Box,
  Chip,
  Dialog,
  InputAdornment,
  List,
  ListItemButton,
  ListItemText,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import { useAppState } from '@/state/AppState';
import { useWorkspaceData } from '@/api/queries';
import { isNodeInBaseline, searchNodes } from '@/domain/catalogIndex';

export function CommandPalette() {
  const { paletteOpen, setPaletteOpen, baseline, mode } = useAppState();
  const { index } = useWorkspaceData();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);

  useEffect(() => {
    if (paletteOpen) {
      setQuery('');
      setHighlight(0);
    }
  }, [paletteOpen]);

  const results = useMemo(() => (index ? searchNodes(index, query, 30) : []), [index, query]);

  const go = (id: string) => {
    setPaletteOpen(false);
    void navigate({ to: '/control/$controlId', params: { controlId: id } });
  };

  return (
    <Dialog
      open={paletteOpen}
      onClose={() => setPaletteOpen(false)}
      fullWidth
      maxWidth="sm"
      slotProps={{ paper: { sx: { position: 'fixed', top: 80, m: 0 } } }}
    >
      <Box sx={{ p: 1.5 }}>
        <TextField
          autoFocus
          fullWidth
          size="medium"
          placeholder="Jump to a control — id, name, or plain-English text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setHighlight(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setHighlight((h) => Math.min(h + 1, results.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setHighlight((h) => Math.max(h - 1, 0));
            } else if (e.key === 'Enter' && results[highlight]) {
              go(results[highlight].id);
            }
          }}
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              ),
            },
          }}
        />
      </Box>
      <List dense sx={{ maxHeight: 420, overflowY: 'auto', pt: 0 }}>
        {results.map((node, i) => {
          const inBaseline = isNodeInBaseline(node, baseline, mode);
          return (
            <ListItemButton key={node.id} selected={i === highlight} onClick={() => go(node.id)}>
              <ListItemText
                primary={
                  <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {node.id}
                    </Typography>
                    <Typography variant="body2" noWrap>
                      {node.name}
                    </Typography>
                    {!inBaseline && (
                      <Chip size="small" label="out of baseline" variant="outlined" sx={{ height: 18, fontSize: 10 }} />
                    )}
                  </Stack>
                }
                secondary={
                  <Typography variant="caption" noWrap sx={{ display: 'block', color: 'text.secondary' }}>
                    {node.familyName}
                    {node.plainEnglish ? ` — ${node.plainEnglish}` : ''}
                  </Typography>
                }
              />
            </ListItemButton>
          );
        })}
        {query && results.length === 0 && (
          <Box sx={{ px: 2, py: 3 }}>
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              No controls match “{query}”.
            </Typography>
          </Box>
        )}
      </List>
    </Dialog>
  );
}
