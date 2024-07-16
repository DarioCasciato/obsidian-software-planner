## Software Planner
Das Software Planner Plugin solllte die Erstellung von Software-Onsite oder Remote Einsätzen vereinfachen. Per Obsidian Befehlszeile Sollte man die Möglichkeit haben, neue Kunden zuerstellen, einen neuen Einsatz für einen Kunden. Für Remote Einsätze Sollte das ähnlich sein. Somit spart man sich die Erstellung von Organisatorischen Files.

## Planung von Software-Einsätzen

Meine Persönlichen Kunden und deren Einsätzen sind im Obsidian drin und werden dort auch gepflegt. Jeder Kunde hat die Folgenden Ordner:

KUNDENNAME (als Ornder)
- 1. Einsätze (als Ordner, 1 -> Für Sortierung Einsätze zuoberst)
- Grundriss (als Ordner)
- Peripherie (als Ordner)

Da der Grundriss und Peripherie meist unverändert bleibt, muss man nicht für jeden Einsatz einen neuen Grundriss oder Peripherie erstellen. Diese sind im Kundenordner bereits vorhanden.

Falls ein neuer Einsatz für diesen Kunden stattfinden soll, wird im Einsätze Ordner ein Unterordner erstellt mit dem Datum als Namen (YYYY-MM-DD (in diesem Format für die Sortierung)). In diesem Ordner wird ein Unterordner "Einsatzdateien" und "WAM" erstellt (WAM = Work- und Auftragsmanagement, hier werden die Aufträge und Arbeitszeiten festgehalten). Ebenfalls wird ein Einsatz.md File erstellt, in dem die wichtigsten Informationen zum Einsatz stehen.

Momentan existiert für das ganze ein Template "Kundenordner", wo es auch darunter ein Template für einen neuen Einsatzordner gibt. Bis jetzt habe ich immer von Hand im File-Explorer die Ordner rumkopiert. Das sollte aber mit diesem Plugin automatisiert werden.

Dier Ordnerstruktur vom Template sieht wie folgt aus:

```
C:\Users\USER\Documents\obsidian-vault\1. SW-Spezialist\Kunden - Einsätze
└───zz_TEMPLATE Kunde
    ├───1. Einsätze
    │   └───YYYY-MM-DD
    │       │   Einsatz.md
    │       │
    │       ├───Einsatztdateien
    │       └───WAM
    ├───Grundriss
    └───Peripherie
```

Und ein "Ausgefüllter" Kundenordner sieht so aus (Momentan nur 1 Einsatz):

```
C:\Users\USER\Documents\obsidian-vault\1. SW-Spezialist\Kunden - Einsätze
├───Belimo Automation
│   ├───1. Einsätze
│   │   └───2024-08-31
│   │       │   Einsatz.md
│   │       │
│   │       ├───Einsatzdateien
│   │       │       Belimo Automation AG - Remoteanleitung.pdf
│   │       │       Belimo Umstellung Prime-Advant.xlsx
│   │       │
│   │       └───WAM
│   ├───Grundriss
│   │       Grundriss-2024-06-18-10_35.pdf
│   │
│   └───Peripherie
│           ControllerUndTZManager-2024-06-18-10_36.xlsx
```

Die Einsatz.md Datei sieht so aus:

```markdown
## DATUM
VORORT/REMOTE Einsatz


## Kundeninformationen

**Kunde**:

**Ort**:

**Kunde Kontaktpersonen**:
-

-----

## Termin

**Reise**:

**Datum**:

**Uhrzeit**:

-----

## Remote Zugang

**Methode**:
**VM**:
#### Login
**Username**: ``
**Passwort**: ``

------

## Projektleitung

**PL** :

**Info-Ablage**:


-----

## Auftragsbeschreibung


## Notizen


#### Checkliste
- [ ]

#### Abschluss-Checkliste:
- [ ] Mit Kunden Auftrag abschliessen
- [ ] XML erstellt & abgelegt
- [ ] Anlagen-DB gepflegt
- [ ] WAM Rapport ausgefüllt (Arbeit & Zeit)
- [ ] **Auftrag abgeschlossen**

```

Die Sollte immer gleich sein. Nur die Daten müssen angepasst werden, was aber weiterhin von Hand gemacht wird.

### Funktionen/Wunschvorstellung

Man sollte die möglichkeit haben, in der Plugineinstellung den Kundenoordner zu definieren, wo in Zukunft die Kundenordner erstellt werden sollen. Der Template Kunden Ordner sollte auch definiert werden können, wie auch der Template Einsatzordner.

#### Neuer Kunde erstellen

Mit einem Befehl in der Obsidian Befeheilszeile sollte man die Möglichkeit haben, einen neuen Kunden zu erstellen. Der Befehl sollte so aussehen:

```bash
Software Planner: Create new customer
```

Wie auch ein Alias auf deutsch:

```bash
Software Planner: Neuer Kunde erstellen
```

Bei der Ausführung dieses Befehls, sollte man gleich ein Inputfeld bekommen (Ob gleich in der Befehlszeile oder anders), wo man den Kundennamen eingeben kann. Der Ordner sollte dann erstellt werden und die Unterordner auch. Der Einsatzordner sollte noch nicht erstellt werden. Sobald der Kundenordner erstellt ist, hat man schon mal die Möglichkeit, den Grundriss und die Peripherie zu hinterlegen.

#### Neuer Einsatz erstellen

Mit einem Befehl in der Obsidian Befeheilszeile sollte man die Möglichkeit haben, einen neuen Einsatz für einen Kunden zu erstellen. Der Befehl sollte so aussehen:

```bash
Software Planner: Create new deployment
```

Wie auch ein Alias auf deutsch:

```bash
Software Planner: Neuer Einsatz erstellen
```

Bei der Ausführung dieses Befehls, sollte in der Befehlszeile ein Inputfeld erscheinen, unter dem alle bisherigen Kunden aufgelistet werden als Auswahloption. Bei der eingabe des Kunden im Inputfeld, sollte nach und nach die Liste mit fuzzy search gefiltert werden. Sobald der Kunde ausgewählt wurde, sollte ein weiteres Inputfeld erscheinen für das Datum des Einsatzes. Sobald das Datum eingegeben wurde, sollte der Einsatzordner im "1. Einsätze" Ordner des Kunden erstellt werden und die Unterordner auch. Das Einsatz.md File sollte auch erstellt werden, mit dem Datum des Einsatzes und den Kundennamen drin, wo die Platzhalter ersetzt werden (Best-case).


## Planung von Remote-Einsätzen

Bei uns haben wir das Software-Spezialist Abteil und das Remote-Abteil. Die Software-Spezialisten können ab und zu mal dem Remote-Abteil zugeteilt werden, wenn es keine Arbeit hat, oder das Remote überlastet ist.

Beim Remote wird eigentlich nicht direkt auf "Einsätze" gearbeitet, sondern auf "Aufträge". Der Tages-Ablauf eines Remote-Technikers sieht wie folgt aus:

- Um 08:00 Uhr findet die Daily-Remote Sitzung statt. Hier werden die Aufträge verteilt und besprochen. Meist bekommt jeder Techniker 3-4 Aufträge pro Tag. Aber das kann variieren. Deshalb ist die Anzahl Aufträge für das Plugin nicht relevant.
- Bei mir im Obsidian Vault habe ich einen Ordner namens "Remote - Einsätze". Da sortiere ich nicht nach Kunden, sondern nach Datum. Jeder Tag hat somit einen Ordner. Das macht so Sinn, weil die Aufträge pro Tag verteilt werden und nicht pro Kunde. Und jeder Tag wird so organisiert im Remote Abteil: Aufträge verteilen, Aufträge abarbeiten, Aufträge abschliessen. Und eben meist so 3-4, aber das spielt keine Rolle für das Plugin.
- Nachdem ich einen Tagesordner mit dem Ordnernamen "YYYY-MM-DD" erstellt habe, erstelle ich für jeden Kunden/Auftrag einen separaten Ordner. Die Ordner namen sind meist "KUNDENNAME - KURZFASSUNG AUFTRAG". Das kann dann etwa so aussehen "Belimo Automation - Updateterminal Parametrieren". In diesem Ordner erstelle ich dann ein Auftrag.md File, wo wie auch ähnlich bei den Software-Einsätzen, die wichtigsten Informationen zum Auftrag stehen. Und ein Unterordner "Files", wo ich einfach relevante Files für den Auftrag ablegen kann.

Zum Schluss erstelle ich mit dem "Kanban Board" Plugin für Obsidian einen zeitplan, wo ich die Aufträge festhalten kann, und mir so ein wenig meine Aufträge visualisiert planen kann.

Die Ordnerstruktur vom Template (Ich habe auch hier ein Template für Remote-Einsätze) sieht so aus:

```bash
C:\Users\USER\Documents\obsidian-vault\1. SW-Spezialist\Remote - Einsätze
└───_ TEMPLATE YYYY-MM-DD
    │   - Zeitplan.md
    │
    └───KUNDE - AUFTRAG
        │   Auftrag.md
        │
        └───Files
```

Und ein "Ausgefüllter" Remote-Ordner sieht so aus:

```bash
C:\Users\USER\Documents\obsidian-vault\1. SW-Spezialist\Remote - Einsätze
├───2024-07-16
│   │   Zeitplan.md
│   │
│   ├───Bär & Karrer Rechtsanwälte - Migration AMC
│   │   │   Auftrag.md
│   │   │
│   │   └───Files
│   │           170903_DL1_3OG_250_bearb_4.jpg
│   │           170903_DL1_3OG_250_bearb_4.wmf
│   │           170903_DL1_3OG_250_bearb_5.zip
│   │           Alter Grundriss mit Türen.PNG
│   │           Grundriss 3.OG für Grafikapplikation.pdf
│   │
│   └───Kantonsschule Wiedikon - Updateterminal
│       │   Auftrag.md
│       │
│       └───Files
│               ControllerDoc_B-Web9600_10.pdf
│               ControllerDoc_B-Web9600_11.pdf
```

Das Auftrag.md File sieht so aus:

```markdown
## Kundeninformationen

**Kunde**:

**Ort**:

**Kunde Kontaktpersonen**:
-

**Zeitpunkt**:

-----

## Remote Zugang

**Methode**:
**VM**:
#### Login
**Username**: ``
**Passwort**: ``

------

## Projektleitung

**PL** :

**Info-Ablage**:

-----

## Techniker

**HW-Techniker**:
-

- [ ] Erster Infoaustausch (Tel oder Mail)

**Vereinbarte Uhrzeit**:

**Arbeit von HW-Techniker**:

**Notizen**:


-----

## Auftragsbeschreibung


## Notizen


#### Checkliste
- [ ] XML anschauen
- [ ]


#### Abschluss-Checkliste:
- [ ] Mit Kunden Auftrag abschliessen
- [ ] HW-Techniker Auftrag abschliessen
- [ ] XML erstellt & abgelegt
- [ ] Anlagen-DB gepflegt
- [ ] WAM Rapport ausgefüllt (Arbeit & Zeit)
- [ ] **Auftrag abgeschlossen**
```

Die Sollte immer gleich sein. Nur die Daten müssen angepasst werden, was aber weiterhin von Hand gemacht wird.


Der Zeitplan, welcher im übergeordneten Ordner (Datum) erstellt wird, sieht so aus:

```markdown

## Aufträge

- [ ] 1. KUNDE - AUFTRAG


## On Hold



## Progress



## Abwarten



## Done





%% kanban:settings
```
{"kanban-plugin":"board","list-collapse":[false,false,false,false,false]}
```
%%
```

### Funktion/Wunschvorstellung

Man sollte die Möglichkeit haben, in der Plugineinstellung den Remote-Ordner zu definieren, wo in Zukunft die Remote-Ordner erstellt werden sollen. Der Template Remote-Ordner sollte auch definiert werden können. Wie auch der Template Auftragordner.

#### Neuer Remote-Tag erstellen

Mit einem Befehl in der Obsidian Befehlszeile sollte man die Möglichkeit haben, einen neuen Remote-Tag zu erstellen. Der Befehl sollte so aussehen:

```bash
Software Planner: Create new remote day
```

Wie auch ein Alias auf deutsch:

```bash
Software Planner: Neuer Remote-Tag erstellen
```

Bei der Ausführung dieses Befehls, sollte ein Inputfeld erscheinen, wo man das Datum eingeben kann. Der Ordner sollte dann erstellt werden mit dem Zeitplan.md. Der Ordner sollte im Remote-Ordner erstellt werden.

#### Neuer Remote-Auftrag erstellen

Mit einem Befehl in der Obsidian Befehlszeile sollte man auch die Möglichkeit haben, einen neuen Remote-Auftrag zu erstellen. Der Befehl sollte so aussehen:

```bash
Software Planner: Create new remote deployment
```

Wie auch ein Alias auf deutsch:

```bash
Software Planner: Neuer Remote-Auftrag erstellen
```

Bei der Ausführung dieses Befehls, sollte in der Befehlszeile ein Inputfeld erscheinen, unter dem alle bisherigen Remote-Tage aufgelistet werden als Auswahloption. Der neuste Remote-Tag sollte immer zuoberst sein. Bei der eingabe des Remote-Tages im Inputfeld, sollte nach und nach die Liste mit fuzzy search gefiltert werden. Sobald der Remote-Tag ausgewählt wurde, sollte ein weiteres Inputfeld erscheinen für den Kunden und den Auftrag (Einfach ein Feld). Sobald der Kunde und der Auftrag eingegeben wurde, sollte der Auftragordner im Remote-Tag erstellt werden und die Unterordner auch. Das Auftrag.md File sollte auch erstellt werden, mit dem Kundennamen und dem Auftrag drin, wo die Platzhalter ersetzt werden (Best-case).