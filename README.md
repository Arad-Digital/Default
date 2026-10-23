# Slack UI Tweaker

Estensione per Google Chrome / Microsoft Edge (Manifest V3) che permette di modificare in tempo reale l'interfaccia di **Slack Web** e della **PWA di Slack** (`https://app.slack.com/*`) con una modalità ispettore punta-e-clicca: passi il mouse su un elemento, lo clicchi e scegli cosa farne (nasconderlo, mostrarlo solo in hover, sfumarlo, compattarlo, renderlo collassabile o scrivere il tuo CSS).

> Progetto indipendente, non affiliato a Slack Technologies. Funziona solo nel browser (scheda o PWA), **non** nell'app desktop di Slack (Electron).

---

## Indice

1. [Funzionalità](#funzionalità)
2. [Installazione (estensione non pacchettizzata)](#installazione-estensione-non-pacchettizzata)
3. [Uso nella PWA di Slack](#uso-nella-pwa-di-slack)
4. [Come si usa](#come-si-usa)
5. [Come testarla in un workspace Slack](#come-testarla-in-un-workspace-slack)
6. [Architettura](#architettura)
7. [Selettori robusti](#selettori-robusti)
8. [Prestazioni, sicurezza e privacy](#prestazioni-sicurezza-e-privacy)
9. [Formato del backup JSON](#formato-del-backup-json)
10. [Limiti noti e risoluzione problemi](#limiti-noti-e-risoluzione-problemi)

---

## Funzionalità

| Funzione | Dettagli |
|---|---|
| **Ispettore punta-e-clicca** | Si avvia dal popup, dal pulsante flottante nella pagina o con <kbd>Alt</kbd>+<kbd>S</kbd>. Evidenzia l'elemento sotto il cursore con un overlay (il box model di Slack non viene toccato) e mostra un tooltip con tag e selettore. Il click viene intercettato: Slack non reagisce. <kbd>Esc</kbd> esce senza salvare nulla. Utilizzabile anche da tastiera (focus mantenuto, pannello e pulsante flottante spostabili con le frecce). |
| **Targeting** | *Questo elemento*, *Simili* (tutti gli elementi equivalenti nel contenitore, con conteggio) oppure *Genitore*. Con le frecce ↑/↓ si risale o si ridiscende nell'albero DOM. |
| **Ambito** | Ogni regola vale per il **workspace corrente** (ID del team letto dall'URL `/client/T…/`) oppure è **globale** per tutto `app.slack.com`. |
| **Azioni** | **Nascondi** (`display: none`) · **Mostra solo in hover** (`opacity: 0` → `1` quando il genitore o il contenitore del messaggio è in hover) · **Dissolvenza** (opacità 20%, opzionalmente piena in hover) · **Compatta** (dimezza o azzera padding, margini e gap) · **Collassabile con toggle** (pulsante ▸/▾ inserito prima del blocco) · **Editor selettore/CSS**. |
| **Anteprima** | Passando il mouse su un'azione del menu se ne vede subito l'effetto; nell'editor l'anteprima è live mentre scrivi. |
| **Persistenza** | Regole in `chrome.storage.local`, applicate da un unico `<style id="slack-ui-tweaker-styles">` in `<head>`: restano attive durante la navigazione SPA (cambio canale, thread, ricerca) senza flickering. |
| **Dashboard** | Interruttore generale, avvio ispettore, elenco regole (vista corrente o tutte) con toggle, *Evidenzia*, *Modifica*, *Elimina*, esportazione/importazione JSON. |
| **Accessibilità** | Etichette esplicite, stati annunciati agli screen reader, controlli raggiungibili da tastiera, supporto a Contrasto elevato (Forced Colors) e alla dimensione del testo del browser. |

---

## Installazione (estensione non pacchettizzata)

Requisiti: Chrome 102+ oppure Edge 102+ (qualsiasi browser Chromium recente). Nessuna dipendenza da installare e nessun passaggio di build.

### Google Chrome

1. Scarica o clona il repository e individua la cartella **`extension/`**, quella che contiene `manifest.json`.
2. Apri `chrome://extensions`.
3. Attiva **Modalità sviluppatore** (interruttore in alto a destra).
4. Clicca **Carica estensione non pacchettizzata** e seleziona la cartella `extension/`.
5. (Consigliato) Clicca l'icona del puzzle 🧩 nella barra degli strumenti e fissa **Slack UI Tweaker**.
6. **Ricarica le schede di Slack già aperte**: i content script vengono iniettati solo nelle pagine caricate dopo l'installazione. Il popup lo segnala e offre un pulsante *Ricarica*.

### Microsoft Edge

1. Apri `edge://extensions`.
2. Attiva **Modalità sviluppatore** (interruttore nel pannello laterale).
3. Clicca **Carica decompressa** e seleziona la cartella `extension/`.
4. Ricarica le schede di Slack aperte.

### Aggiornare dopo una modifica al codice

Su `chrome://extensions` (o `edge://extensions`) clicca l'icona ↻ della scheda dell'estensione, poi ricarica Slack. Una pagina di Slack rimasta aperta durante l'aggiornamento (o mentre disattivi o rimuovi l'estensione) si ripulisce da sola entro un paio di secondi: toglie regole, pulsanti ▸/▾ e pulsante flottante, smette di intercettare <kbd>Alt</kbd>+<kbd>S</kbd> e mostra l'avviso *"Slack UI Tweaker è stato aggiornato o disattivato: ricarica la pagina di Slack"*.

### Scorciatoia da tastiera

<kbd>Alt</kbd>+<kbd>S</kbd> (su macOS <kbd>Option</kbd>+<kbd>S</kbd>) attiva/disattiva l'ispettore. Per cambiarla apri `chrome://extensions/shortcuts` (oppure `edge://extensions/shortcuts`). Se un'altra estensione usa già la stessa combinazione, il browser non la assegna: la scorciatoia continua a funzionare comunque quando la pagina di Slack ha il focus, perché la ascolta anche il content script.

---

## Uso nella PWA di Slack

La PWA di Slack è `app.slack.com` aperto in una finestra dedicata, quindi l'estensione funziona allo stesso modo e **condivide le stesse regole** della scheda del browser.

1. Apri `https://app.slack.com` in Chrome ed esegui l'accesso.
2. Installa la PWA:
   - **Chrome**: icona *Installa* nella barra degli indirizzi, oppure menu ⋮ → *Trasmetti, salva e condividi* → *Installa pagina come app…*;
   - **Edge**: menu ⋯ → *App* → *Installa questo sito come app*.
3. Apri la finestra della PWA. Se era già aperta prima di installare l'estensione, ricaricala con <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>R</kbd>.
4. Per avviare l'ispettore nella PWA:
   - premi <kbd>Alt</kbd>+<kbd>S</kbd>, oppure
   - clicca il **pulsante flottante** (cerchio con il mirino sul bordo destro). Si sposta in verticale trascinandolo, oppure con le frecce ↑/↓ quando ha il focus.
5. Per gestire le regole: a seconda della versione del browser, le icone delle estensioni possono comparire nella barra del titolo della PWA. Se non le vedi, apri la **dashboard in una scheda**: `chrome://extensions` → *Slack UI Tweaker* → *Dettagli* → *Opzioni estensione*, oppure il link *Apri in una scheda* nel popup. Le modifiche fatte lì si applicano subito anche alla PWA.

---

## Come si usa

### 1. Avviare l'ispettore

Un banner in alto conferma che l'ispettore è attivo e il cursore diventa un mirino. Passando sopra gli elementi compare un riquadro azzurro con un tooltip: `tag`, il miglior attributo stabile trovato e le dimensioni. L'hover di Slack non viene bloccato, quindi puoi puntare anche gli elementi che compaiono solo in hover, come la barra azioni dei messaggi.

### 2. Selezionare un elemento

Al click il menu contestuale si apre vicino all'elemento; lo puoi trascinare dall'intestazione, oppure spostare con le frecce dopo aver dato il focus alla maniglia ✥ (<kbd>Maiusc</kbd> per passi più lunghi). Dopo ogni scelta il focus resta sul controllo che hai usato e, alla chiusura, torna dove si trovava prima.

- **Applica a**: *Questo elemento* / *Simili (N)* / *Genitore*. Il selettore generato e il numero di elementi corrispondenti si aggiornano subito; gli elementi coinvolti sono contornati in giallo. Il badge *Strutturale* segnala un selettore basato sulla posizione nel DOM, più fragile.
- **↑ / ↓**: risale al genitore o torna al figlio.
- **Ambito**: workspace corrente oppure *Tutti i workspace*.
- **Azioni**: il passaggio del mouse mostra l'anteprima e il click salva la regola. Un toast permette di **annullare** subito. L'icona ⚙ accanto a ogni azione apre l'editor con quell'azione preimpostata.
- Tasto destro (o click fuori dal menu): annulla la selezione e torna all'ispezione. <kbd>Esc</kbd>: esce.

### 3. Editor selettore / CSS

- **Selettore**: modificabile, con validazione e conteggio live.
- **Azione** e relative **opzioni**: cosa deve essere in hover per la rivelazione (genitore, contenitore del messaggio o antenato personalizzato), opacità, ripristino in hover, compattazione dimezzata o azzerata, stato iniziale del blocco collassabile.
- **Nome** e **ambito** della regola.
- **Regola CSS**: viene generata in automatico. Se la modifichi a mano, la regola diventa *CSS personalizzato*; con *Rigenera dal selettore* torni al CSS generato.
- **Anteprima live** attivabile e disattivabile. <kbd>Invio</kbd> nel campo selettore, oppure <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>Invio</kbd>, salva.

### 4. Blocchi collassabili

Prima di ogni elemento della regola viene inserito un piccolo pulsante. Da chiuso mostra **▸ Nome regola**, da aperto solo **▾**. Lo stato è **per regola** (aprire o chiudere agisce su tutti gli elementi di quella regola) e resta salvato fra le sessioni.

### 5. Dashboard (popup)

- Interruttore generale: spegnendolo, CSS, pulsanti di toggle e pulsante flottante spariscono subito.
- **Punta e clicca**: avvia l'ispettore nella scheda attiva di Slack.
- **Mostra il pulsante flottante nella pagina**.
- **Regole**: filtro *Vista corrente* (globali + workspace attivo) o *Tutte* (raggruppate per workspace). Per ogni regola vedi nome, selettore, tipo di azione, quanti elementi corrispondono ora nella pagina, un interruttore on/off e tre comandi:
  - 👁 **Evidenzia**: contorna gli elementi per 2 secondi e li rende visibili anche se la regola li nasconde;
  - ✎ **Modifica**: apre l'editor direttamente nella pagina di Slack;
  - 🗑 **Elimina**: con conferma, richiede un secondo click (o un secondo <kbd>Invio</kbd>); la richiesta di conferma resta finché il pulsante ha il focus ed è annunciata agli screen reader.
- **Esporta JSON** / **Importa JSON**: l'import unisce le regole (quelle con lo stesso `id` vengono sostituite). Con *L'import sostituisce le regole esistenti* l'import cancella prima le regole attuali.

> Dal popup, *Importa JSON* apre la dashboard in una scheda (la finestra di selezione file chiuderebbe il popup): lì il pulsante è evidenziato, premilo e scegli il file. La scelta *L'import sostituisce le regole esistenti* viene mantenuta.
>
> Il backup contiene i nomi solo dei workspace che hanno regole. Etichette e selettori delle regole possono contenere nomi di canali o persone presi dal DOM di Slack (`aria-label`, `data-qa`): controlla il file prima di condividerlo.

---

## Come testarla in un workspace Slack

Conviene usare un workspace di prova, oppure un canale personale, per non toccare conversazioni importanti. Nessuna azione dell'estensione modifica dati su Slack: cambia solo l'aspetto della pagina nel tuo browser.

**Preparazione**: installa l'estensione, apri `https://app.slack.com/client/<TEAM_ID>/…`, ricarica la pagina e apri il popup. Il sottotitolo deve mostrare *Workspace: <nome>*.

| # | Scenario | Passi | Risultato atteso |
|---|---|---|---|
| 1 | Attivazione | <kbd>Alt</kbd>+<kbd>S</kbd> | Banner "Ispettore attivo", cursore a mirino, riquadro azzurro + tooltip in hover |
| 2 | Click bloccato | Con l'ispettore attivo clicca un canale nella sidebar | Slack **non** cambia canale; si apre il menu |
| 3 | Esc | Apri il menu, passa su *Nascondi* (anteprima), premi <kbd>Esc</kbd> | Tutto torna com'era, nessuna regola creata |
| 4 | Nascondi | Seleziona un pulsante della barra superiore (es. *Huddle* o *Aiuto*) → *Nascondi* | Sparisce; toast con *Annulla*; la regola compare nel popup |
| 5 | Simili | Clicca il nome di un canale in sidebar → *Simili (N)* → *Dissolvenza* | Tutti i nomi dei canali al 20%, pieni in hover |
| 6 | Hover | Passa su un messaggio, clicca un'icona della barra azioni → *Simili* → *Mostra solo in hover* | Le azioni compaiono solo passando sul messaggio |
| 7 | Compatta | Clicca un messaggio (contenitore) → *Simili* → *Compatta* | Padding dei messaggi dimezzato |
| 8 | Collassabile | Seleziona la barra dei segnalibri del canale → *Collassabile con toggle* | Il blocco sparisce e compare **▸ Nome**; cliccandolo si riapre (**▾**) |
| 9 | Navigazione SPA | Cambia canale, apri un thread, fai una ricerca, scorri molto la cronologia | Le regole restano applicate senza sfarfallii; i toggle ricompaiono sui nuovi elementi |
| 10 | Workspace | Crea una regola con ambito *workspace*, poi passa a un altro workspace | La regola non si applica all'altro workspace; quelle *globali* sì |
| 11 | Editor | Menu → *Editor selettore / CSS…*, modifica il CSS (es. `color: red`) → *Salva regola* | Anteprima live; regola salvata come *CSS personalizzato* |
| 12 | Dashboard | Dal popup disattiva una regola, usa 👁 e ✎, elimina una regola | Effetto immediato nella pagina |
| 13 | Backup | *Esporta JSON*, elimina tutto, *Importa JSON* | Le regole tornano identiche |
| 14 | Persistenza | Ricarica Slack o chiudi e riapri il browser | Regole già attive al caricamento |
| 15 | Interruttore generale | Spegni l'estensione dal popup | Slack torna originale; riaccendendola le regole tornano |
| 16 | Tastiera | Apri il menu, usa <kbd>Tab</kbd> e <kbd>Invio</kbd> su *Simili*/*Genitore*, poi le frecce sulla maniglia ✥; dai il focus al pulsante flottante e usa ↑/↓ | Il focus resta sul controllo usato; pannello e pulsante si spostano; <kbd>Esc</kbd> riporta il focus dove era |
| 17 | Sicurezza import | Importa un backup con una regola *custom* che contiene `background: url("https:/\\esempio.invalid/x")` o `url("http:esempio.invalid")` | Nel `<style>` iniettato non resta nessun `url()` esterno e in DevTools → *Network* non parte alcuna richiesta |
| 18 | Aggiornamento | Con Slack aperto, ricarica l'estensione da `chrome://extensions` | Entro ~2 s regole e pulsante flottante spariscono, compare l'avviso di ricaricare la pagina, <kbd>Alt</kbd>+<kbd>S</kbd> torna a Slack |

### Debug

- **CSS applicato**: DevTools → *Elements* → `<head>` → `<style id="slack-ui-tweaker-styles">`. Ogni regola è preceduta da un commento `/* nome · id */`.
- **Console del content script**: in DevTools → *Console*, scegli il contesto **Slack UI Tweaker** nel menu a tendina dei contesti JavaScript (di default è *top*). Lì è disponibile l'oggetto `SUT` (ad esempio `SUT.selectorGenerator.similarSelector($0)` sull'elemento selezionato in *Elements*).
- **Service worker**: `chrome://extensions` → *Slack UI Tweaker* → link *service worker*.
- **Storage**: dalla console del service worker, `chrome.storage.local.get(null).then(console.log)`.

---

## Architettura

```
extension/
├── manifest.json               MV3: permesso storage, host https://app.slack.com/*
├── background/
│   └── service-worker.js       Inoltra il comando Alt+S alla scheda attiva
├── content/                    Content script (isolated world), caricati in quest'ordine:
│   ├── selector-generator.js   Euristica per selettori CSS stabili
│   ├── style-engine.js         Regole → CSS, <style id="slack-ui-tweaker-styles">, anteprime, sanitizzazione
│   ├── dom-mutations.js        Pulsanti ▸/▾ dei blocchi collassabili (MutationObserver)
│   ├── ui-shell.js             Host Shadow DOM: overlay, tooltip, pannello, toast, pulsante flottante
│   ├── inspector.js            Modalità ispettore: hover, click, menu contestuale, editor
│   └── content.js              Entrypoint: storage ↔ engine, workspace, messaggi
├── popup/
│   ├── popup.html / .css / .js Dashboard (popup e pagina opzioni)
├── shared/
│   ├── constants.js            Costanti condivise (azioni, chiavi storage, messaggi)
│   ├── dom.js                  Helper DOM senza innerHTML + icone SVG
│   └── storage.js              Helper tipizzati (JSDoc) per regole, impostazioni, backup
└── icons/                      icon.svg (sorgente) + PNG 16/32/48/128
```

**Moduli senza bundler.** In MV3 i content script non possono essere moduli ES, quindi ogni file è uno script classico che si registra nel namespace `globalThis.SUT`. Nei content script quel namespace vive nell'*isolated world* dell'estensione e Slack non lo vede. Gli stessi file `shared/` sono usati anche dal popup e, nel caso di `constants.js`, dal service worker tramite `importScripts`.

**Flusso dei dati.**

```
 Popup / Ispettore ──scrive──▶ chrome.storage.local ──onChanged──▶ content.js
                                                                  ├─▶ style-engine  → <style> in <head>
                                                                  └─▶ dom-mutations → pulsanti ▸/▾
```

**Modello dati** (`chrome.storage.local`):

| Chiave | Contenuto |
|---|---|
| `sutSettings` | `{ enabled, showFloatingButton, floatingButtonTop }` |
| `sutRules` | `{ "global": Rule[], "T0123ABCD": Rule[], … }`: regole raggruppate per ambito |
| `sutWorkspaces` | `{ "T0123ABCD": { name } }`: nomi dei workspace per la dashboard |

`Rule = { id, selector, action, options, css, baseAction, label, scope, enabled, createdAt, updatedAt }`. Tutti i tipi sono documentati con JSDoc in `shared/storage.js`.

**CSS generato** (esempio per *Mostra solo in hover* sul genitore):

```css
:is([data-qa="message_actions"]):not([data-sut-ui]) { opacity: 0 !important; transition: opacity 0.15s ease-in-out !important; }
:hover > :is([data-qa="message_actions"]):not([data-sut-ui]),
:focus-within > :is([data-qa="message_actions"]):not([data-sut-ui]),
:is([data-qa="message_actions"]):not([data-sut-ui]):focus-within { opacity: 1 !important; }
```

Il target è racchiuso in `:is()` così funziona qualsiasi lista di selettori, e le regole di "rivelazione" hanno sempre specificità maggiore. `:not([data-sut-ui])` evita che le regole colpiscano gli elementi iniettati dall'estensione.

---

## Selettori robusti

Slack è un'app React con classi CSS generate o legate allo stato. Il generatore (`content/selector-generator.js`) usa, in ordine di priorità:

1. **Hook di test di Slack**: `[data-qa="…"]`, `[data-testid="…"]`, `[data-sk="…"]` e i flag `[data-qa-*]`.
2. **Attributi di accessibilità**: `[aria-label="…"]`, `[name="…"]`, `[role="…"]`.
3. **ID stabili**: gli ID generati a runtime vengono scartati.
4. **Gerarchia**: antenato stabile + tag/attributi, ad esempio `[data-qa="channel_sidebar"] div[role="treeitem"]`.

Le classi del design system di Slack (`c-…`, `p-…`) sono accettate con priorità bassa e solo se non contengono hash, sequenze numeriche o modificatori di stato (`--selected`, `--hovered`…). Il percorso strutturale con `:nth-of-type` è l'ultima risorsa ed è segnalato come *Strutturale*.

Valori scartati come dinamici: ID Slack (`C0123ABCD`, `U02…`, `T0…`), timestamp (`1700000000.123456`), contatori, UUID, `useId()` di React (`:r1:`), prefissi CSS-in-JS (`css-`, `sc-`…), token simili a hash, `aria-label` con cifre (es. "3 nuovi messaggi").

- **Questo elemento**: il selettore più stabile che identifica **un solo** elemento.
- **Simili**: un attributo condiviso (o il prefisso stabile di un `data-qa`, es. `[data-qa^="channel_sidebar_name_"]`), possibilmente limitato al contenitore stabile più vicino; in alternativa la stessa posizione strutturale dentro l'elemento ripetuto più vicino (riga di messaggio, voce di lista).
- **Genitore**: il selettore univoco del genitore diretto.

---

## Prestazioni, sicurezza e privacy

**Prestazioni** (le liste virtualizzate di Slack aggiungono e rimuovono righe a ogni frame di scroll):

- A regime c'è **solo CSS statico**: nessun listener di scroll o di mouse quando l'ispettore è spento. Il `<style>` viene riscritto solo quando cambiano le regole.
- Il `MutationObserver` di `dom-mutations.js` esiste **solo se c'è almeno una regola collassabile attiva**. Osserva solo `childList`, raggruppa i record in un unico `requestAnimationFrame` prima del paint ed esamina solo i sottoalberi aggiunti.
- Un secondo observer sorveglia solo i figli diretti di `<head>` (senza `subtree`) per reinserire il tag `<style>` se venisse rimosso.
- Il cambio di workspace si rileva confrontando una stringa dell'URL (Navigation API + controllo ogni 1,5 s).
- Il `MutationObserver` non accumula nodi mentre la scheda o la finestra della PWA è nascosta (`requestAnimationFrame` è in pausa): oltre una soglia, o con la pagina nascosta, passa a un'unica scansione completa al ritorno.
- Durante l'ispezione hover e scroll sono limitati a un aggiornamento per frame e l'evidenziatore legge tutte le posizioni prima di scrivere; il calcolo completo dei selettori avviene solo al click, con le query sul documento messe in cache per la durata del calcolo e il selettore del genitore calcolato solo se scegli *Genitore*.

**Sicurezza**:

- Permessi minimi: solo `storage`; host solo `https://app.slack.com/*`.
- Nessuna dipendenza esterna né CDN: tutto il codice è nel pacchetto. Nessuna richiesta di rete.
- L'interfaccia nella pagina vive in **Shadow DOM** ed è costruita senza `innerHTML`: i testi provenienti da Slack o da un import non vengono mai interpretati come HTML.
- Tasti, copia/incolla e focus dentro il pannello vengono fermati a livello `window` prima che li veda Slack (es. "scrivi ovunque per andare nel compositore", <kbd>Esc</kbd> = segna come letto). Il click in modalità ispettore viene annullato prima che raggiunga Slack.
- Ogni regola viene passata al parser CSS del browser e riserializzata prima dell'iniezione: una regola malformata non può "rompere" le successive e `@import` viene ignorato. Il filtro è a prova di errore (*fail closed*): restano solo i tipi di regola noti (stile, `@media`, `@supports`, `@container`, `@layer`, `@scope`, `@starting-style`, `@font-face`, `@keyframes`). Ogni dichiarazione che potrebbe caricare una risorsa (`url()`, `image-set()`, `cross-fade()`, `src()`, anche tramite `var()` o proprietà personalizzate) viene rimossa, a meno che tutti i suoi URL siano `data:` o riferimenti `#id` in `filter`/`mask`/`clip-path`/`marker`/`fill`/`stroke`. Vengono rimossi anche gli URL relativi o verso `app.slack.com`. Gli URL sono analizzati come fa il browser, non con espressioni regolari, quindi grafie come `https:/\host` o `http:host` non passano. Un backup importato non può quindi far caricare né trapelare nulla; la CSP di Slack resta un secondo livello di protezione.
- L'import valida ogni regola (tipi, lunghezze, ambiti, valori di compattazione solo in `px`) e scarta quelle non valide.

**Privacy**: le regole e i nomi dei workspace restano in `chrome.storage.local` nel tuo profilo. Il nome del workspace è letto solo dal titolo della pagina (l'estensione non legge il `localStorage` di Slack, che contiene anche i token di sessione). Di ogni workspace si salva solo il nome, e il backup include solo i workspace che hanno regole. Nessun dato lascia il browser.

---

## Formato del backup JSON

```json
{
  "format": "slack-ui-tweaker",
  "version": 1,
  "exportedAt": "2026-10-22T09:30:00.000Z",
  "rules": {
    "global": [
      {
        "id": "r_m1abcd12xyz9",
        "selector": "[data-qa=\"huddle_button\"]",
        "action": "hide",
        "options": {},
        "css": "",
        "baseAction": null,
        "label": "Pulsante Huddle",
        "scope": "global",
        "enabled": true,
        "createdAt": 1793000000000,
        "updatedAt": 1793000000000
      }
    ],
    "T0123ABCD": [
      {
        "id": "r_m1abce34kq7p",
        "selector": "[data-qa=\"channel_header_bookmarks\"]",
        "action": "collapse",
        "options": { "collapsed": true },
        "css": "",
        "baseAction": null,
        "label": "Segnalibri del canale",
        "scope": "T0123ABCD",
        "enabled": true,
        "createdAt": 1793000000000,
        "updatedAt": 1793000000000
      }
    ]
  },
  "workspaces": { "T0123ABCD": { "name": "Acme Inc" } }
}
```

`action` può essere `hide`, `hover`, `fade`, `compact`, `collapse` o `custom`. Sono accettati anche file con un semplice array di regole, ognuna con il proprio `scope`, e i backup delle versioni precedenti (il vecchio campo `lastSeen` viene ignorato).

---

## Limiti noti e risoluzione problemi

- **Slack cambia il DOM**: se Slack rinomina un attributo `data-qa`, la regola smette di corrispondere. Nel popup il contatore mostra *0 nella vista*: usa ✎ per correggere il selettore.
- **Liste virtualizzate**: Slack crea in pagina solo gli elementi visibili, quindi il conteggio indica gli elementi presenti *ora*. Le regole valgono comunque per quelli che compariranno.
- **Collassabile**: il pulsante ▸/▾ viene inserito come fratello dell'elemento nel DOM di Slack. In layout particolari (righe flex, elementi posizionati in modo assoluto) può comparire in una posizione poco elegante: in quel caso conviene puntare il contenitore genitore.
- **Compatta (dimezza)**: i valori dimezzati vengono misurati sull'elemento cliccato al momento della creazione e applicati a tutti gli elementi della regola.
- **Schede aperte prima dell'installazione/aggiornamento**: vanno ricaricate.
- **App desktop di Slack**: non supportata (non è un browser Chromium con estensioni).
- **Il popup non trova Slack**: assicurati che la scheda attiva sia `https://app.slack.com/…`. Altri domini, come `*.slack.com` per le pagine di amministrazione, non sono inclusi. Se in `chrome://extensions` → *Dettagli* → *Accesso ai siti* hai scelto *Al clic*, Chrome concede l'accesso quando clicchi l'icona o premi la scorciatoia: ricarica la pagina di Slack se il popup lo chiede.
- **Nome del workspace mancante**: viene letto dal titolo della pagina (es. "general (Canale) - Acme Inc - Slack"). Se Slack lo imposta tardi, il popup mostra l'ID del team finché non lo riapri.
