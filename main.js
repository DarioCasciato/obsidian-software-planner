const { Plugin, PluginSettingTab, Setting, Notice, Modal, MarkdownRenderer, TFile } = require('obsidian');

const { remote } = require('electron');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');

// Default settings
const DEFAULT_SETTINGS = {
    customerTemplatePath: '',
    customerDestinationPath: '',
    remoteDayTemplatePath: '',
    remoteDayDestinationPath: '',
    deploymentTemplatePath: '',
    remoteTaskTemplatePath: '',
    xmlProgramPath: ''
};

// Utility function to copy folders
async function copyFolder(src, dest) {
    if (!fs.existsSync(dest)) {
        fs.mkdirSync(dest, { recursive: true });
    }

    const entries = fs.readdirSync(src, { withFileTypes: true });

    for (let entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);

        if (entry.isDirectory()) {
            await copyFolder(srcPath, destPath);
        } else {
            fs.copyFileSync(srcPath, destPath);
        }
    }
}

// Utility function to get existing folders
function getExistingFolders(basePath) {
    if (!fs.existsSync(basePath)) return [];
    return fs.readdirSync(basePath, { withFileTypes: true })
        .filter(entry => entry.isDirectory())
        .map(entry => entry.name);
}


// Utility function to create and update the task file
async function createUpdatedTaskFile(templatePath, destinationPath, customerName) {
    let taskContent = await fs.promises.readFile(templatePath, 'utf8');
    taskContent = taskContent.replace('**Kunde**:', `**Kunde**: ${customerName}`);
    await fs.promises.writeFile(destinationPath, taskContent, 'utf8');
}

// Settings tab
class SoftwarePlannerSettingTab extends PluginSettingTab {
    constructor(app, plugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display() {
        const { containerEl } = this;
        containerEl.empty();

        containerEl.createEl('h2', { text: 'Software Planner Plugin Einstellungen' });

        // Software Settings
        containerEl.createEl('h3', { text: 'Software Einstellungen' });

        this.addPathSetting(containerEl, 'Kunden Vorlagenpfad', 'customerTemplatePath');
        this.addPathSetting(containerEl, 'Kundeneinsatz Vorlagenpfad', 'deploymentTemplatePath');
        this.addPathSetting(containerEl, 'Kunden Zielverzeichnispfad', 'customerDestinationPath');

        // Remote Settings
        containerEl.createEl('h3', { text: 'Remote Settings' });

        this.addPathSetting(containerEl, 'Remote Tag Vorlagenpfad', 'remoteDayTemplatePath');
        this.addPathSetting(containerEl, 'Remote Auftrag Vorlagenpfad', 'remoteTaskTemplatePath');
        this.addPathSetting(containerEl, 'Remote Tag Zielverzeichnis Pfad', 'remoteDayDestinationPath');

        // XML Program Path
        containerEl.createEl('h3', { text: 'XMLVisualizer Einstellungen' });

        this.addPathSetting(containerEl, 'XMLVisualizer Pfad', 'xmlProgramPath');
    }

    addPathSetting(containerEl, name, settingKey) {
        new Setting(containerEl)
            .setName(name)
            .setDesc(`Pfad zu ${name}`)
            .addText(text => text
                .setPlaceholder('Pfad angeben')
                .setValue(this.plugin.settings[settingKey] || '')
                .onChange(async (value) => {
                    this.plugin.settings[settingKey] = value;
                    await this.plugin.saveSettings();
                }))
            .addButton(button => button
                .setButtonText('Durchsuchen')
                .setCta()
                .onClick(async () => {
                    const properties = name === 'XMLVisualizer Pfad' ? ['openFile'] : ['openDirectory'];
                    const result = await remote.dialog.showOpenDialog({
                        properties: properties
                    });
                    if (!result.canceled) {
                        const selectedPath = result.filePaths[0];
                        const vaultPath = this.app.vault.adapter.basePath;
                        const relativePath = path.relative(vaultPath, selectedPath);

                        this.plugin.settings[settingKey] = relativePath;
                        await this.plugin.saveSettings();
                        this.display(); // Refresh the settings to show updated path
                    }
                }));
    }
}

// Main plugin class
class SoftwarePlanner extends Plugin {
    async onload() {
        console.log('Software Planner Plugin wird geladen');

        // Load settings
        await this.loadSettings();

        // Add settings tab
        this.addSettingTab(new SoftwarePlannerSettingTab(this.app, this));

        // Register commands
        this.registerCommands();

        // Create ribbon icons
        this.createRibbonIcons();

        // Add XML file extension support
        this.addXMLFileExtension();

        // Kalender-Befehl registrieren
        this.addCommand({
            id: 'open-calendar',
            name: 'Planner-Kalender öffnen',
            callback: () => this.openCalendar()
        });

        // Kalender-Symbol zum Ribbon hinzufügen
        this.addRibbonIcon('calendar', 'Planner-Kalender öffnen', () => this.openCalendar());

        // Initialize calendarModalInstance
        this.calendarModalInstance = null;

        // Initialize Status Bar Button
        this.neuerAuftragButton = null;

        // Listen to active file changes
        this.registerEvent(this.app.workspace.on('active-leaf-change', this.onActiveLeafChange.bind(this)));
    }

    onunload() {
        console.log('Software Planner Plugin wird entladen');
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    async createNewRemoteDayPrompt() {
        const dateStr = await this.promptSingleDate('Datum des Remote-Tags eingeben (YYYY-MM-DD)');
        if (!dateStr) {
            new Notice('Kein Datum eingegeben.');
            return;
        }
        await this.createNewRemoteDay(dateStr);
    }

    registerCommands() {
        this.addCommand({
            id: 'create-new-customer',
            name: 'Neuer Kunde erstellen',
            callback: () => this.createNewCustomer()
        });

        this.addCommand({
            id: 'create-new-remote-day',
            name: 'Neuen Remote-Tag erstellen',
            callback: async () => {
                const dateStr = await this.promptSingleDate('Datum des Remote-Tags auswählen');
                if (dateStr) {
                    await this.createNewRemoteDay(dateStr);
                }
            }
        });

        this.addCommand({
            id: 'create-new-deployment',
            name: 'Neuen Einsatz erstellen',
            callback: () => this.createNewDeployment()
        });

        this.addCommand({
            id: 'create-new-remote-task',
            name: 'Neuen Remote-Auftrag erstellen',
            callback: () => this.createNewRemoteTask()
        });

        this.addCommand({
            id: 'check-remote-tasks',
            name: 'Check Remote auf nicht abgeschlossene Aufträge',
            callback: () => this.checkRemoteTasks()
        });

        this.addCommand({
            id: 'archive-remote-days',
            name: 'Remote-Tage Archivieren',
            callback: () => this.archiveOldRemoteDays()
        });
    }

    createRibbonIcons() {
        this.addRibbonIcon('user-plus', 'Neuer Kunde', () => this.createNewCustomer());
        this.addRibbonIcon('log-out', 'Neuer Einsatz', () => this.createNewDeployment());
        // Ribbon Icon für "Neuen Remote-Tag" aktualisieren
        this.addRibbonIcon('screen-share', 'Neuer Remote-Tag', async () => {
            const dateStr = await this.promptSingleDate('Datum des Remote-Tags auswählen');
            if (dateStr) {
                await this.createNewRemoteDay(dateStr);
            }
        });
        this.addRibbonIcon('clipboard-check', 'Neuer Remote-Auftrag', () => this.createNewRemoteTask());
        this.addRibbonIcon('check', 'Check Remote Aufträge', () => this.checkRemoteTasks());
        this.addRibbonIcon('archive', 'Alte Remote-Tage archivieren', () => this.archiveOldRemoteDays());
        this.addRibbonIcon('calendar', 'Planner-Kalender öffnen', () => this.openCalendar());
    }

    async openFile(filePath) {
        const filePathInVault = path.relative(this.app.vault.adapter.basePath, filePath).replace(/\\/g, '/');
        const file = this.app.vault.getAbstractFileByPath(filePathInVault);

        if (file && file instanceof TFile) {
            await this.app.workspace.getLeaf().openFile(file);
        } else {
            new Notice('Datei nicht gefunden.');
        }
    }

    async createNewCustomer() {
        if (!this.settings.customerTemplatePath || !this.settings.customerDestinationPath) {
            new Notice('Setze die Kunden Vorlage- und Zielpfäde in den Einstellungen.');
            return;
        }

        const customerName = await this.promptUser('Kundennamen eingeben');
        if (!customerName) return;

        const customerPath = path.join(this.app.vault.adapter.basePath, this.settings.customerDestinationPath, customerName);
        const templatePath = path.join(this.app.vault.adapter.basePath, this.settings.customerTemplatePath);

        try {
            await copyFolder(templatePath, customerPath);
            new Notice(`Kundenordner erstellt: ${customerName}`);
        } catch (error) {
            console.error(`Fehler beim Erstellen vom Kundenordner: ${error.message}`);
            new Notice(`Fehler beim Erstellen vom Kundenordner: ${error.message}`);
        }
    }

    async createNewRemoteDay(dateStr) {
        if (!this.settings.remoteDayDestinationPath) {
            new Notice('Remote Tag Zielverzeichnis Pfad ist nicht gesetzt. Bitte überprüfen Sie die Einstellungen.');
            return;
        }

        // Entfernt abschließende Slashes aus dem Zielpfad
        const remoteDayDestinationPath = this.settings.remoteDayDestinationPath.replace(/\/+$/, '');
        const remoteDayPath = path.join(this.app.vault.adapter.basePath, remoteDayDestinationPath, dateStr);
        const templatePath = path.join(this.app.vault.adapter.basePath, this.settings.remoteDayTemplatePath);

        try {
            await copyFolder(templatePath, remoteDayPath);
            new Notice(`Remote-Tag erstellt: ${dateStr}`);

            // Öffne die Zeitplan.md Datei
            const scheduleFilePath = path.join(remoteDayPath, 'Zeitplan.md');
            await this.openFile(scheduleFilePath);

            // Manuelles Aufrufen von onActiveLeafChange zur Sicherstellung der Aktualisierung
            this.onActiveLeafChange();
        } catch (error) {
            console.error(`Fehler beim Erstellen des Remote-Tags: ${error.message}`);
            new Notice(`Fehler beim Erstellen des Remote-Tags: ${error.message}`);
        }
    }

    onActiveLeafChange() {
        const activeFile = this.app.workspace.getActiveFile();
        if (activeFile && this.isScheduleFile(activeFile)) {
            const date = this.getDateFromScheduleFile(activeFile);
            if (date) {
                this.addNeuerAuftragButton(date);
            } else {
                console.error('Datum konnte aus dem aktiven Zeitplan nicht extrahiert werden.');
                this.removeNeuerAuftragButton();
            }
        } else {
            this.removeNeuerAuftragButton();
        }
    }


    async createNewDeployment() {
        if (!this.settings.deploymentTemplatePath || !this.settings.customerDestinationPath) {
            new Notice('Setze die Einsatzvorlage und den Kundenzielpfad in den Einstellungen.');
            return;
        }

        const customers = getExistingFolders(path.join(this.app.vault.adapter.basePath, this.settings.customerDestinationPath));

        const customerName = await this.promptDropdown(
            'Kunden wählen',
            customers,
            false,
            null,
            true, // allowNewCustomer
            async (newCustomerName) => {
                await this.createNewCustomerWithName(newCustomerName);
            }
        );
        if (!customerName) return;

        const deploymentDates = await this.promptDateRange('Startdatum des Einsatzes angeben (YYYY-MM-DD)');
        if (!deploymentDates) return;

        const folderName = deploymentDates.endDate
            ? `${deploymentDates.startDate} - ${deploymentDates.endDate}`
            : deploymentDates.startDate;

        const customerPath = path.join(this.app.vault.adapter.basePath, this.settings.customerDestinationPath, customerName, '1. Einsätze', folderName);
        const templatePath = path.join(this.app.vault.adapter.basePath, this.settings.deploymentTemplatePath);

        try {
            await copyFolder(templatePath, customerPath);
            await this.updateEinsatzMd(path.join(customerPath, 'Einsatz.md'), customerName, deploymentDates.startDate);
            new Notice(`Einsatz erstellt für ${customerName} vom ${folderName}`);
        } catch (error) {
            console.error(`Fehler beim Erstellen des Einsatzes: ${error.message}`);
            new Notice(`Fehler beim Erstellen des Einsatzes: ${error.message}`);
        }
    }


    async createNewRemoteTask() {
        if (!this.settings.remoteTaskTemplatePath || !this.settings.remoteDayDestinationPath) {
            new Notice('Setze die Remote-Auftrag Vorlage und den Remote-Tag Zielpfad in den Einstellungen.');
            return;
        }

        const remoteDays = getExistingFolders(path.join(this.app.vault.adapter.basePath, this.settings.remoteDayDestinationPath));
        const remoteDay = await this.promptDropdown('Wähle Remote-Tag', remoteDays, true, (date) => remoteDays.includes(date));
        if (!remoteDay) return;

        const taskName = await this.promptUser('Auftragsnamen eingeben');
        if (!taskName) return;

        const remoteTaskPath = path.join(this.app.vault.adapter.basePath, this.settings.remoteDayDestinationPath, remoteDay, taskName);
        const templatePath = path.join(this.app.vault.adapter.basePath, this.settings.remoteTaskTemplatePath);
        const schedulePath = path.join(this.app.vault.adapter.basePath, this.settings.remoteDayDestinationPath, remoteDay, 'Zeitplan.md');
        const taskFilePath = path.join(remoteTaskPath, 'Auftrag.md');
        const taskFileTemplatePath = path.join(templatePath, 'Auftrag.md');

        try {
            await copyFolder(templatePath, remoteTaskPath);
            await addTaskToSchedule(schedulePath, taskName);
            await createUpdatedTaskFile(taskFileTemplatePath, taskFilePath, taskName);
            new Notice(`Remote Auftragsordner erstellt für ${taskName} am ${remoteDay}`);
        } catch (error) {
            console.error(`Fehler beim Erstellen des Remote Auftrags: ${error.message}`);
            new Notice(`Fehler beim Erstellen des Remote Auftrags: ${error.message}`);
        }
    }

    async archiveOldRemoteDays() {
        const basePath = path.join(this.app.vault.adapter.basePath, this.settings.remoteDayDestinationPath);
        const archivePath = path.join(basePath, '_Archiv');

        // Archiv-Ordner erstellen, falls er nicht existiert
        if (!fs.existsSync(archivePath)) {
            fs.mkdirSync(archivePath);
        }

        const remoteDays = getExistingFolders(basePath);
        const oneWeekAgo = new Date();
        oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

        for (let remoteDay of remoteDays) {
            const remoteDayDate = new Date(remoteDay);
            if (!isNaN(remoteDayDate) && remoteDayDate < oneWeekAgo) {
                const sourcePath = path.join(basePath, remoteDay);
                const destinationPath = path.join(archivePath, remoteDay);

                fs.renameSync(sourcePath, destinationPath);
            }
        }

        new Notice('Archivierung abgeschlossen.');
    }

    async checkRemoteTasks() {
        const basePath = path.join(this.app.vault.adapter.basePath, this.settings.remoteDayDestinationPath);
        const archivePath = path.join(basePath, '_Archiv');
        let reportContent = '\n';

        // Alle Remote-Tage im Hauptordner und im Archiv-Ordner durchsuchen
        const remoteDays = getExistingFolders(basePath).concat(getExistingFolders(archivePath));

        for (let remoteDay of remoteDays) {
            // Pfad zum Zeitplan des Remote-Tages erstellen
            const schedulePathMain = path.join(basePath, remoteDay, 'Zeitplan.md');
            const schedulePathArchive = path.join(archivePath, remoteDay, 'Zeitplan.md');
            const schedulePath = fs.existsSync(schedulePathMain) ? schedulePathMain : schedulePathArchive;

            if (fs.existsSync(schedulePath)) {
                const scheduleContent = await fs.promises.readFile(schedulePath, 'utf8');

                const tasksInProgress = this.extractInProgressTasks(scheduleContent);
                if (tasksInProgress.length > 0) {
                    // Erstelle einen Link zum Zeitplan des entsprechenden Remote-Tages
                    const linkPrefix = schedulePath.includes('_Archiv') ? `_Archiv/${remoteDay}` : remoteDay;
                    reportContent += `## [[${linkPrefix}/Zeitplan|${remoteDay}]]\n\n`;
                    tasksInProgress.forEach(task => {
                        reportContent += `${task}\n`;
                    });
                    reportContent += '\n';
                }
            }
        }

        const reportFilePath = path.join(basePath, 'Nicht abgeschlossene Aufträge.md');
        // Berichterstellung und Überschreiben der Datei, wenn sie existiert
        await fs.promises.writeFile(reportFilePath, reportContent, 'utf8');
        new Notice('Überprüfung abgeschlossen. Bericht erstellt.');
    }

    extractInProgressTasks(scheduleContent) {
        const ignoredSections = ['Done', 'Abgebrochen'];
        let inProgressTasks = [];

        const sections = scheduleContent.split('##');

        sections.forEach(section => {
            let sectionHeader = section.split('\n')[0].trim();

            // Prüfen, ob der Abschnitt ignoriert werden soll
            if (!ignoredSections.some(ignored => sectionHeader.includes(ignored))) {
                const lines = section.split('\n');
                for (let line of lines) {
                    if (line.includes('- [ ]')) {
                        inProgressTasks.push(line.trim());
                    }
                }
            }
        });

        return inProgressTasks;
    }

    async updateEinsatzMd(einsatzFilePath, customerName, deploymentDate) {
        try {
            let content = await fs.promises.readFile(einsatzFilePath, 'utf8');

            // Kunde und Datum in den Einsatz.md-Inhalt einfügen
            content = content.replace('**Kunde**:', `**Kunde**: ${customerName}`);
            content = content.replace('**Datum**:', `**Datum**: ${deploymentDate}`);

            await fs.promises.writeFile(einsatzFilePath, content, 'utf8');
        } catch (error) {
            console.error(`Fehler beim Aktualisieren der Einsatz.md: ${error.message}`);
            new Notice(`Fehler beim Aktualisieren der Einsatz.md: ${error.message}`);
        }
    }

    async promptUser(promptText) {
        return new Promise((resolve) => {
            const modal = new PromptModal(this.app, promptText, resolve);
            modal.open();
        });
    }

    async promptSingleDate(promptText) {
        return new Promise((resolve) => {
            const modal = new SingleDatePromptModal(this.app, promptText, resolve);
            modal.open();
        });
    }

    async promptDateRange(promptText, defaultStartDate = null, defaultMultiDay = false) {
        return new Promise((resolve) => {
            const modal = new DateRangePromptModal(this.app, promptText, resolve, defaultStartDate, defaultMultiDay);
            modal.open();
        });
    }

    async promptDropdown(promptText, options, showTodayButton = false, validateTodayCallback = null, allowNewCustomer = false, createNewCustomerCallback = null) {
        return new Promise((resolve) => {
            const modal = new DropdownModal(this.app, promptText, options, resolve, showTodayButton, validateTodayCallback, allowNewCustomer, createNewCustomerCallback);
            modal.open();
        });
    }

    // Neue Hilfsmethode zum Anzeigen einer Bestätigungsaufforderung
    async promptConfirm(promptText) {
        return new Promise((resolve) => {
            const modal = new ConfirmPromptModal(this.app, promptText, resolve);
            modal.open();
        });
    }

    // Add XML file extension support
    addXMLFileExtension() {
        this.registerExtensions(['xml'], 'markdown');

        this.registerEvent(
            this.app.workspace.on('file-open', (file) => {
                if (file && file.extension === 'xml') {
                    this.showXMLConfirmDialog(file);
                }
            })
        );
    }

    // Show confirmation dialog to open XML file
    showXMLConfirmDialog(file) {
        const xmlProgramPath = this.settings.xmlProgramPath;
        if (!xmlProgramPath) {
            new Notice('Kein XMLVisualizer Programm hinterlegt. Überprüfe die Einstellungen.');
            return;
        }

        const filePath = path.join(this.app.vault.adapter.basePath, file.path);
        const activeLeaf = this.app.workspace.activeLeaf;

        const modal = new ConfirmModal(this.app, 'XML öffnen im XML Visualizer', () => {
            // Schließe das aktive Leaf sofort
            if (activeLeaf && activeLeaf.view.file && activeLeaf.view.file.path === file.path) {
                activeLeaf.detach(); // Das Leaf (Tab) sofort schließen
            }

            // Startet das externe Programm
            exec(`"${xmlProgramPath}" "${filePath}"`, (error) => {
                if (error) {
                    console.error(`Fehler beim Öffnen des XML-Files: ${error.message}`);
                    new Notice(`Fehler beim Öffnen des XML-Files: ${error.message}`);
                }
            });
        });
        modal.open();
    }

    // Methode zum Öffnen des Kalenders
    openCalendar() {
        this.calendarModalInstance = new CalendarModal(this.app, this);
        this.calendarModalInstance.open();
    }

    // Methoden zum Abrufen der Einsatz- und Remote-Daten
    getDeploymentDates() {
        const customerBasePath = path.join(this.app.vault.adapter.basePath, this.settings.customerDestinationPath);
        const customers = getExistingFolders(customerBasePath);

        let deploymentDates = {};
        for (const customer of customers) {
            const deploymentsPath = path.join(customerBasePath, customer, '1. Einsätze');
            const deployments = getExistingFolders(deploymentsPath);

            for (const deployment of deployments) {
                // Überprüfen, ob der Einsatzordner ein Datum oder einen Datumsbereich enthält
                const dateRangeRegex = /^(\d{4}-\d{2}-\d{2})(?:\s*-\s*(\d{4}-\d{2}-\d{2}))?$/;
                const match = deployment.match(dateRangeRegex);

                if (match) {
                    const startDateStr = match[1];
                    const endDateStr = match[2] || startDateStr; // Wenn kein Enddatum, nur Startdatum verwenden

                    const startDate = new Date(startDateStr);
                    const endDate = new Date(endDateStr);

                    // Prüfen, ob es sich um einen mehrtägigen Einsatz handelt
                    const isSingleDay = startDateStr === endDateStr;

                    // Alle Tage zwischen Start- und Enddatum sammeln
                    let currentDate = new Date(startDate);
                    while (currentDate <= endDate) {
                        const currentDayOfWeek = currentDate.getDay(); // Sonntag = 0, Montag = 1, ..., Samstag = 6

                        // Bei mehrtägigen Einsätzen Wochenenden ausschließen
                        if (isSingleDay || (currentDayOfWeek !== 0 && currentDayOfWeek !== 6)) {
                            const dateStr = currentDate.toISOString().split('T')[0];

                            if (!deploymentDates[dateStr]) {
                                deploymentDates[dateStr] = [];
                            }

                            // Pfad zur Einsatz.md Datei
                            const einsatzMdPath = path.join(this.app.vault.adapter.basePath, this.settings.customerDestinationPath, customer, '1. Einsätze', deployment, 'Einsatz.md');

                            let completed = false;
                            try {
                                const einsatzContent = fs.readFileSync(einsatzMdPath, 'utf8');
                                completed = einsatzContent.includes('- [x] **Auftrag abgeschlossen**');
                            } catch (error) {
                                console.error(`Fehler beim Lesen von ${einsatzMdPath}: ${error.message}`);
                            }

                            deploymentDates[dateStr].push({
                                customerName: customer,
                                folderName: deployment,
                                completed: completed
                            });
                        }

                        // Zum nächsten Tag wechseln
                        currentDate.setDate(currentDate.getDate() + 1);
                    }
                }
            }
        }
        return deploymentDates;
    }




    getRemoteDates() {
        const remoteBasePath = path.join(this.app.vault.adapter.basePath, this.settings.remoteDayDestinationPath);
        const archivePath = path.join(remoteBasePath, '_Archiv');

        let remoteDays = [];

        // Remote-Tage aus dem Hauptordner sammeln
        if (fs.existsSync(remoteBasePath)) {
            remoteDays = remoteDays.concat(getExistingFolders(remoteBasePath));
        }

        // Remote-Tage aus dem Archivordner sammeln
        if (fs.existsSync(archivePath)) {
            remoteDays = remoteDays.concat(getExistingFolders(archivePath));
        }

        let remoteDates = {};
        for (const day of remoteDays) {
            if (day.match(/^\d{4}-\d{2}-\d{2}$/)) {
                remoteDates[day] = true;
            }
        }
        return remoteDates;
    }

    // Methoden zum Erstellen von Einsätzen oder Remote-Tagen mit vorgegebenem Datum
    async createNewDeploymentWithDate(deploymentDate) {
        if (!this.settings.deploymentTemplatePath || !this.settings.customerDestinationPath) {
            new Notice('Setze die Einsatzvorlage und den Kundenzielpfad in den Einstellungen.');
            return;
        }

        const customers = getExistingFolders(path.join(this.app.vault.adapter.basePath, this.settings.customerDestinationPath));

        const customerName = await this.promptDropdown(
            'Kunden wählen',
            customers,
            false,
            null,
            true, // allowNewCustomer
            async (newCustomerName) => {
                await this.createNewCustomerWithName(newCustomerName);
            }
        );
        if (!customerName) return;

        const deploymentDates = await this.promptDateRange('Startdatum des Einsatzes angeben (YYYY-MM-DD)', deploymentDate);
        if (!deploymentDates) return;

        const folderName = deploymentDates.endDate
            ? `${deploymentDates.startDate} - ${deploymentDates.endDate}`
            : deploymentDates.startDate;

        const customerPath = path.join(
            this.app.vault.adapter.basePath,
            this.settings.customerDestinationPath,
            customerName,
            '1. Einsätze',
            folderName
        );
        const templatePath = path.join(this.app.vault.adapter.basePath, this.settings.deploymentTemplatePath);

        try {
            await copyFolder(templatePath, customerPath);
            await this.updateEinsatzMd(path.join(customerPath, 'Einsatz.md'), customerName, deploymentDates.startDate);
            new Notice(`Einsatz erstellt für ${customerName} vom ${folderName}`);
        } catch (error) {
            console.error(`Fehler beim Erstellen des Einsatzes: ${error.message}`);
            new Notice(`Fehler beim Erstellen des Einsatzes: ${error.message}`);
        }

        if (this.calendarModalInstance) {
            this.calendarModalInstance.refreshCalendar();
        }
    }


    async createNewRemoteDayWithDate(remoteDay) {
        if (!this.settings.remoteDayTemplatePath || !this.settings.remoteDayDestinationPath) {
            new Notice('Setze die Remote-Tag Vorlage- und Zielpfäde in den Einstellungen.');
            return;
        }

        const remoteDayPath = path.join(this.app.vault.adapter.basePath, this.settings.remoteDayDestinationPath, remoteDay);
        const templatePath = path.join(this.app.vault.adapter.basePath, this.settings.remoteDayTemplatePath);

        // Prüfen, ob der Remote-Tag bereits existiert
        if (fs.existsSync(remoteDayPath)) {
            new Notice(`Remote-Tag für ${remoteDay} existiert bereits.`);
            return;
        }

        try {
            await copyFolder(templatePath, remoteDayPath);
            new Notice(`Remote-Tag Ordner erstellt: ${remoteDay}`);
        } catch (error) {
            console.error(`Fehler beim Erstellen des Remote-Tag Ordners: ${error.message}`);
            new Notice(`Fehler beim Erstellen des Remote-Tag Ordners: ${error.message}`);
        }

        // Aktualisiere den Kalender, falls er geöffnet ist
        if (this.calendarModalInstance) {
            this.calendarModalInstance.refreshCalendar();
        }
    }

    // Methode zum Öffnen des CreateActionModals
    openCreateModal(dateStr) {
        const modal = new ChooseActionModal(this.app, dateStr, this);
        modal.open();
    }

    async openDeploymentFile(deployment) {
        // Basis-Pfad zum Vault
        const baseVaultPath = this.app.vault.adapter.basePath;

        // Pfad zum Einsatzordner korrekt konstruieren
        const deploymentFolderPath = path.join(
            baseVaultPath,
            this.settings.customerDestinationPath,
            deployment.customerName,
            '1. Einsätze',
            deployment.folderName
        );

        // Pfad zur Datei 'Einsatz.md' im Einsatzordner
        const deploymentFilePath = path.join(deploymentFolderPath, 'Einsatz.md');

        // Überprüfen, ob 'Einsatz.md' existiert
        if (!fs.existsSync(deploymentFilePath)) {
            new Notice('Einsatz.md existiert nicht.');
            return;
        }

        // Pfad relativ zum Vault erhalten
        const filePathInVault = path.relative(baseVaultPath, deploymentFilePath).replace(/\\/g, '/');

        // Datei in Obsidian abrufen
        const file = this.app.vault.getAbstractFileByPath(filePathInVault);

        if (file && file instanceof TFile) {
            // Datei in neuem Tab öffnen
            await this.app.workspace.getLeaf().openFile(file);

            // Kalenderansicht schließen
            if (this.calendarModalInstance) {
                this.calendarModalInstance.close();
                this.calendarModalInstance = null; // Optional: Instanz auf null setzen
            }
        } else {
            new Notice('Einsatz.md nicht gefunden.');
        }
    }


    async openRemoteSchedule(dateStr) {
        // Basis-Pfad zum Vault
        const baseVaultPath = this.app.vault.adapter.basePath;

        // Pfad zum Remote-Tag Basisordner
        const remoteDayBasePath = path.join(baseVaultPath, this.settings.remoteDayDestinationPath);

        // Pfad zum Remote-Tag Ordner
        let remoteDayPath = path.join(remoteDayBasePath, dateStr);

        // Pfad zur Datei 'Zeitplan.md' im Remote-Tag Ordner
        let scheduleFilePath = path.join(remoteDayPath, 'Zeitplan.md');

        // Überprüfen, ob 'Zeitplan.md' existiert
        if (!fs.existsSync(scheduleFilePath)) {
            // Wenn nicht, im '_Archiv'-Ordner nachsehen
            remoteDayPath = path.join(remoteDayBasePath, '_Archiv', dateStr);
            scheduleFilePath = path.join(remoteDayPath, 'Zeitplan.md');
        }

        // Endgültige Überprüfung, ob 'Zeitplan.md' existiert
        if (!fs.existsSync(scheduleFilePath)) {
            new Notice('Zeitplan.md existiert nicht.');
            return;
        }

        // Pfad relativ zum Vault erhalten
        const filePathInVault = path.relative(baseVaultPath, scheduleFilePath).replace(/\\/g, '/');


        // Datei in Obsidian abrufen
        const file = this.app.vault.getAbstractFileByPath(filePathInVault);

        if (file && file instanceof TFile) {
            // Datei in neuem Tab öffnen
            await this.app.workspace.getLeaf().openFile(file);

            // Kalenderansicht schließen
            if (this.calendarModalInstance) {
                this.calendarModalInstance.close();
                this.calendarModalInstance = null; // Optional: Instanz auf null setzen
            }
        } else {
            new Notice('Zeitplan.md nicht gefunden.');
        }
    }

    async createNewCustomerWithName(customerName) {
        if (!this.settings.customerTemplatePath || !this.settings.customerDestinationPath) {
            new Notice('Setze die Kunden Vorlage- und Zielpfäde in den Einstellungen.');
            return;
        }

        const customerPath = path.join(this.app.vault.adapter.basePath, this.settings.customerDestinationPath, customerName);
        const templatePath = path.join(this.app.vault.adapter.basePath, this.settings.customerTemplatePath);

        try {
            await copyFolder(templatePath, customerPath);
            new Notice(`Kundenordner erstellt: ${customerName}`);
        } catch (error) {
            console.error(`Fehler beim Erstellen vom Kundenordner: ${error.message}`);
            new Notice(`Fehler beim Erstellen vom Kundenordner: ${error.message}`);
        }
    }

    // Utility function to add task to schedule
    async addTaskToSchedule(schedulePath, taskName) {
        let scheduleContent = await fs.promises.readFile(schedulePath, 'utf8');
        const taskSection = '## Aufträge\n\n';
        const insertIndex = scheduleContent.indexOf(taskSection) + taskSection.length;
        if (insertIndex === -1) {
            throw new Error('Aufgabenabschnitt nicht in Zeitplan gefunden');
        }

        // Berechne den relativen Pfad zur Auftrag.md Datei
        const scheduleDir = path.dirname(schedulePath);
        const taskFolderPath = path.join(scheduleDir, taskName);
        const taskFilePath = path.join(taskFolderPath, 'Auftrag.md');

        // Berechne den Pfad relativ zum Vault
        const vaultPath = this.app.vault.adapter.basePath;
        const relativePath = path.relative(vaultPath, taskFilePath).replace(/\\/g, '/');

        // Erstelle den Link
        const taskEntry = `- [ ] [[${relativePath}|${taskName}]]\n`;

        // Füge den Link in den Zeitplan ein
        scheduleContent = scheduleContent.slice(0, insertIndex) + taskEntry + scheduleContent.slice(insertIndex);
        await fs.promises.writeFile(schedulePath, scheduleContent, 'utf8');
    }

    async createNewRemoteTaskFromSchedule(date) {
        if (!date) {
            console.error('Kein gültiges Datum übergeben.');
            new Notice('Kein gültiges Datum gefunden.');
            return;
        }

        // Schritt 1: Auftragsnamen abfragen
        const taskName = await this.promptUser('Auftragsnamen eingeben');
        if (!taskName) {
            new Notice('Kein Auftragsnamen eingegeben.');
            return;
        }

        // Schritt 2: Pfade definieren
        if (!this.settings.remoteDayDestinationPath) {
            new Notice('Remote Tag Zielverzeichnis Pfad ist nicht gesetzt. Bitte überprüfen Sie die Einstellungen.');
            return;
        }

        const remoteTaskPath = path.join(this.app.vault.adapter.basePath, this.settings.remoteDayDestinationPath, date, taskName);
        const templatePath = path.join(this.app.vault.adapter.basePath, this.settings.remoteTaskTemplatePath);
        const schedulePath = path.join(this.app.vault.adapter.basePath, this.settings.remoteDayDestinationPath, date, 'Zeitplan.md');
        const taskFilePath = path.join(remoteTaskPath, 'Auftrag.md');
        const taskFileTemplatePath = path.join(templatePath, 'Auftrag.md');

        // Schritt 3: Erstellen des Auftrag-Ordners und der Datei
        try {
            await copyFolder(templatePath, remoteTaskPath);
            await this.addTaskToSchedule(schedulePath, taskName); // Anpassung hier
            await createUpdatedTaskFile(taskFileTemplatePath, taskFilePath, taskName);
            new Notice(`Remote Auftragsordner erstellt für "${taskName}" am ${date}`);
        } catch (error) {
            console.error(`Fehler beim Erstellen des Remote Auftrags: ${error.message}`);
            new Notice(`Fehler beim Erstellen des Remote Auftrags: ${error.message}`);
        }
    }

    isScheduleFile(file) {
        // Prüfen, ob die Datei 'Zeitplan.md' ist und sich im Remote-Tag Ordner befindet
        const remoteDayPath = this.settings.remoteDayDestinationPath.replace(/\\/g, '/'); // Windows Pfade anpassen
        const escapedPath = remoteDayPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // Regex-Sonderzeichen escapen
        const regex = new RegExp(`^${escapedPath}/\\d{4}-\\d{2}-\\d{2}/Zeitplan\\.md$`);
        return regex.test(file.path);
    }


    getDateFromScheduleFile(file) {
        // Extrahieren des Datums aus dem Pfad, z.B. 'Remote-Tage/2024-10-01/Zeitplan.md'
        const parts = file.path.split('/');
        if (parts.length < 3) {
            console.error('Ungültiger Pfad für Zeitplan.md:', file.path);
            return null;
        }
        const remoteDayFolder = parts[parts.length - 2];
        return remoteDayFolder;
    }


    addNeuerAuftragButton(date) {
        // Entfernt den bestehenden Button, falls vorhanden
        this.removeNeuerAuftragButton();

        this.neuerAuftragButton = this.addStatusBarItem('statusbar-right');
        this.neuerAuftragButton.setText('Neuer Auftrag');
        this.neuerAuftragButton.setAttr('aria-label', 'Neuen Auftrag erstellen');
        this.neuerAuftragButton.addClass('neuer-auftrag-statusbar-button'); // Für eventuelles CSS Styling

        // Korrigierte Event-Zuweisung mit 'addEventListener'
        this.neuerAuftragButton.addEventListener('click', () => {
            this.createNewRemoteTaskFromSchedule(date);
        });
    }



    removeNeuerAuftragButton() {
        if (this.neuerAuftragButton) {
            this.neuerAuftragButton.remove();
            this.neuerAuftragButton = null;
        }
    }
}

// PromptModal class
class PromptModal extends Modal {
    constructor(app, promptText, callback) {
        super(app);
        this.promptText = promptText;
        this.callback = callback;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.createEl('h2', { text: this.promptText });

        const inputEl = contentEl.createEl('input', { type: 'text' });
        inputEl.focus();

        inputEl.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                this.callback(inputEl.value);
                this.close();
            }
        });

        const buttonEl = contentEl.createEl('button', { text: 'OK' });
        buttonEl.addEventListener('click', () => {
            this.callback(inputEl.value);
            this.close();
        });
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}

class SingleDatePromptModal extends Modal {
    constructor(app, promptText, callback) {
        super(app);
        this.promptText = promptText;
        this.callback = callback;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.createEl('h2', { text: this.promptText });

        const containerEl = contentEl.createEl('div', { cls: 'date-container' });

        const todayButtonEl = containerEl.createEl('button', { text: 'Heute', cls: 'date-button' });
        todayButtonEl.addEventListener('click', () => {
            const today = new Date().toISOString().split('T')[0];
            inputEl.value = today;
            this.callback(today);
            this.close();
        });

        const inputEl = containerEl.createEl('input', { type: 'date', cls: 'date-input' });
        inputEl.focus();

        inputEl.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                const dateValue = inputEl.value;
                this.callback(dateValue);
                this.close();
            }
        });

        const okButtonEl = containerEl.createEl('button', { text: 'OK', cls: 'date-button' });
        okButtonEl.addEventListener('click', () => {
            const dateValue = inputEl.value;
            this.callback(dateValue);
            this.close();
        });

        contentEl.appendChild(containerEl);
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}


class DateRangePromptModal extends Modal {
    constructor(app, promptText, callback, defaultStartDate = null, defaultMultiDay = false) {
        super(app);
        this.promptText = promptText;
        this.callback = callback;
        this.defaultStartDate = defaultStartDate;
        this.defaultMultiDay = defaultMultiDay;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.createEl('h2', { text: this.promptText });

        const containerEl = contentEl.createEl('div', { cls: 'date-container' });

        const startInputEl = containerEl.createEl('input', { type: 'date', cls: 'date-input' });
        startInputEl.focus();

        // Setze das vorbefüllte Startdatum, falls vorhanden
        if (this.defaultStartDate) {
            startInputEl.value = this.defaultStartDate;
        }

        const todayButtonEl = containerEl.createEl('button', { text: 'Heute', cls: 'date-button' });
        todayButtonEl.addEventListener('click', () => {
            const today = new Date().toISOString().split('T')[0];
            startInputEl.value = today;
            this.callback({ startDate: today });
            this.close();
        });

        const multiDayContainer = containerEl.createEl('div', { cls: 'multi-day-container' });

        const multiDayCheckboxEl = multiDayContainer.createEl('input', { type: 'checkbox', cls: 'multi-day-checkbox' });
        multiDayCheckboxEl.id = 'multiDayCheckbox';

        // Setze den Standardwert für die Mehrtägig-Checkbox
        multiDayCheckboxEl.checked = this.defaultMultiDay;

        const multiDayLabelEl = multiDayContainer.createEl('label', { text: 'Mehrtägig', cls: 'multi-day-label' });
        multiDayLabelEl.htmlFor = 'multiDayCheckbox';

        const endInputEl = containerEl.createEl('input', { type: 'date', cls: 'date-input' });

        // Zeige das Enddatum-Feld nur an, wenn die Checkbox ausgewählt ist
        endInputEl.style.display = this.defaultMultiDay ? 'block' : 'none';

        multiDayCheckboxEl.addEventListener('change', () => {
            if (multiDayCheckboxEl.checked) {
                endInputEl.style.display = 'block';
            } else {
                endInputEl.style.display = 'none';
            }
        });

        startInputEl.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                const dateValue = startInputEl.value;
                const endDate = multiDayCheckboxEl.checked ? endInputEl.value : null;
                this.callback({ startDate: dateValue, endDate });
                this.close();
            }
        });

        const okButtonEl = containerEl.createEl('button', { text: 'OK', cls: 'date-button' });
        okButtonEl.addEventListener('click', () => {
            const dateValue = startInputEl.value;
            const endDate = multiDayCheckboxEl.checked ? endInputEl.value : null;
            this.callback({ startDate: dateValue, endDate });
            this.close();
        });

        // Elemente zum Container hinzufügen
        multiDayContainer.appendChild(multiDayLabelEl);
        containerEl.appendChild(multiDayContainer);
        containerEl.appendChild(endInputEl);
        containerEl.appendChild(okButtonEl);

        contentEl.appendChild(containerEl);
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}

// DropdownModal class
class DropdownModal extends Modal {
    constructor(app, promptText, options, callback, showTodayButton = false, validateTodayCallback = null, allowNewCustomer = false, createNewCustomerCallback = null) {
        super(app);
        this.promptText = promptText;
        this.options = options;
        this.callback = callback;
        this.showTodayButton = showTodayButton;
        this.validateTodayCallback = validateTodayCallback;
        this.allowNewCustomer = allowNewCustomer;
        this.createNewCustomerCallback = createNewCustomerCallback;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.createEl('h2', { text: this.promptText });

        // Create container for input and dropdown
        const containerEl = contentEl.createEl('div', { cls: 'dropdown-container' });

        // Optional 'Heute' Button
        if (this.showTodayButton) {
            const todayButtonEl = containerEl.createEl('button', { text: 'Heute', cls: 'dropdown-button' });
            todayButtonEl.addEventListener('click', () => {
                const today = new Date().toISOString().split('T')[0];
                if (this.validateTodayCallback && this.validateTodayCallback(today)) {
                    this.callback(today);
                    this.close();
                } else {
                    new Notice('Remote-Tag für heute existiert nicht.');
                }
            });
        }

        // Create input element
        const inputEl = containerEl.createEl('input', { type: 'text', cls: 'dropdown-input' });
        inputEl.focus();

        // Create dropdown element
        const dropdownEl = containerEl.createEl('select', { cls: 'dropdown' });
        dropdownEl.size = this.options.length > 10 ? 10 : this.options.length;

        // Erstellen der Dropdown-Optionen
        this.options.forEach(option => {
            const optionEl = dropdownEl.createEl('option', { text: option });
            optionEl.value = option;

            // Add double-click event listener
            optionEl.addEventListener('dblclick', () => {
                this.callback(optionEl.value);
                this.close();
            });
        });

        // Filter options based on input
        inputEl.addEventListener('input', () => {
            const filter = inputEl.value.toLowerCase();
            let firstVisibleOption = null;
            let visibleOptionsCount = 0;
            for (let i = 0; i < dropdownEl.options.length; i++) {
                const option = dropdownEl.options[i];
                if (option.text.toLowerCase().includes(filter)) {
                    option.style.display = '';
                    if (!firstVisibleOption) firstVisibleOption = option;
                    visibleOptionsCount++;
                } else {
                    option.style.display = 'none';
                }
            }
            if (firstVisibleOption) {
                dropdownEl.value = firstVisibleOption.value;
            }
            dropdownEl.size = visibleOptionsCount > 10 ? 10 : visibleOptionsCount;
        });

        // Handle keydown events for better navigation
        dropdownEl.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault(); // Prevent form submission
                this.callback(dropdownEl.value);
                this.close();
            } else if (event.key === 'Tab') {
                event.preventDefault(); // Prevent tabbing out of the modal
                inputEl.focus(); // Bring focus back to the input
            }
        });

        inputEl.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault(); // Prevent form submission
                if (dropdownEl.options.length > 0) {
                    this.callback(dropdownEl.value);
                    this.close();
                }
            } else if (event.key === 'ArrowDown') {
                event.preventDefault();
                dropdownEl.focus();
            }
        });

        // Append elements to contentEl
        contentEl.appendChild(containerEl);

        // Neuen Kunden erstellen Button hinzufügen, falls erlaubt
        if (this.allowNewCustomer) {
            const newCustomerButton = contentEl.createEl('button', { text: 'Neuen Kunden erstellen', cls: 'new-customer-button' });
            newCustomerButton.addEventListener('click', () => {
                this.openNewCustomerModal();
            });
        }
    }

    // Methode zum Öffnen des Modals für neuen Kundennamen
    openNewCustomerModal() {
        const modal = new PromptModal(this.app, 'Neuen Kundennamen eingeben', async (newCustomerName) => {
            if (newCustomerName) {
                // Erstelle neuen Kunden
                if (this.createNewCustomerCallback) {
                    await this.createNewCustomerCallback(newCustomerName);
                    // Aktualisiere die Optionen mit dem neuen Kunden
                    this.options.push(newCustomerName);
                    // Aktualisiere das Dropdown
                    this.refreshDropdown();
                    // Setze den neuen Kunden als ausgewählt
                    this.callback(newCustomerName);
                    this.close();
                } else {
                    new Notice('Fehler: createNewCustomerCallback nicht definiert.');
                }
            } else {
                new Notice('Kein Kundennamen eingegeben.');
            }
        });
        modal.open();
    }

    // Methode zum Aktualisieren des Dropdowns
    refreshDropdown() {
        const dropdownEl = this.contentEl.querySelector('.dropdown');
        dropdownEl.innerHTML = ''; // Entferne alte Optionen

        this.options.forEach(option => {
            const optionEl = dropdownEl.createEl('option', { text: option });
            optionEl.value = option;

            // Add double-click event listener
            optionEl.addEventListener('dblclick', () => {
                this.callback(optionEl.value);
                this.close();
            });
        });
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}

// ConfirmPromptModal class
class ConfirmPromptModal extends Modal {
    constructor(app, promptText, callback) {
        super(app);
        this.promptText = promptText;
        this.callback = callback;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.createEl('h2', { text: this.promptText });

        const buttonContainer = contentEl.createEl('div', { cls: 'button-container' });

        const yesButton = buttonContainer.createEl('button', { text: 'Ja' });
        yesButton.addEventListener('click', () => {
            this.callback(true);
            this.close();
        });

        const noButton = buttonContainer.createEl('button', { text: 'Nein' });
        noButton.addEventListener('click', () => {
            this.callback(false);
            this.close();
        });
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}

// ConfirmModal class
class ConfirmModal extends Modal {
    constructor(app, promptText, callback) {
        super(app);
        this.promptText = promptText;
        this.callback = callback;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.createEl('h2', { text: this.promptText });

        const buttonEl = contentEl.createEl('button', { text: 'Öffnen' });
        buttonEl.addEventListener('click', () => {
            this.callback();
            this.close();
        });
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}

// Neue Klasse 'CalendarModal' hinzufügen
class CalendarModal extends Modal {
    constructor(app, plugin) {
        super(app);
        this.plugin = plugin;
        this.currentDate = new Date(); // Startdatum ist das aktuelle Datum
        this.highlightedDate = null; // Für das zweite Feature
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();

        // Modal-Größe anpassen
        this.modalEl.style.width = '80%'; // Setzt die Breite auf 80% des Viewports
        this.modalEl.style.height = '80%'; // Setzt die Höhe auf 80% des Viewports

        contentEl.style.width = '100%';
        contentEl.style.height = '100%';
        contentEl.style.display = 'flex';
        contentEl.style.flexDirection = 'column';

        // Fügt oben einen Abstand hinzu
        contentEl.style.paddingTop = '20px';

        // Navigations-Buttons erstellen
        const navContainer = contentEl.createEl('div', { cls: 'calendar-nav' });

        const prevButton = navContainer.createEl('button', { text: '← Vorherige 4 Monate', cls: 'prev-button' });
        prevButton.addEventListener('click', () => {
            this.currentDate.setMonth(this.currentDate.getMonth() - 4);
            this.renderCalendar();
        });

        // Heute-Button hinzufügen
        const todayButton = navContainer.createEl('button', { text: 'Heute', cls: 'today-button' });
        todayButton.addEventListener('click', () => {
            this.currentDate = new Date();
            this.highlightedDate = null; // Highlight entfernen
            this.renderCalendar();
        });

        const nextButton = navContainer.createEl('button', { text: 'Nächste 4 Monate →', cls: 'next-button' });
        nextButton.addEventListener('click', () => {
            this.currentDate.setMonth(this.currentDate.getMonth() + 4);
            this.renderCalendar();
        });

        // Datumssuche erstellen
        const searchContainer = contentEl.createEl('div', { cls: 'calendar-search' });
        const searchInput = searchContainer.createEl('input', { type: 'date' });
        const searchButton = searchContainer.createEl('button', { text: 'Springe zu Datum' });
        searchButton.addEventListener('click', () => {
            const selectedDate = new Date(searchInput.value);
            if (!isNaN(selectedDate)) {
                this.currentDate = selectedDate;
                this.highlightedDate = selectedDate; // Datum zum Hervorheben setzen
                this.renderCalendar();
            }
        });

        this.calendarContainer = contentEl.createEl('div', { cls: 'calendar-container' });

        this.renderCalendar();
    }

    renderCalendar() {
        const { calendarContainer } = this;
        calendarContainer.empty();

        // Einsätze und Remote-Tage abrufen
        const deployments = this.plugin.getDeploymentDates();
        const remoteDays = this.plugin.getRemoteDates();

        const startMonth = new Date(Date.UTC(this.currentDate.getUTCFullYear(), this.currentDate.getUTCMonth(), 1));

        for (let i = 0; i < 4; i++) {
            const monthDate = new Date(Date.UTC(startMonth.getUTCFullYear(), startMonth.getUTCMonth() + i, 1));
            const monthEl = calendarContainer.createEl('div', { cls: 'calendar-month' });
            monthEl.createEl('h3', { text: monthDate.toLocaleString('default', { month: 'long', year: 'numeric' }) });

            const daysEl = monthEl.createEl('div', { cls: 'calendar-days' });

            // Ersten Tag der Anzeige berechnen (Anfang der Woche)
            const firstDayOfMonth = new Date(Date.UTC(monthDate.getUTCFullYear(), monthDate.getUTCMonth(), 1));
            const firstDayWeekday = (firstDayOfMonth.getUTCDay() + 6) % 7; // Montag = 0
            const displayStartDate = new Date(firstDayOfMonth);
            displayStartDate.setUTCDate(displayStartDate.getUTCDate() - firstDayWeekday);

            // Letzten Tag der Anzeige berechnen (Ende der Woche)
            const lastDayOfMonth = new Date(Date.UTC(monthDate.getUTCFullYear(), monthDate.getUTCMonth() + 1, 0));
            const lastDayWeekday = (lastDayOfMonth.getUTCDay() + 6) % 7; // Montag = 0
            const displayEndDate = new Date(lastDayOfMonth);
            displayEndDate.setUTCDate(displayEndDate.getUTCDate() + (6 - lastDayWeekday));

            let currentDate = new Date(displayStartDate);

            while (currentDate <= displayEndDate) {
                const dateStr = currentDate.toISOString().split('T')[0];
                const dayEl = daysEl.createEl('div', { cls: 'calendar-day' });

                // Tageszahl anzeigen
                const dayNumberEl = dayEl.createEl('div', { text: currentDate.getUTCDate().toString(), cls: 'day-number' });

                // Überprüfen, ob es heute ist
                const today = new Date();
                const isToday = currentDate.getUTCFullYear() === today.getFullYear() &&
                                currentDate.getUTCMonth() === today.getMonth() &&
                                currentDate.getUTCDate() === today.getDate();

                if (isToday) {
                    dayEl.addClass('today');
                }

                // **Überprüfen, ob es das hervorgehobene Datum ist**
                if (this.highlightedDate) {
                    const isHighlighted = currentDate.getUTCFullYear() === this.highlightedDate.getUTCFullYear() &&
                                          currentDate.getUTCMonth() === this.highlightedDate.getUTCMonth() &&
                                          currentDate.getUTCDate() === this.highlightedDate.getUTCDate();
                    if (isHighlighted) {
                        dayEl.addClass('highlighted-date');
                    }
                }

                // Tage, die nicht zum aktuellen Monat gehören, markieren
                if (currentDate.getUTCMonth() !== monthDate.getUTCMonth()) {
                    dayEl.addClass('other-month');
                }

                // **Prüfen, ob der aktuelle Tag ein Samstag oder Sonntag ist**
                const dayOfWeek = currentDate.getUTCDay(); // Sonntag = 0, Montag = 1, ..., Samstag = 6
                if (dayOfWeek === 0 || dayOfWeek === 6) {
                    dayNumberEl.addClass('weekend');
                }

                // Prüfen, ob das Datum Termine hat
                const dayDeployments = deployments[dateStr] || [];
                const isRemoteDay = remoteDays[dateStr];

                // Termine anzeigen
                if (dayDeployments.length > 0 || isRemoteDay) {
                    const eventsEl = dayEl.createEl('div', { cls: 'day-events' });

                    if (isRemoteDay) {
                        const eventClass = isRemoteDay.archived ? 'remote-event archived' : 'remote-event';
                        eventsEl.createEl('div', { text: 'Remote', cls: `event ${eventClass}` });
                    }

                    for (const deployment of dayDeployments) {
                        const eventClass = deployment.completed ? 'deployment-completed-event' : 'deployment-event';
                        eventsEl.createEl('div', {
                            text: `${deployment.customerName}`,
                            cls: `event ${eventClass}`
                        });
                    }
                }

                dayEl.addEventListener('click', () => {
                    if (dayDeployments.length > 0 || isRemoteDay) {
                        // Wenn es bereits Termine gibt, zeige die Informationen an
                        this.openDayInfoModal(dateStr);
                    } else {
                        // Ansonsten öffne das Modal zum Erstellen eines neuen Termins
                        this.openCreateModal(dateStr);
                    }
                });

                // Zum nächsten Tag wechseln
                currentDate.setUTCDate(currentDate.getUTCDate() + 1);
            }
        }
    }



    openCreateModal(dateStr) {
        // Benutzer fragen, ob ein Einsatz oder ein Remote-Tag erstellt werden soll
        const modal = new ChooseActionModal(this.app, dateStr, this.plugin);
        modal.open();

        // Nach Schließen des Modals den Kalender aktualisieren
        modal.onClose = () => {
            this.renderCalendar();
        };
    }

    openDayInfoModal(dateStr) {
        const modal = new DayInfoModal(this.app, dateStr, this.plugin);
        modal.open();
    }

    refreshCalendar() {
        this.renderCalendar();
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}

// Modal zum Auswählen der Aktion beim Klicken auf einen Tag
class ChooseActionModal extends Modal {
    constructor(app, dateStr, plugin) {
        super(app);
        this.dateStr = dateStr;
        this.plugin = plugin;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();

        contentEl.addClass('choose-action-modal'); // Neue Klasse hinzufügen

        contentEl.createEl('h2', { text: 'Aktion wählen' });
        contentEl.createEl('p', { text: `Datum: ${this.dateStr}` });

        const buttonContainer = contentEl.createEl('div', { cls: 'button-container' });

        const createDeploymentButton = buttonContainer.createEl('button', { text: 'Einsatz erstellen' });
        createDeploymentButton.addEventListener('click', async () => {
            await this.plugin.createNewDeploymentWithDate(this.dateStr);
            this.close();
        });

        const createRemoteDayButton = buttonContainer.createEl('button', { text: 'Remote-Tag erstellen' });
        createRemoteDayButton.addEventListener('click', async () => {
            await this.plugin.createNewRemoteDayWithDate(this.dateStr);
            this.close();
        });
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}

class DayInfoModal extends Modal {
    constructor(app, dateStr, plugin) {
        super(app);
        this.dateStr = dateStr;
        this.plugin = plugin;
    }

    async onOpen() {
        const { contentEl } = this;
        contentEl.empty();

        contentEl.addClass('day-info-modal'); // Neue Klasse hinzufügen

        contentEl.createEl('h2', { text: 'Termin-Informationen' });
        contentEl.createEl('p', { text: `Datum: ${this.dateStr}` });

        // Informationen sammeln
        const deployments = this.plugin.getDeploymentDates()[this.dateStr] || [];
        const isRemoteDay = this.plugin.getRemoteDates()[this.dateStr];

        // Anzeige der Informationen
        const infoEl = contentEl.createEl('div', { cls: 'info-text' });

        // Buttons für Aktionen
        const buttonContainer = contentEl.createEl('div', { cls: 'button-container' });

        if (isRemoteDay) {
            // Remote-Tag Informationen anzeigen
            const remoteInfo = '- **Typ:** Remote-Tag';
            await MarkdownRenderer.renderMarkdown(remoteInfo, infoEl, '', this);

            // Button zum Öffnen von Zeitplan.md hinzufügen
            const openScheduleButton = buttonContainer.createEl('button', { text: 'Remote-Zeitplan öffnen' });
            openScheduleButton.addEventListener('click', async () => {
                await this.plugin.openRemoteSchedule(this.dateStr);
                this.close();
            });
        }

        for (const deployment of deployments) {
            // Einsatzinformationen anzeigen
            const deploymentInfo = `- **Typ:** Einsatz\n  **Kunde:** ${deployment.customerName}\n  **Einsatzdaten:** ${deployment.folderName}`;
            await MarkdownRenderer.renderMarkdown(deploymentInfo, infoEl, '', this);

            // Button zum Öffnen des Einsatzordners hinzufügen
            const openDeploymentButton = buttonContainer.createEl('button', { text: `Zum Einsatz von ${deployment.customerName}` });
            openDeploymentButton.addEventListener('click', async () => {
                await this.plugin.openDeploymentFile(deployment);
                this.close();
            });
        }

        // Neuen Termin erstellen Button hinzufügen
        const newEventButton = buttonContainer.createEl('button', { text: 'Neuen Termin erstellen' });
        newEventButton.addEventListener('click', () => {
            this.close();
            this.plugin.openCreateModal(this.dateStr);
        });

        // Schließen Button hinzufügen
        const closeButton = buttonContainer.createEl('button', { text: 'Schließen' });
        closeButton.addEventListener('click', () => {
            this.close();
        });
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}


// CSS-Stile hinzufügen
const style = document.createElement('style');
style.textContent = `
    /* CSS-Stile */

.date-container {
    display: flex;
    flex-direction: column;
    align-items: center;
    width: 100%;
}

.date-input, .date-button {
    margin-bottom: 15px;
    width: 100%;
    box-sizing: border-box;
    padding: 5px;
    text-align: center;
}

.multi-day-container {
    display: flex;
    align-items: center;
    margin-bottom: 10px;
    width: 100%;
}

.multi-day-checkbox {
    margin-right: 5px;
}

.dropdown-container {
    display: flex;
    flex-direction: column;
    position: relative;
    width: 100%;
}

.dropdown-input {
    margin-bottom: 5px;
    width: 100%;
    box-sizing: border-box;
    padding: 5px;
}

.dropdown {
    width: 100%;
    box-sizing: border-box;
    padding: 5px;
    margin-bottom: 10px;
    min-height: 100px;
}

.dropdown-button {
    align-self: center;
    padding: 5px 10px;
    margin-bottom: 5px;
}

.calendar-nav {
    display: flex;
    justify-content: center; /* Zentriert die Buttons horizontal */
    align-items: center; /* Zentriert die Buttons vertikal */
    margin-bottom: 10px;
    margin-top: 20px; /* Fügt oben einen Abstand hinzu */
}

.calendar-nav button {
    flex: none; /* Verhindert, dass die Buttons sich dehnen */
    margin: 0 10px;
}

.calendar-nav .today-button {
    width: 80px; /* Feste Breite für den Heute-Button */
}

.calendar-nav .prev-button,
.calendar-nav .next-button {
    width: 150px; /* Feste Breite für die Monats-Buttons */
}

.calendar-nav button:nth-child(2) { /* Heute-Button */
    flex: none;
}

/* Hervorgehobenes Datum nach "Springe zu Datum" */
.calendar-day.highlighted-date {
    border: 2px solid lightgray;
    border-radius: 5px;
    box-sizing: border-box;
}

/* Kalender-Suche */
.calendar-search {
    display: flex;
    margin-bottom: 10px;
}

.calendar-search input {
    margin-right: 5px;
}

/* Kalender-Container */
.calendar-container {
    display: grid;
    grid-template-columns: repeat(2, 1fr); /* 2 Spalten */
    grid-gap: 20px; /* Abstand zwischen den Monaten */
    width: 100%;
    flex-grow: 1; /* Kalender füllt den verfügbaren Platz */
    overflow-y: auto; /* Scrollen bei Bedarf */
}

/* Kalender-Monat */
.calendar-month {
    box-sizing: border-box;
    padding: 10px;
}

/* Kalender-Tage */
.calendar-days {
    display: flex;
    flex-wrap: wrap;
}

.calendar-day {
    width: 14.28%; /* Jede Woche hat 7 Tage */
    box-sizing: border-box;
    padding: 8px;
    text-align: center;
    cursor: pointer;
    border: 1px solid var(--background-modifier-border);
    margin-bottom: -1px;
}

.calendar-day.empty {
    visibility: hidden;
}

.calendar-day.today {
    border: 2px solid var(--interactive-accent);
    border-radius: 5px;
    box-sizing: border-box;
}

.calendar-day.today .day-number {
    background-color: var(--interactive-accent);
    color: white;
    border-radius: 50%;
    width: 24px;
    height: 24px;
    line-height: 24px;
    display: inline-block;
}

/* Tageszahl für Samstage und Sonntage grau darstellen */
.day-number.weekend {
    color: dimgray;
}

/* Tage aus anderen Monaten blasser darstellen */
.calendar-day.other-month {
    color: gray
}

/* Kalender-Tageszahl */
.day-number {
    font-weight: bold;
}

/* Tagesereignisse */
.day-events {
    margin-top: 5px;
}

/* Einzelnes Ereignis */
.event {
    font-size: 10px;
    margin-top: 2px;
    padding: 2px;
    border-radius: 3px;
    color: white;
}

/* Stil für Einsatz-Ereignis */
.deployment-event {
    background-color: #3D90A1;
}

.deployment-completed-event {
    background-color: #28a745; /* Grün */
}

/* Stil für Remote-Ereignis */
.remote-event {
    background-color: #C71585;
}

/* Modal-Buttons Abstand */
.choose-action-modal .button-container {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    margin 5px;
    margin-top: 20px;
}

/* Modal-Buttons Abstand */
.choose-action-modal .button-container {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    margin-top: 20px;
}

.choose-action-modal .button-container button {
    margin: 5px 0; /* Fügt oben und unten Abstand hinzu */
    padding: 10px;
    width: 100%;
    box-sizing: border-box;
}

/* Button zum Erstellen eines neuen Kunden */
.new-customer-button {
    margin-top: 10px;
    padding: 5px 10px;
    width: 100%;
    box-sizing: border-box;
}

.day-info-modal .button-container button {
    margin: 5px 0;
    padding: 10px;
    width: 100%;
    box-sizing: border-box;
}

.day-info-modal .info-text {
    white-space: pre-wrap; /* Zeilenumbrüche berücksichtigen */
    margin-top: 10px;
}

/* Größe des Modals anpassen */
.modal-container {
    max-width: none; /* Entfernt die maximale Breite */
    width: 100%;
    height: 100%;
}

.neuer-auftrag-statusbar-button {
    cursor: pointer;
    padding: 0 10px;
    font-size: 14px;
    background-color: var(--interactive-accent);
    color: white;
    border-radius: 4px;
    margin-left: 10px;
}

.neuer-auftrag-statusbar-button:hover {
    background-color: var(--interactive-accent-hover);
}
`;
document.head.appendChild(style);

module.exports = SoftwarePlanner;
