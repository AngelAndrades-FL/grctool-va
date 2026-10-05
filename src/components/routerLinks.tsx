import { createLink } from '@tanstack/react-router';
import { Button, Chip, IconButton, ListItemButton, Typography } from '@mui/material';

/** MUI components pre-wired to navigate via TanStack Router's `Link`. */
export const LinkTypography = createLink(Typography);
export const LinkButton = createLink(Button);
export const LinkIconButton = createLink(IconButton);
export const LinkChip = createLink(Chip);
export const LinkListItemButton = createLink(ListItemButton);
