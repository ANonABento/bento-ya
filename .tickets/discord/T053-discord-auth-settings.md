# T053: Discord Auth & Settings UI

## Summary

Add Discord configuration to the settings panel. User enters bot token and server ID, with validation and connection testing.

## Acceptance Criteria

- [ ] Settings panel has "Integrations" tab with Discord section
- [ ] Bot token input (password field with show/hide toggle)
- [ ] Server ID input with auto-detect option
- [ ] "Test Connection" button with feedback
- [ ] Enable/disable toggle for Discord integration
- [ ] Token stored securely (encrypted in settings)
- [ ] Connection status indicator (connected/disconnected/error)
- [ ] Error messages for invalid token/permissions

## Technical Design

### Settings Schema

```typescript
// src/types/settings.ts

interface DiscordSettings {
  enabled: boolean;
  botToken: string;        // Encrypted at rest
  guildId: string;
  autoConnect: boolean;    // Connect on app start
}

interface Settings {
  // ... existing
  discord: DiscordSettings;
}
```

### Database

```sql
-- Store encrypted in workspace settings JSON
-- Token encryption uses Tauri's secure storage or OS keychain
```

### Settings UI Component

```tsx
// src/components/settings/tabs/integrations-tab.tsx

export function IntegrationsTab() {
  return (
    <div>
      <DiscordSection />
      {/* Future: Slack, GitHub, etc. */}
    </div>
  );
}

function DiscordSection() {
  const [status, setStatus] = useState<'disconnected' | 'connecting' | 'connected' | 'error'>('disconnected');
  const [showToken, setShowToken] = useState(false);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Discord Integration</CardTitle>
        <Switch checked={enabled} onCheckedChange={toggleDiscord} />
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {/* Bot Token */}
          <div>
            <Label>Bot Token</Label>
            <div className="flex gap-2">
              <Input
                type={showToken ? 'text' : 'password'}
                value={token}
                onChange={setToken}
              />
              <Button variant="ghost" onClick={() => setShowToken(!showToken)}>
                {showToken ? <EyeOff /> : <Eye />}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Create a bot at discord.com/developers
            </p>
          </div>

          {/* Server ID */}
          <div>
            <Label>Server ID</Label>
            <div className="flex gap-2">
              <Input value={guildId} onChange={setGuildId} />
              <Button variant="outline" onClick={detectServer}>
                Detect
              </Button>
            </div>
          </div>

          {/* Status & Actions */}
          <div className="flex items-center gap-4">
            <StatusIndicator status={status} />
            <Button onClick={testConnection} disabled={!token}>
              Test Connection
            </Button>
          </div>

          {error && <Alert variant="destructive">{error}</Alert>}
        </div>
      </CardContent>
    </Card>
  );
}
```

### IPC Commands

```rust
#[tauri::command]
pub async fn save_discord_settings(
    state: State<'_, AppState>,
    settings: DiscordSettings,
) -> Result<(), AppError> {
    // Encrypt token before storage
    let encrypted_token = encrypt_token(&settings.bot_token)?;
    // Save to workspace settings...
}

#[tauri::command]
pub async fn test_discord_connection(
    state: State<'_, AppState>,
    token: String,
) -> Result<DiscordTestResult, AppError> {
    // Try to connect, return user info or error
}

#[tauri::command]
pub async fn get_discord_guilds(
    state: State<'_, AppState>,
    token: String,
) -> Result<Vec<DiscordGuild>, AppError> {
    // List guilds bot is in (for auto-detect)
}
```

## Implementation Steps

1. Add `DiscordSettings` to settings types
2. Create `integrations-tab.tsx` component
3. Add Discord section with token/server inputs
4. Implement token encryption (Tauri keyring or AES)
5. Add `save_discord_settings` command
6. Add `test_discord_connection` command
7. Wire up status indicator
8. Add "Detect" functionality for server ID
9. Persist settings in workspace config
10. Test flow: enter token → test → save → reconnect

## Files

**New:**
- `src/components/settings/tabs/integrations-tab.tsx`
- `src/components/settings/discord-section.tsx`

**Modified:**
- `src/types/settings.ts` - Add DiscordSettings
- `src/stores/settings-store.ts` - Handle discord settings
- `src/components/settings/settings-panel.tsx` - Add Integrations tab
- `src-tauri/src/commands/discord.rs` - Add settings commands

## Complexity

**S** - Standard settings UI, token handling

## Commit

`feat(settings): add Discord integration settings panel`
