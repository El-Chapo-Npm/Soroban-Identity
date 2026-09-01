# Keyboard Shortcuts

Soroban Identity supports comprehensive keyboard shortcuts to improve navigation and productivity for power users.

## Features

- **Configurable Shortcuts**: Enable/disable shortcuts globally or customize individual bindings
- **Platform-Aware**: Automatically detects Mac vs Windows/Linux for Cmd vs Ctrl
- **Context-Aware**: Shortcuts don't interfere with form inputs
- **Accessible**: Full keyboard navigation with screen reader support
- **Sequential Keys**: Support for Gmail-style sequential shortcuts (e.g., `g` then `d`)
- **Help Modal**: Press `?` anytime to view all available shortcuts
- **Persistent Settings**: Configuration saved to localStorage

## Default Shortcuts

### Navigation

| Shortcut | Description |
|----------|-------------|
| `G` then `D` | Navigate to DIDs (Identity) tab |
| `G` then `C` | Navigate to Credentials tab |

### Actions

| Shortcut | Description |
|----------|-------------|
| `Ctrl/Cmd + K` | Focus search input (when available) |
| `Ctrl/Cmd + N` | Create new credential |

### User Interface

| Shortcut | Description |
|----------|-------------|
| `Ctrl/Cmd + Shift + T` | Toggle theme (Light → Dark → System) |
| `?` or `Ctrl/Cmd + /` | Show keyboard shortcuts help |
| `Esc` | Close dialog, modal, or menu |

## Usage

### Viewing Available Shortcuts

Press `?` or `Ctrl/Cmd + /` anywhere in the application to open the keyboard shortcuts help modal. The modal displays all available shortcuts grouped by category.

### Enabling/Disabling Shortcuts

Shortcuts are enabled by default. To disable them:

1. Press `?` to open the shortcuts help modal
2. Uncheck "Enable keyboard shortcuts"
3. The setting is automatically saved to localStorage

### Sequential Shortcuts

Some shortcuts use a sequential pattern inspired by Gmail:

1. Press the first key (e.g., `g`)
2. Within 1 second, press the second key (e.g., `d`)
3. The action is triggered (navigate to DIDs tab)

If you press the wrong key or wait too long, the sequence resets.

## Implementation Details

### Architecture

The keyboard shortcuts system consists of:

- **`useKeyboardShortcuts` hook**: Handles single-key and modifier combinations
- **`useSequentialShortcuts` hook**: Handles multi-key sequences
- **`KeyboardShortcutsContext`**: Global state management and configuration
- **`KeyboardShortcutsModal`**: Help UI component

### Context-Aware Behavior

Shortcuts automatically ignore keypresses when:
- Typing in `<input>` elements
- Typing in `<textarea>` elements
- Typing in `<select>` dropdowns
- Editing in contentEditable elements

**Exception**: The `Escape` key always works, even in form elements, to allow closing dialogs.

### Platform Detection

The system automatically detects the user's platform and displays the correct modifier key:

- **macOS**: Shows `Cmd` for `Ctrl` shortcuts
- **Windows/Linux**: Shows `Ctrl` for `Ctrl` shortcuts

Both `Ctrl` and `Meta` keys trigger `ctrl: true` shortcuts for maximum compatibility.

## Configuration

### Programmatic Configuration

Shortcuts can be registered programmatically using the hooks:

```tsx
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';

useKeyboardShortcuts({
  shortcuts: [
    {
      key: 'k',
      ctrl: true,
      description: 'Open search',
      category: 'actions',
      handler: () => openSearch(),
    },
  ],
});
```

### Sequential Shortcuts

```tsx
import { useSequentialShortcuts } from './hooks/useKeyboardShortcuts';

useSequentialShortcuts({
  'g,d': () => goToDIDs(),
  'g,c': () => goToCredentials(),
}, { timeout: 1000 });
```

### Storage Format

Configuration is stored in localStorage under the key `keyboard-shortcuts-config`:

```json
{
  "enabled": true,
  "customShortcuts": {}
}
```

## Accessibility

### Keyboard Navigation

All shortcuts are designed to complement, not replace, standard keyboard navigation:

- Tab/Shift+Tab still navigate through focusable elements
- Arrow keys still work for tab navigation
- Enter/Space still activate buttons
- Screen readers announce all actions triggered by shortcuts

### ARIA Labels

The shortcuts help modal includes:

- Proper `role="dialog"` semantics
- `aria-labelledby` pointing to the modal title
- `aria-describedby` pointing to the description
- Keyboard trap: `Esc` or clicking backdrop closes the modal
- Focus management: Close button receives focus when opened

### Screen Reader Support

- Shortcuts are hidden from screen readers using `sr-only` class for table headers
- Visual keyboard indicators use semantic `<kbd>` elements
- All actions provide audible feedback through existing toast notifications

## Tooltips

Keyboard shortcuts are shown in tooltips throughout the UI:

- Buttons show shortcuts on hover (e.g., "Create Credential (Ctrl+N)")
- Tab buttons show navigation shortcuts
- Theme toggle shows shortcut

To enable shortcuts in tooltips, use the `title` attribute:

```tsx
<button
  onClick={handleCreate}
  title={`Create Credential (${formatShortcut({ key: 'n', ctrl: true })})`}
>
  Create
</button>
```

## Browser Compatibility

The keyboard shortcuts system is compatible with:

- Chrome/Edge 90+
- Firefox 88+
- Safari 14+
- All browsers supporting ES2020 and the Web Platform's KeyboardEvent API

### Known Limitations

- Some browser shortcuts take precedence (e.g., `Ctrl+W` to close tab)
- System shortcuts take precedence (e.g., `Cmd+Space` on macOS)
- Browser extensions may intercept some shortcuts

## Testing

Comprehensive tests are included in `useKeyboardShortcuts.test.ts`:

```bash
# Run keyboard shortcuts tests
npm test -- useKeyboardShortcuts

# Run all tests
npm test
```

### Test Coverage

- ✅ Basic shortcut triggering
- ✅ Modifier key combinations
- ✅ Sequential shortcuts
- ✅ Context awareness (form elements)
- ✅ Enable/disable functionality
- ✅ Timeout behavior
- ✅ Platform detection
- ✅ Formatting utilities

## Performance

The keyboard shortcuts system has minimal performance impact:

- **Event Listeners**: Single global `keydown` listener
- **Memory**: ~2KB for configuration storage
- **CPU**: O(n) lookup through shortcuts array (typically < 20 items)
- **No Polling**: Event-driven, no timers except for sequential shortcuts

## Future Enhancements

Potential improvements for future versions:

- [ ] User-customizable key bindings in settings UI
- [ ] Import/export shortcut configurations
- [ ] Shortcut conflict detection
- [ ] Recording mode for custom shortcuts
- [ ] Cheat sheet PDF export
- [ ] Shortcut analytics (which shortcuts are most used)

## Troubleshooting

### Shortcuts Not Working

1. **Check if shortcuts are enabled**: Press `?` and verify the checkbox is checked
2. **Browser conflicts**: Some shortcuts may conflict with browser defaults
3. **Extension conflicts**: Disable browser extensions temporarily to test
4. **Clear localStorage**: Delete `keyboard-shortcuts-config` key and reload

### Sequential Shortcuts Timing Out

The default timeout is 1 second. If you're pressing keys too slowly:

1. Practice the key sequence faster
2. Timeout is not currently user-configurable but could be added

### Wrong Modifier Key Displayed

If shortcuts show `Cmd` on Windows or `Ctrl` on Mac:

1. Check `navigator.platform` in browser console
2. Report as a bug if platform detection is incorrect

## Examples

### Adding a New Shortcut

```tsx
// In your component
const { registerShortcuts, unregisterShortcuts } = useKeyboardShortcutsContext();

useEffect(() => {
  const shortcuts = [
    {
      key: 'r',
      ctrl: true,
      description: 'Refresh data',
      category: 'actions',
      handler: handleRefresh,
    },
  ];
  
  registerShortcuts(shortcuts);
  return () => unregisterShortcuts(shortcuts);
}, []);
```

### Conditionally Enabled Shortcut

```tsx
useKeyboardShortcuts({
  shortcuts: [
    {
      key: 's',
      ctrl: true,
      description: 'Save',
      category: 'actions',
      handler: handleSave,
      enabled: hasUnsavedChanges, // Only active when there are changes
    },
  ],
});
```

## References

- [WAI-ARIA Authoring Practices - Keyboard Interface](https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface/)
- [KeyboardEvent API](https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent)
- [Gmail Keyboard Shortcuts](https://support.google.com/mail/answer/6594) (inspiration for sequential shortcuts)

## Contributing

To add new keyboard shortcuts:

1. Register the shortcut in `App.tsx` or the relevant component
2. Add translation keys to `locales/en.json` and `locales/es.json`
3. Add tests in `useKeyboardShortcuts.test.ts`
4. Update this documentation
5. Add tooltip hints to relevant UI elements

For questions or suggestions, open an issue on GitHub.
