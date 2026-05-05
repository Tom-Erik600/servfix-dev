# Learnings — belastning-fane

## [2026-04-29] Initial setup

### Kodebase-funn
- `planlegger.html` er 175 linjer
- `.view-toggle` linje 101–108: `#btn-calendar-view` (aktiv, første), `#btn-technician-view`
- `.overview-body` linje 153–163: `#calendar-grid-view`, `#technician-list-view` (hidden)
- `.overview-stats` linje 128–150: 3 `stat-item`-elementer
- `#technician-legend` bruker `display: flex` når synlig

### planlegger.js
- `overviewState` linje 1836: `{ currentStartMonth, orders, technicians, currentView: 'calendar' }`
- `initOverviewModal()` linje 1850
- `openOverviewModal()` linje 1912
- `loadOverviewData()` linje 1941
- `updatePeriodIndicator()` linje 1982 — deaktiverer prevBtn basert på måneds-sammenligning
- `switchOverviewView()` linje 2021 — kaller kun `renderCurrentView()`
- `renderTechnicianLegend()` kalles i `loadOverviewData()` linje ~1973
- `escapeHtmlOverview()` og `monthNames` finnes globalt

### planlegger.css
- CSS-variabler: `--bg-light: #f9fafb`, `--border-color: #e5e7eb`, `--text-color: #1f2937`
- 1974 linjer totalt

### Kritiske fallgruver
1. `updatePeriodIndicator()` disabler `prevBtn` — MÅ ikke gjelde load-view (early return)
2. `prevBtn`/`nextBtn` muterer `currentStartMonth` med `.setMonth(±6)` — MÅ kondisjoneres
3. `renderTechnicianLegend()` setter legend synlig — skjul etterpå hvis load-view
4. `#load-grid-view` vises med `display = 'block'` (ikke 'grid') — `.load-cards-grid` er grid-containeren
5. `switchOverviewView()` MÅ kalle `loadOverviewData()` ikke `renderCurrentView()`
