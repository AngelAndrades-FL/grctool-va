import { useEffect, useId, useRef, useState } from 'react';
import { Alert, Box, Skeleton, useTheme } from '@mui/material';
import type { Mermaid } from 'mermaid';

/** Mermaid pulls in ~2MB of layout engines, so it is only fetched when a diagram is actually shown. */
let mermaidPromise: Promise<Mermaid> | null = null;
function loadMermaid(): Promise<Mermaid> {
  mermaidPromise ??= import('mermaid').then((m) => m.default);
  return mermaidPromise;
}

/** Renders Mermaid source to inline SVG, reporting syntax errors rather than throwing. */
export function MermaidDiagram({ code, minHeight = 120 }: { code: string; minHeight?: number }) {
  const theme = useTheme();
  const reactId = useId();
  const id = `mermaid-${reactId.replace(/[:»]/g, '')}`;
  const [svg, setSvg] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const latest = useRef(0);

  useEffect(() => {
    const token = ++latest.current;
    if (!code.trim()) {
      setSvg('');
      setError(null);
      return;
    }

    setLoading(true);
    loadMermaid()
      .then((mermaid) => {
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          theme: theme.palette.mode === 'dark' ? 'dark' : 'default',
        });
        return mermaid.render(id, code);
      })
      .then((result) => {
        if (token !== latest.current) return; // a newer render superseded this one
        setSvg(result.svg);
        setError(null);
      })
      .catch((e: unknown) => {
        if (token !== latest.current) return;
        setSvg('');
        setError(e instanceof Error ? e.message : 'Diagram could not be rendered.');
      })
      .finally(() => {
        if (token === latest.current) setLoading(false);
      });
  }, [code, id, theme.palette.mode]);

  if (error) {
    return (
      <Alert severity="warning" variant="outlined" sx={{ fontSize: 12 }}>
        {error}
      </Alert>
    );
  }

  if (loading && !svg) {
    return <Skeleton variant="rounded" height={minHeight} />;
  }

  return (
    <Box
      sx={{
        minHeight,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        border: 1,
        borderColor: 'divider',
        borderRadius: 1,
        p: 1,
        overflow: 'auto',
        '& svg': { maxWidth: '100%', height: 'auto' },
      }}
      // Mermaid output is generated locally from user-authored source and rendered with securityLevel 'strict'.
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
