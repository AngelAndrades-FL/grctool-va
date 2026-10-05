import { useCallback, useState } from 'react';
import { LexicalComposer } from '@lexical/react/LexicalComposer';
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin';
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin';
import { ListPlugin } from '@lexical/react/LexicalListPlugin';
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { HeadingNode, QuoteNode } from '@lexical/rich-text';
import {
  ListItemNode,
  ListNode,
  INSERT_ORDERED_LIST_COMMAND,
  INSERT_UNORDERED_LIST_COMMAND,
  REMOVE_LIST_COMMAND,
} from '@lexical/list';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  FORMAT_TEXT_COMMAND,
  type EditorState,
} from 'lexical';
import { Box, Divider, Stack, ToggleButton, Tooltip, Typography, useTheme } from '@mui/material';
import FormatBoldIcon from '@mui/icons-material/FormatBold';
import FormatItalicIcon from '@mui/icons-material/FormatItalic';
import FormatUnderlinedIcon from '@mui/icons-material/FormatUnderlined';
import FormatListBulletedIcon from '@mui/icons-material/FormatListBulleted';
import FormatListNumberedIcon from '@mui/icons-material/FormatListNumbered';
import FormatClearIcon from '@mui/icons-material/FormatClear';
import PostAddIcon from '@mui/icons-material/PostAdd';

const EDITOR_THEME = {
  paragraph: 'lex-p',
  text: { bold: 'lex-bold', italic: 'lex-italic', underline: 'lex-underline' },
  list: { ul: 'lex-ul', ol: 'lex-ol', listitem: 'lex-li' },
};

export interface EditorTemplate {
  label: string;
  title: string;
  /** One paragraph per line; each leading two-space group becomes one indent level. */
  text: string;
}

export interface EditorAction {
  key: string;
  label: string;
  title: string;
  icon: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}

function Toolbar({ template, actions = [] }: { template?: EditorTemplate; actions?: EditorAction[] }) {
  const [editor] = useLexicalComposerContext();

  const loadTemplate = () => {
    if (!template) return;
    const hasContent = editor.getEditorState().read(() => $getRoot().getTextContent().trim().length > 0);
    if (hasContent && !window.confirm('Replace the current text with the template? Use Undo (Ctrl+Z) to revert.')) return;
    editor.update(() => {
      const root = $getRoot();
      root.clear();
      for (const line of template.text.split('\n')) {
        const indent = Math.floor((/^ */.exec(line)?.[0].length ?? 0) / 2);
        const paragraph = $createParagraphNode();
        paragraph.setIndent(indent);
        paragraph.append($createTextNode(line.trim()));
        root.append(paragraph);
      }
      root.selectEnd();
    });
    editor.focus();
  };

  const buttons = [
    { key: 'bold', icon: <FormatBoldIcon fontSize="small" />, title: 'Bold', run: () => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'bold') },
    { key: 'italic', icon: <FormatItalicIcon fontSize="small" />, title: 'Italic', run: () => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'italic') },
    { key: 'underline', icon: <FormatUnderlinedIcon fontSize="small" />, title: 'Underline', run: () => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'underline') },
    { key: 'ul', icon: <FormatListBulletedIcon fontSize="small" />, title: 'Bulleted list', run: () => editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined) },
    { key: 'ol', icon: <FormatListNumberedIcon fontSize="small" />, title: 'Numbered list', run: () => editor.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined) },
    { key: 'clear', icon: <FormatClearIcon fontSize="small" />, title: 'Remove list formatting', run: () => editor.dispatchCommand(REMOVE_LIST_COMMAND, undefined) },
  ];

  return (
    <Stack direction="row" spacing={0.25} sx={{ px: 0.5, py: 0.25, flexWrap: 'wrap' }}>
      {buttons.map((b) => (
        <Tooltip key={b.key} title={b.title}>
          <ToggleButton
            value={b.key}
            size="small"
            sx={{ border: 0, px: 0.75, py: 0.25 }}
            onMouseDown={(e) => e.preventDefault()}
            onClick={b.run}
          >
            {b.icon}
          </ToggleButton>
        </Tooltip>
      ))}
      {template && (
        <>
          <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />
          <Tooltip title={template.title}>
            <ToggleButton
              value="template"
              size="small"
              sx={{ border: 0, px: 0.75, py: 0.25, gap: 0.5, textTransform: 'none', fontSize: 12 }}
              onMouseDown={(e) => e.preventDefault()}
              onClick={loadTemplate}
            >
              <PostAddIcon fontSize="small" />
              {template.label}
            </ToggleButton>
          </Tooltip>
        </>
      )}
      {actions.map((action) => (
        <Tooltip key={action.key} title={action.title}>
          <span>
            <ToggleButton
              value={action.key}
              size="small"
              disabled={action.disabled}
              sx={{ border: 0, px: 0.75, py: 0.25, gap: 0.5, textTransform: 'none', fontSize: 12 }}
              onMouseDown={(e) => e.preventDefault()}
              onClick={action.onClick}
            >
              {action.icon}
              {action.label}
            </ToggleButton>
          </span>
        </Tooltip>
      ))}
    </Stack>
  );
}

export interface RichTextEditorProps {
  label?: string;
  /** Serialised Lexical editor state; plain text is used as a fallback seed. */
  valueJson: string | null;
  fallbackText: string;
  onChange: (json: string, text: string) => void;
  placeholder?: string;
  minHeight?: number;
  helperText?: string;
  /** Adds a toolbar button that replaces the content with this text. */
  template?: EditorTemplate;
  /** Additional toolbar buttons, shown after the template button. */
  actions?: EditorAction[];
}

/**
 * Lexical is the source of truth for narrative content. Both the serialised
 * editor state (for round-tripping formatting) and a plain-text projection (for
 * OSCAL, export and the AI assessor) are emitted on every change.
 */
export function RichTextEditor({
  label,
  valueJson,
  fallbackText,
  onChange,
  placeholder,
  minHeight = 160,
  helperText,
  template,
  actions,
}: RichTextEditorProps) {
  const theme = useTheme();
  const [words, setWords] = useState(() => (fallbackText.trim() ? fallbackText.trim().split(/\s+/).length : 0));

  const handleChange = useCallback(
    (editorState: EditorState) => {
      const text = editorState.read(() => $getRoot().getTextContent());
      setWords(text.trim() ? text.trim().split(/\s+/).length : 0);
      onChange(JSON.stringify(editorState.toJSON()), text);
    },
    [onChange],
  );

  return (
    <Box>
      {label && (
        <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 0.5 }}>
          {label}
        </Typography>
      )}
      <Box
        sx={{
          border: 1,
          borderColor: 'divider',
          borderRadius: 1,
          bgcolor: 'background.paper',
          '&:focus-within': { borderColor: 'primary.main' },
          '& .lex-editable': {
            minHeight,
            outline: 'none',
            p: 1.5,
            fontSize: 14,
            lineHeight: 1.6,
            fontFamily: theme.typography.fontFamily,
          },
          '& .lex-p': { margin: '0 0 8px' },
          '& .lex-bold': { fontWeight: 700 },
          '& .lex-italic': { fontStyle: 'italic' },
          '& .lex-underline': { textDecoration: 'underline' },
          '& .lex-ul': { margin: '0 0 8px', paddingLeft: 24, listStyleType: 'disc' },
          '& .lex-ol': { margin: '0 0 8px', paddingLeft: 24, listStyleType: 'decimal' },
          '& .lex-li': { margin: '2px 0' },
          '& .lex-placeholder': {
            position: 'absolute',
            top: 12,
            left: 12,
            color: theme.palette.text.disabled,
            pointerEvents: 'none',
            fontSize: 14,
          },
        }}
      >
        <LexicalComposer
          initialConfig={{
            namespace: label ?? 'rich-text',
            theme: EDITOR_THEME,
            nodes: [HeadingNode, QuoteNode, ListNode, ListItemNode],
            editorState: buildInitialState(valueJson, fallbackText),
            onError: (error) => console.error('Lexical error', error),
          }}
        >
          <Toolbar template={template} actions={actions} />
          <Divider />
          <Box sx={{ position: 'relative' }}>
            <RichTextPlugin
              contentEditable={
                <ContentEditable
                  className="lex-editable"
                  aria-placeholder={placeholder ?? ''}
                  placeholder={<div className="lex-placeholder">{placeholder ?? ''}</div>}
                />
              }
              ErrorBoundary={LexicalErrorBoundary}
            />
          </Box>
          <HistoryPlugin />
          <ListPlugin />
          <OnChangePlugin onChange={handleChange} ignoreSelectionChange />
        </LexicalComposer>
      </Box>
      <Stack direction="row" sx={{ justifyContent: 'space-between', mt: 0.5 }}>
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          {helperText}
        </Typography>
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          {words} words
        </Typography>
      </Stack>
    </Box>
  );
}

/**
 * Seeds the editor. Stored Lexical JSON wins; otherwise plain text from an
 * earlier save (or an OSCAL import made elsewhere) is converted to paragraphs.
 */
function buildInitialState(valueJson: string | null, fallbackText: string): string | undefined {
  if (valueJson) {
    try {
      JSON.parse(valueJson);
      return valueJson;
    } catch {
      /* fall through to plain text */
    }
  }
  if (!fallbackText.trim()) return undefined;

  const paragraphs = fallbackText.split(/\n{2,}/).map((block) => ({
    children: block
      .split('\n')
      .filter(Boolean)
      .map((line) => ({
        detail: 0,
        format: 0,
        mode: 'normal',
        style: '',
        text: line,
        type: 'text',
        version: 1,
      })),
    direction: 'ltr',
    format: '',
    indent: 0,
    type: 'paragraph',
    version: 1,
  }));

  return JSON.stringify({
    root: { children: paragraphs, direction: 'ltr', format: '', indent: 0, type: 'root', version: 1 },
  });
}

/** Serialised editor state with one paragraph per line; leading two-space groups become indent levels. */
export function linesToEditorState(text: string): string {
  const paragraphs = text.split('\n').map((line) => ({
    children: line.trim()
      ? [{ detail: 0, format: 0, mode: 'normal', style: '', text: line.trim(), type: 'text', version: 1 }]
      : [],
    direction: 'ltr',
    format: '',
    indent: Math.floor((/^ */.exec(line)?.[0].length ?? 0) / 2),
    type: 'paragraph',
    version: 1,
  }));
  return JSON.stringify({
    root: { children: paragraphs, direction: 'ltr', format: '', indent: 0, type: 'root', version: 1 },
  });
}
