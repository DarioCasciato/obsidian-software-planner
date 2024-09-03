const { Plugin, PluginSettingTab, Setting, Notice, Modal } = require('obsidian');
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
        console.log('Copying:', srcPath, 'to', destPath);

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

// Utility function to add task to schedule
async function addTaskToSchedule(schedulePath, taskName) {
    let scheduleContent = await fs.promises.readFile(schedulePath, 'utf8');
    const taskEntry = `- [ ] ${taskName}\n`;

    const taskSection = '## Aufträge\n\n';
    const insertIndex = scheduleContent.indexOf(taskSection) + taskSection.length;
    if (insertIndex === -1) {
        throw new Error('Aufgabenabschnitt nicht in Zeitplan gefunden');
    }

    scheduleContent = scheduleContent.slice(0, insertIndex) + taskEntry + scheduleContent.slice(insertIndex);
    await fs.promises.writeFile(schedulePath, scheduleContent, 'utf8');
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
        this.addPathSetting(containerEl, 'Remote Auftrag Vorlagenfpad', 'remoteTaskTemplatePath');
        this.addPathSetting(containerEl, 'Remote Tag Zielverzeichnis Pfad', 'remoteDayDestinationPath');

        // XML Program Path
        containerEl.createEl('h3', { text: 'XMLVisualizer Einstellungen' });

        this.addPathSetting(containerEl, 'XMLVisualizer Pfad', 'xmlProgramPath');
    }

    addPathSetting(containerEl, name, settingKey) {
        new Setting(containerEl)
            .setName(name)
            .setDesc(`Path to the ${name.toLowerCase()}`)
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

    registerCommands() {
        this.addCommand({
            id: 'create-new-customer',
            name: 'Neuer Kunde erstellen',
            callback: () => this.createNewCustomer()
        });

        this.addCommand({
            id: 'create-new-remote-day',
            name: 'Neuen Remote-Tag erstellen',
            callback: () => this.createNewRemoteDay()
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
        this.addRibbonIcon('calendar-plus', 'Neuer Remote-Tag', () => this.createNewRemoteDay());
        this.addRibbonIcon('clipboard-check', 'Neuer Remote-Auftrag', () => this.createNewRemoteTask());
        this.addRibbonIcon('check', 'Check Remote Aufträge', () => this.checkRemoteTasks());
        this.addRibbonIcon('archive', 'Alte Remote-Tage archivieren', () => this.archiveOldRemoteDays());
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
            console.error(`Fehler beim erstellen vom Kundenordner: ${error.message}`);
            new Notice(`Fehler beim erstellen vom Kundenordner: ${error.message}`);
        }
    }

    async createNewRemoteDay() {
        if (!this.settings.remoteDayTemplatePath || !this.settings.remoteDayDestinationPath) {
            new Notice('Setze die Remote-Tag Vorlage- und Zielpfäde in den Einstellungen.');
            return;
        }

        const remoteDay = await this.promptSingleDate('Remote-Tag Datum eingeben (YYYY-MM-DD)');
        if (!remoteDay) return;

        const remoteDayPath = path.join(this.app.vault.adapter.basePath, this.settings.remoteDayDestinationPath, remoteDay);
        const templatePath = path.join(this.app.vault.adapter.basePath, this.settings.remoteDayTemplatePath);

        try {
            await copyFolder(templatePath, remoteDayPath);
            new Notice(`Remote-Tag Ordner erstellt: ${remoteDay}`);
        } catch (error) {
            console.error(`Fehler beim Erstellen des Remote-Tag Ordners: ${error.message}`);
            new Notice(`Fehler beim Erstellen des Remote-Tag Ordners: ${error.message}`);
        }
    }

    async createNewDeployment() {
        if (!this.settings.deploymentTemplatePath || !this.settings.customerDestinationPath) {
            new Notice('Setze die Einsatzvorlage und den Kundenzielpfad in den Einstellungen.');
            return;
        }

        const customers = getExistingFolders(path.join(this.app.vault.adapter.basePath, this.settings.customerDestinationPath));
        const customerName = await this.promptDropdown('Kunden wählen', customers);
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
            console.error(`Fehler beim erstellen des Remote Auftrags: ${error.message}`);
            new Notice(`Fehler beim erstellen des Remote Auftrags: ${error.message}`);
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
                console.log(`Remote-Tag ${remoteDay} wurde ins Archiv verschoben.`);
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
            console.log(`Einsatz.md erfolgreich aktualisiert: Kunde - ${customerName}, Datum - ${deploymentDate}`);
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


    async promptDateRange(promptText) {
        return new Promise((resolve) => {
            const modal = new DateRangePromptModal(this.app, promptText, resolve);
            modal.open();
        });
    }

    async promptDropdown(promptText, options, showTodayButton = false, validateTodayCallback = null) {
        return new Promise((resolve) => {
            const modal = new DropdownModal(this.app, promptText, options, resolve, showTodayButton, validateTodayCallback);
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

class DateRangePromptModal extends Modal {
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
            startInputEl.value = today;
            this.callback({ startDate: today });
            this.close();
        });

        const startInputEl = containerEl.createEl('input', { type: 'date', cls: 'date-input' });
        startInputEl.focus();

        const multiDayContainer = containerEl.createEl('div', { cls: 'multi-day-container' });

        const multiDayCheckboxEl = multiDayContainer.createEl('input', { type: 'checkbox', cls: 'multi-day-checkbox' });
        multiDayCheckboxEl.id = 'multiDayCheckbox';
        const multiDayLabelEl = multiDayContainer.createEl('label', { text: 'Mehrtägig', cls: 'multi-day-label' });
        multiDayLabelEl.htmlFor = 'multiDayCheckbox';

        const endInputEl = containerEl.createEl('input', { type: 'date', cls: 'date-input' });

        // Hide end date by default
        endInputEl.style.display = 'none';

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

        contentEl.appendChild(containerEl);
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

// DropdownModal class
class DropdownModal extends Modal {
    constructor(app, promptText, options, callback, showTodayButton = false, validateTodayCallback = null) {
        super(app);
        this.promptText = promptText;
        this.options = options;
        this.callback = callback;
        this.showTodayButton = showTodayButton;
        this.validateTodayCallback = validateTodayCallback;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.createEl('h2', { text: this.promptText });

        // Create container for input and dropdown
        const containerEl = contentEl.createEl('div', { cls: 'dropdown-container' });

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
            for (let i = 0; i < dropdownEl.options.length; i++) {
                const option = dropdownEl.options[i];
                if (option.text.toLowerCase().includes(filter)) {
                    option.style.display = '';
                    if (!firstVisibleOption) firstVisibleOption = option;
                } else {
                    option.style.display = 'none';
                }
            }
            if (firstVisibleOption) {
                dropdownEl.value = firstVisibleOption.value;
            }
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

// CSS to ensure the buttons and input are stacked and have margin
const style = document.createElement('style');
style.textContent = `
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
`;
document.head.appendChild(style);

module.exports = SoftwarePlanner;
