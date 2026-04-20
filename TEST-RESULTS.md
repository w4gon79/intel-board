# Intel Board - CDP Test Results

## Test Run 1 (2026-04-05 16:55 CDT) - Initial Walkthrough

### Bugs Found
1. Chat confidence always 80% - FIXED
2. "Show Military Only" toggle broken - PARTIALLY FIXED (see Test Run 2)
3. No ship count in sidebar - FIXED
4. No ship count in top stats bar - FIXED
5. Toggle visual state doesn't flip - FIXED
6. Intel Items layer missing - NEEDS VERIFICATION

---

## Test Run 2 (2026-04-05 19:49 CDT) - Post-Fix Verification

### Verified Fixed
- **Bug 3 & 4:** Ship count showing in sidebar (14,194 vessels) and top bar (16,572 vessels, 237 mil)
- **Bug 5:** Toggle visually flips correctly (aria-checked, bg color, translate all change on click)
- **Bug 1:** Chat confidence now dynamic (tested: 69% on a query about Strait of Hormuz)
- **Sidebar counts:** All 3 buttons show counts (ADS-B 5,848, AIS 14,194, Intel 657)

### Still Broken
- **Bug 2 (Military Only Filter):** Toggle flips visually but:
  - Settings.json does NOT update when toggled (still says militaryOnly: true after toggle off)
  - Map does NOT filter flights (shows 5,828 flights with 447 mil, should show only 447)
  - Stats counter does NOT change
  - Root cause: Settings save is not triggered by toggle click, and map doesn't read the setting

### Needs Further Testing
- **Bug 6 (IntelLayer):** No intel markers visible on map. May be because intel items don't have coordinates, or the layer component isn't rendering. Need to verify the component is mounted and check if intel_items have lat/lon data.

### New Issues Found
- **Settings not saving:** Toggle changes aren't persisted to settings.json. The settings panel needs a save action or auto-save on toggle change.
- **Feed only shows Predictions:** The "All" tab in the feed shows only prediction cards, no ALERT or WATCH items. Either the feed query is wrong or alerts/watches aren't being stored as feed items.
- **Prediction text repetitive:** Most predictions start with "There is a high likelihood that military tensions..." - the LLM prompt needs more variety.

### Stats at time of test
- Flights: 5,740 (442 military)
- Vessels: 16,572 (237 military)
- Intel Items: 657
- Feed: 1,578 articles
- Alerts: 202 active, 65 watches
- Predictions: 14
