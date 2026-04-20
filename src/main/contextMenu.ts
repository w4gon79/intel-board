import { Menu, BrowserWindow, clipboard, shell } from 'electron'

/**
 * Sets up a right-click context menu on the given BrowserWindow.
 * Provides spell-check suggestions, Cut/Copy/Paste, Select All,
 * Copy Link, and Copy Image — matching standard OS behaviour that
 * Electron does not enable by default.
 */
export function setupContextMenu(mainWindow: BrowserWindow): void {
  mainWindow.webContents.on('context-menu', (_event, params) => {
    const menuItems: Electron.MenuItemConstructorOptions[] = []

    // ── Spell-check suggestions (misspelled word) ──
    if (params.misspelledWord) {
      if (params.dictionarySuggestions && params.dictionarySuggestions.length > 0) {
        for (const suggestion of params.dictionarySuggestions) {
          menuItems.push({
            label: suggestion,
            click: () => {
              mainWindow.webContents.replaceMisspelling(suggestion)
            }
          })
        }
      } else {
        menuItems.push({
          label: 'No suggestions',
          enabled: false
        })
      }
      menuItems.push({ type: 'separator' })
    }

    // ── Editable area (input / textarea) ──
    if (params.isEditable) {
      menuItems.push({
        label: 'Cut',
        accelerator: 'CmdOrCtrl+X',
        role: 'cut',
        enabled: params.selectionText.length > 0
      })

      menuItems.push({
        label: 'Copy',
        accelerator: 'CmdOrCtrl+C',
        role: 'copy',
        enabled: params.selectionText.length > 0
      })

      menuItems.push({
        label: 'Paste',
        accelerator: 'CmdOrCtrl+V',
        role: 'paste',
        enabled: clipboard.readText().length > 0
      })

      menuItems.push({ type: 'separator' })

      menuItems.push({
        label: 'Select All',
        accelerator: 'CmdOrCtrl+A',
        role: 'selectAll'
      })
    } else if (params.selectionText) {
      // ── Non-editable selected text (displayed content) ──
      menuItems.push({
        label: 'Copy',
        accelerator: 'CmdOrCtrl+C',
        role: 'copy'
      })
      menuItems.push({ type: 'separator' })
      menuItems.push({
        label: 'Select All',
        accelerator: 'CmdOrCtrl+A',
        role: 'selectAll'
      })
    }

    // ── Link operations ──
    if (params.linkURL) {
      if (menuItems.length > 0) menuItems.push({ type: 'separator' })
      menuItems.push({
        label: 'Copy Link',
        click: () => {
          clipboard.writeText(params.linkURL)
        }
      })
      menuItems.push({
        label: 'Open in Browser',
        click: () => {
          shell.openExternal(params.linkURL)
        }
      })
    }

    // ── Image operations ──
    if (params.hasImageContents) {
      if (menuItems.length > 0) menuItems.push({ type: 'separator' })
      menuItems.push({
        label: 'Copy Image',
        click: () => {
          mainWindow.webContents.copyImageAt(params.x, params.y)
        }
      })
    }

    // Only show the menu when there are relevant items
    if (menuItems.length > 0) {
      const menu = Menu.buildFromTemplate(menuItems)
      menu.popup({ window: mainWindow })
    }
  })
}