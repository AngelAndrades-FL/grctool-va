import { useEffect, useState } from 'react';
import {
  Alert,
  AlertTitle,
  Box,
  Button,
  Chip,
  CircularProgress,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import NetworkCheckIcon from '@mui/icons-material/NetworkCheck';
import LoginIcon from '@mui/icons-material/Login';
import KeyIcon from '@mui/icons-material/Key';
import type { AiConnectionTestResult, AiSettings } from '@shared/types';
import { api } from '@/api/client';

export interface AiSettingsSectionProps {
  value: AiSettings;
  onChange: (value: AiSettings) => void;
}

/** AI provider connection parameters (Azure OpenAI with Entra sign-in, or OpenAI via TanStack AI) and a live connection test. */
export function AiSettingsSection({ value, onChange }: AiSettingsSectionProps) {
  const patch = (update: Partial<AiSettings>) => onChange({ ...value, ...update });
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<AiConnectionTestResult | null>(null);
  const [account, setAccount] = useState<string | null>(null);
  const [signingIn, setSigningIn] = useState(false);
  const [signInError, setSignInError] = useState<string | null>(null);

  const azure = value.provider === 'azure-openai';
  const openai = value.provider === 'tanstack-openai';
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [hasApiKey, setHasApiKey] = useState(false);
  const [keyError, setKeyError] = useState<string | null>(null);

  useEffect(() => {
    if (openai) void api.aiHasApiKey().then(setHasApiKey);
  }, [openai]);

  const saveApiKey = async () => {
    setKeyError(null);
    try {
      await api.aiSetApiKey(apiKeyInput);
      setApiKeyInput('');
      setHasApiKey(true);
    } catch (err) {
      setKeyError(err instanceof Error ? err.message : String(err));
    }
  };

  const removeApiKey = async () => {
    await api.aiClearApiKey();
    setHasApiKey(false);
    setResult(null);
  };

  useEffect(() => {
    if (!azure || !value.clientId.trim()) {
      setAccount(null);
      return;
    }
    void api.aiSignedInAccount(value).then(setAccount);
  }, [azure, value.clientId, value.tenantId, value.cloud]);

  const signIn = async () => {
    setSigningIn(true);
    setSignInError(null);
    try {
      setAccount(await api.aiSignIn(value));
    } catch (err) {
      setSignInError(err instanceof Error ? err.message : String(err));
    } finally {
      setSigningIn(false);
    }
  };

  const signOut = async () => {
    await api.aiSignOut();
    setAccount(null);
    setResult(null);
  };

  /** The cloud (and so the sign-in authority) follows the endpoint host. */
  const changeEndpoint = (endpoint: string) => {
    const host = /^https?:\/\/([^/:]+)/i.exec(endpoint.trim())?.[1]?.toLowerCase() ?? '';
    patch({ endpoint, cloud: host.endsWith('.us') ? 'government' : 'commercial' });
  };

  const test = async () => {
    setTesting(true);
    setResult(null);
    try {
      setResult(await api.aiTestConnection(value));
      if (azure && value.clientId.trim()) setAccount(await api.aiSignedInAccount(value));
    } finally {
      setTesting(false);
    }
  };

  return (
    <Paper variant="outlined" sx={{ p: 3 }}>
      <Typography variant="h6" gutterBottom>
        AI connectivity
      </Typography>
      <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
        Powers the AI assessment, &ldquo;Check with AI&rdquo; and Related Controls drafting. The control text and your
        narrative are sent to {openai && value.openaiService === 'openai' ? 'OpenAI' : <>your organization&apos;s Azure OpenAI deployment</>}; use only a
        service approved for the data in this workspace.
      </Typography>

      <Stack spacing={2}>
        <TextField
          select
          size="small"
          label="Connection"
          sx={{ maxWidth: 420 }}
          value={openai && value.openaiService === 'openai' ? 'openai' : 'azure-key'}
          onChange={(e) => {
            patch({ provider: 'tanstack-openai', openaiService: e.target.value === 'azure-key' ? 'azure' : 'openai' });
            setResult(null);
          }}
        >
          <MenuItem value="azure-key">Azure OpenAI &mdash; API key</MenuItem>
          <MenuItem value="openai">OpenAI &mdash; API key</MenuItem>
        </TextField>

        {openai && (
          <>
            {value.openaiService === 'azure' ? (
              <>
                <TextField
                  size="small"
                  fullWidth
                  label="Endpoint"
                  placeholder="https://my-resource.openai.azure.us"
                  helperText="Resource or gateway base URL, without /openai/deployments/..."
                  value={value.endpoint}
                  onChange={(e) => patch({ endpoint: e.target.value })}
                />
                <Stack direction="row" spacing={2}>
                  <TextField
                    size="small"
                    fullWidth
                    label="Deployment name"
                    placeholder="e.g. gpt-4o-mini"
                    value={value.deployment}
                    onChange={(e) => patch({ deployment: e.target.value })}
                  />
                  <TextField
                    size="small"
                    label="API version"
                    sx={{ minWidth: 200 }}
                    value={value.apiVersion}
                    onChange={(e) => patch({ apiVersion: e.target.value })}
                  />
                </Stack>
              </>
            ) : (
              <TextField
                size="small"
                fullWidth
                label="Model"
                placeholder="e.g. gpt-5.2"
                value={value.openaiModel}
                onChange={(e) => patch({ openaiModel: e.target.value })}
              />
            )}

            <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
              <TextField
                size="small"
                fullWidth
                type="password"
                autoComplete="off"
                label={hasApiKey ? 'Replace API key' : 'API key'}
                placeholder={value.openaiService === 'azure' ? 'Azure OpenAI key' : 'sk-...'}
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
              />
              <Button
                size="small"
                variant="outlined"
                startIcon={<KeyIcon />}
                disabled={!apiKeyInput.trim()}
                onClick={() => void saveApiKey()}
                sx={{ flexShrink: 0 }}
              >
                Save key
              </Button>
            </Stack>
            <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
              <Chip
                size="small"
                color={hasApiKey ? 'success' : 'default'}
                label={hasApiKey ? 'API key stored (encrypted)' : 'No API key stored'}
                sx={{ height: 22, fontSize: 11 }}
              />
              {hasApiKey && (
                <Button size="small" onClick={() => void removeApiKey()}>
                  Remove key
                </Button>
              )}
            </Stack>
            {keyError && <Alert severity="error" sx={{ py: 0 }}>{keyError}</Alert>}

            {value.openaiService !== 'azure' && (
            <Stack direction="row" spacing={2}>
              <TextField
                size="small"
                fullWidth
                label="Organization ID (optional)"
                placeholder="org-..."
                value={value.openaiOrganization}
                onChange={(e) => patch({ openaiOrganization: e.target.value })}
              />
              <TextField
                size="small"
                fullWidth
                label="Base URL (optional)"
                placeholder="https://api.openai.com/v1"
                value={value.openaiBaseUrl}
                onChange={(e) => patch({ openaiBaseUrl: e.target.value })}
              />
            </Stack>
            )}
          </>
        )}

        {azure && (
          <>
            <TextField
              size="small"
              fullWidth
              label="Endpoint"
              placeholder="https://my-gateway.azure-api.us/api"
              value={value.endpoint}
              onChange={(e) => changeEndpoint(e.target.value)}
            />

            <Stack direction="row" spacing={2}>
              <TextField
                size="small"
                fullWidth
                label="Deployment name"
                placeholder="e.g. gpt-4o-mini"
                value={value.deployment}
                onChange={(e) => patch({ deployment: e.target.value })}
              />
              <TextField
                size="small"
                label="API version"
                sx={{ minWidth: 200 }}
                value={value.apiVersion}
                onChange={(e) => patch({ apiVersion: e.target.value })}
              />
            </Stack>

            <Stack direction="row" spacing={2}>
              <TextField
                size="small"
                fullWidth
                label="Tenant ID"
                value={value.tenantId}
                onChange={(e) => patch({ tenantId: e.target.value })}
              />
              <TextField
                size="small"
                fullWidth
                label="Application (client) ID"
                value={value.clientId}
                onChange={(e) => patch({ clientId: e.target.value })}
              />
            </Stack>

            <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
              <Chip
                size="small"
                color={account ? 'success' : 'default'}
                label={account ? `Signed in as ${account}` : 'Not signed in'}
                sx={{ height: 22, fontSize: 11 }}
              />
              <Button
                size="small"
                variant="outlined"
                startIcon={signingIn ? <CircularProgress size={14} /> : <LoginIcon />}
                disabled={signingIn || !value.clientId.trim()}
                onClick={() => void signIn()}
              >
                {account ? 'Switch account' : 'Sign in'}
              </Button>
              {account && (
                <Button size="small" onClick={() => void signOut()}>
                  Sign out
                </Button>
              )}
            </Stack>
            {signingIn && (
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                Complete the sign-in in your browser, then return here.
              </Typography>
            )}
            {signInError && <Alert severity="error" sx={{ py: 0 }}>{signInError}</Alert>}
          </>
        )}

        {(azure || openai) && (
          <>
            <Box>
              <Button
                variant="outlined"
                startIcon={testing ? <CircularProgress size={16} /> : <NetworkCheckIcon />}
                disabled={testing}
                onClick={() => void test()}
              >
                Test connection
              </Button>
            </Box>

            {result && (
              <Alert severity={result.ok ? 'success' : 'error'} onClose={() => setResult(null)}>
                <AlertTitle>{result.ok ? 'Connection succeeded' : 'Connection failed'}</AlertTitle>
                <Typography variant="body2" sx={{ wordBreak: 'break-word' }}>
                  {result.message}
                </Typography>
                {result.hint && (
                  <Typography variant="body2" sx={{ mt: 0.5 }}>
                    <strong>Next step:</strong> {result.hint}
                  </Typography>
                )}
                {result.ok && (
                  <Typography variant="caption" sx={{ display: 'block', mt: 0.5 }}>
                    Remember to <strong>Save settings</strong> so the AI features use this connection.
                  </Typography>
                )}
              </Alert>
            )}
          </>
        )}
      </Stack>
    </Paper>
  );
}
