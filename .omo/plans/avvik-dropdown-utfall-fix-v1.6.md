# v1.6 Avvik bugfix — utfall-knapper på dropdown-sjekkpunkter

## TL;DR

> **Quick Summary**: Ett-linjes bugfiks. Sjekkpunkter med dropdown (Varmegjenvinner Type,
> Gjenvinnerbatteri Type) mangler «Fikset på stedet»/«Ønsker tilbud»-knappene når Avvik velges
> fordi typene `dropdown_ok_avvik` og `dropdown_ok_avvik_comment` ikke er i `OUTCOME_ITEM_TYPES`-
> whitelisten i teknikerappens service.js. Resten av render/save-koden støtter dem allerede.
>
> **Deliverable**: Legg til de to dropdown-typene i `OUTCOME_ITEM_TYPES`-arrayen.

---

## Context

### Rapportert av Tom-Erik
Skjermbilde fra teknikerapp viser:
- Sjekkpunkter UTEN dropdown (Frekvens omf. gjenvinner) → får utfall-knappene riktig ved Avvik
- Sjekkpunkter MED dropdown (Varmegjenvinner Type, Gjenvinnerbatteri Type) → mangler utfall-knappene helt

Konsekvens: Tekniker kan ikke markere dropdown-avvik som «Fikset på stedet» eller «Ønsker tilbud»
→ disse avvikene blir aldri kommersielt klassifisert → faller utenfor v1.0–v1.5-flyten.

### Read-first (verifisert)

| Funn | Fil:linje |
|------|-----------|
| Whitelist for utfall-knapper | `public/app/assets/js/service.js:3618` |
| Whitelist-sjekk som blokkerer rendering | `public/app/assets/js/service.js:3654` |
| Dropdown-typer brukt i render (case-statements) | `service.js:2122, 2124, 3265, 3266` |
| Dropdown-typer brukt i save-håndtering | `service.js:4386, 4409` |
| Resten av flyten støtter dropdown-typer fullt ut | Verifisert via grep |

Nåværende kode (`service.js:3618`):
```js
const OUTCOME_ITEM_TYPES = ['ok_avvik', 'ok_avvik_comment', 'ok_avvik_image', 'ok_avvik_severity', 'ok_byttet_avvik'];
```

Linje 3654:
```js
if (!avvikContainer || !OUTCOME_ITEM_TYPES.includes(itemType)) return;
```

---

## Work Objectives

### Must Have
- `dropdown_ok_avvik` og `dropdown_ok_avvik_comment` lagt til i `OUTCOME_ITEM_TYPES`-arrayen
- Ingen andre endringer i filen

### Must NOT Have
- INGEN endring av render-logikken (`outcomeChoiceHTML`, `setOutcomeBtnActive`)
- INGEN endring av save-håndtering for outcome
- INGEN ny CSS
- INGEN endring i datamodell, API, eller backend
- INGEN nye sjekkpunkt-typer
- INGEN parseInt på VARCHAR
- INGEN commits fra agent

---

## Execution Strategy

```
Wave 1 (1 oppgave — trivielt ett-linjes fiks):
└── T1: service.js — legg til 2 typer i OUTCOME_ITEM_TYPES

Wave FINAL:
└── F1: Bekreft kun ett-linjes endring + ingen regresjon
→ Vent på Tom-Eriks «okay»
```

---

## TODOs

- [ ] 1. `public/app/assets/js/service.js`: Utvid `OUTCOME_ITEM_TYPES` med dropdown-typer

  **What to do**:

  På linje 3618, erstatt:
  ```js
  const OUTCOME_ITEM_TYPES = ['ok_avvik', 'ok_avvik_comment', 'ok_avvik_image', 'ok_avvik_severity', 'ok_byttet_avvik'];
  ```

  Med:
  ```js
  const OUTCOME_ITEM_TYPES = ['ok_avvik', 'ok_avvik_comment', 'ok_avvik_image', 'ok_avvik_severity', 'ok_byttet_avvik', 'dropdown_ok_avvik', 'dropdown_ok_avvik_comment'];
  ```

  Det er den ENESTE endringen. Resten av filen — render-logikk (linje 3620-3650), event-handlere
  (linje 3654-3680), save-flyt (linje 4253-4450) — er allerede komplett for de nye typene.

  **Must NOT do**:
  - Ikke endre noe annet i filen
  - Ikke endre `outcomeChoiceHTML`, `setOutcomeBtnActive`, `injectOutcomeChoiceStyleOnce`
  - Ikke endre case-statementene som allerede håndterer dropdown-typene
  - Ikke legge til CSS eller nye typer som ikke finnes fra før

  **Recommended Agent Profile**: `quick`

  **Parallelization**: Wave 1, alene (ett-linjes endring i én fil).

  **References**:
  - Mål: `public/app/assets/js/service.js:3618`
  - Whitelist-sjekk: `service.js:3654`
  - Dropdown-render: `service.js:2122-2124, 3265-3266`
  - Dropdown-save: `service.js:4386, 4409`

  **Acceptance Criteria**:
  - [ ] `OUTCOME_ITEM_TYPES`-arrayen inneholder 7 verdier (5 originale + 2 nye)
  - [ ] Ingen andre linjer i filen er endret
  - [ ] `node --check public/app/assets/js/service.js` passerer

  **Commit**: NO (Tom-Erik committer)

---

## Final Verification Wave

- [ ] F1. **Bekreft minimal endring + ingen regresjon** — `quick`
  - Grep `OUTCOME_ITEM_TYPES` — bekreft at lista inneholder begge nye typer
  - Diff: `git diff public/app/assets/js/service.js` — bekreft KUN linje 3618 er endret
  - `node --check public/app/assets/js/service.js` — bekreft syntaks OK
  - Bekreft at `outcomeChoiceHTML`, `setOutcomeBtnActive` og save-logikken på linje 4386/4409
    er urørt
  - Kjør `npm test` — bekreft samme baseline (`226 pass / 3 pre-existing fail`)
  Output: `Endringer [1/1] | Regresjon [CLEAN] | Tests [N pass] | VERDICT: APPROVE/REJECT`

---

## Manuell QA (Tom-Erik kjører i dev)

1. Åpne et serviceoppdrag som har et sjekkpunkt med dropdown (f.eks. Varmegjenvinner Type)
2. Velg en verdi fra dropdownen (f.eks. «Roterende varmegjenvinn»)
3. Klikk «Avvik»-knappen
4. **Forventet:** «Utfall: Fikset på stedet | Ønsker tilbud»-raden vises nederst, akkurat som
   for non-dropdown-sjekkpunkter
5. Klikk «Ønsker tilbud» → blir blå, lagres
6. **Verifiser i DB:** `SELECT id, outcome FROM deviations ORDER BY id DESC LIMIT 1;` →
   `outcome = 'wants_quote'`
7. Verifiser i arbeidsliste → avviket vises som «Ønsker tilbud» og kan «Lag tilbud» fra

Test også Gjenvinnerbatteri Type for å bekrefte begge dropdown-typer fungerer.

---

## Commit Strategy

Tom-Erik kjører:
```
fix(service-app): show outcome buttons on dropdown checklist items
```

---

## Success Criteria

- [ ] Utfall-knappene vises på dropdown-sjekkpunkter ved Avvik
- [ ] Eksisterende ikke-dropdown-sjekkpunkter virker uendret
- [ ] Avvik lagres med korrekt `outcome` i DB
- [ ] Arbeidsliste i admin viser nye avvik som forventet
- [ ] Ingen regresjon i jest-tester (`226 pass` baseline)
