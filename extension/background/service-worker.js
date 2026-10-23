/**
 * Slack UI Tweaker — background service worker.
 *
 * Its only job is to forward the keyboard command (Alt+S by default, editable in
 * chrome://extensions/shortcuts) to the active tab. The content script also listens for Alt+S
 * itself, so the shortcut keeps working if the command is unassigned; the inspector debounces the
 * two paths so one key press never toggles twice.
 */
importScripts('../shared/constants.js');

const { COMMAND_TOGGLE_INSPECTOR, MSG } = self.SUT.constants;

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command !== COMMAND_TOGGLE_INSPECTOR) return;
  let target = tab;
  if (!target || target.id === undefined) {
    [target] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  }
  if (!target || target.id === undefined) return;
  try {
    await chrome.tabs.sendMessage(target.id, { type: MSG.TOGGLE_INSPECTOR });
  } catch {
    // Not a Slack tab, or a Slack tab opened before the extension was installed: nothing to toggle.
  }
});
