// #region Imports and Constants

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
    xmlProgramPath: '',
    deploymentTypesPath: ''
};

// #endregion

// #region Utility Functions

async function copyFolder(src, dest)
{
    if (!fs.existsSync(dest))
    {
        fs.mkdirSync(dest, { recursive: true });
    }

    const entries = fs.readdirSync(src, { withFileTypes: true });

    for (let entry of entries)
    {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);

        if (entry.isDirectory())
        {
            await copyFolder(srcPath, destPath);
        }
        else
        {
            fs.copyFileSync(srcPath, destPath);
        }
    }
}

function getExistingFolders(basePath)
{
    if (!fs.existsSync(basePath)) return [];
    return fs.readdirSync(basePath, { withFileTypes: true })
        .filter(entry => entry.isDirectory())
        .map(entry => entry.name);
}

function getFilesInFolder(basePath)
{
    if (!fs.existsSync(basePath)) return [];
    return fs.readdirSync(basePath, { withFileTypes: true })
        .filter(entry => entry.isFile())
        .map(entry => entry.name);
}

async function createUpdatedTaskFile(templatePath, destinationPath, customerName)
{
    let taskContent = await fs.promises.readFile(templatePath, 'utf8');
    taskContent = taskContent.replace('**Kunde**:', `**Kunde**: ${customerName}`);
    await fs.promises.writeFile(destinationPath, taskContent, 'utf8');
}

// #endregion

// #region Helper Methods for Einsatz Parsing

/**
 * Reads and parses "Einsatz.md" to determine completion status, pre-check status, and the short description (Kurzbeschrieb).
 */
function parseEinsatzFile(einsatzMdPath)
{
    let completed = false;
    let preCheckDone = false;
    let kurzbeschrieb = "Unbekannt";

    try
    {
        const einsatzContent = fs.readFileSync(einsatzMdPath, 'utf8');
        completed = einsatzContent.includes('- [x] **Auftrag abgeschlossen**');

        // Extract Kurzbeschrieb (Deployment Type Title)
        const titleMatch = einsatzContent.match(/### Kurzbeschrieb Auftrag[\s\S]*?#####\s*(.*?)\r?\n/);
        if (titleMatch && titleMatch[1])
        {
            kurzbeschrieb = titleMatch[1].trim();
        }

        // If not completed, check the "Abklären" pre-check section
        if (!completed)
        {
            preCheckDone = checkPreChecklist(einsatzContent);
        }
        else
        {
            // If completed, preCheckDone doesn't matter, but is true logically.
            preCheckDone = true;
        }
    }
    catch (error)
    {
        console.error(`Fehler beim Lesen von ${einsatzMdPath}: ${error.message}`);
    }

    return { completed, preCheckDone, kurzbeschrieb };
}

/**
 * Checks the "Abklären" checklist in "Einsatz.md" content to see if pre-check is done.
 */
function checkPreChecklist(einsatzContent)
{
    const abklaerenSectionRegex = /#### Abklären([\s\S]*?)(?=####|$)/;
    const abklaerenMatch = einsatzContent.match(abklaerenSectionRegex);

    if (!abklaerenMatch)
    {
        // No "Abklären" section found, consider preCheckDone = true by default
        return true;
    }

    const abklaerenContent = abklaerenMatch[1];
    const tasks = abklaerenContent.match(/- \[[ x]\]/g);

    if (!tasks || tasks.length === 0)
    {
        // "Abklären" found but no tasks listed, consider it done
        return true;
    }

    // Check if all tasks are checked
    return tasks.every(t => t.includes('- [x]'));
}

// #endregion

// #region Settings Tab

class SoftwarePlannerSettingTab extends PluginSettingTab
{
    constructor(app, plugin)
    {
        super(app, plugin);
        this.plugin = plugin;
    }

    display()
    {
        const { containerEl } = this;
        containerEl.empty();

        containerEl.createEl('h2', { text: 'Software Planner Plugin Einstellungen' });

        // Software Einstellungen
        containerEl.createEl('h3', { text: 'Software Einstellungen' });
        this.addPathSetting(containerEl, 'Kunden Vorlagenpfad', 'customerTemplatePath');
        this.addPathSetting(containerEl, 'Kundeneinsatz Vorlagenpfad', 'deploymentTemplatePath');
        this.addPathSetting(containerEl, 'Kunden Zielverzeichnispfad', 'customerDestinationPath');

        // Einsatztypen Verzeichnis
        new Setting(containerEl)
            .setName('Einsatztypen Verzeichnis')
            .setDesc('Verzeichnis mit Dateien für verschiedene Einsatz-Typen')
            .addText(text => text
                .setPlaceholder('Pfad angeben')
                .setValue(this.plugin.settings.deploymentTypesPath || '')
                .onChange(async (value) =>
                {
                    this.plugin.settings.deploymentTypesPath = value;
                    await this.plugin.saveSettings();
                }))
            .addButton(button => button
                .setButtonText('Durchsuchen')
                .setCta()
                .onClick(async () =>
                {
                    const result = await remote.dialog.showOpenDialog({
                        properties: ['openDirectory']
                    });
                    if (!result.canceled)
                    {
                        const selectedPath = result.filePaths[0];
                        const vaultPath = this.app.vault.adapter.basePath;
                        const relativePath = path.relative(vaultPath, selectedPath);

                        this.plugin.settings.deploymentTypesPath = relativePath;
                        await this.plugin.saveSettings();
                        this.display();
                    }
                }));

        // Remote Einstellungen
        containerEl.createEl('h3', { text: 'Remote Settings' });
        this.addPathSetting(containerEl, 'Remote Tag Vorlagenpfad', 'remoteDayTemplatePath');
        this.addPathSetting(containerEl, 'Remote Auftrag Vorlagenpfad', 'remoteTaskTemplatePath');
        this.addPathSetting(containerEl, 'Remote Tag Zielverzeichnis Pfad', 'remoteDayDestinationPath');

        // XMLVisualizer Einstellungen
        containerEl.createEl('h3', { text: 'XMLVisualizer Einstellungen' });
        this.addPathSetting(containerEl, 'XMLVisualizer Pfad', 'xmlProgramPath');
    }

    addPathSetting(containerEl, name, settingKey)
    {
        new Setting(containerEl)
            .setName(name)
            .setDesc(`Pfad zu ${name}`)
            .addText(text => text
                .setPlaceholder('Pfad angeben')
                .setValue(this.plugin.settings[settingKey] || '')
                .onChange(async (value) =>
                {
                    this.plugin.settings[settingKey] = value;
                    await this.plugin.saveSettings();
                }))
            .addButton(button => button
                .setButtonText('Durchsuchen')
                .setCta()
                .onClick(async () =>
                {
                    const properties = name === 'XMLVisualizer Pfad' ? ['openFile'] : ['openDirectory'];
                    const result = await remote.dialog.showOpenDialog({
                        properties: properties
                    });
                    if (!result.canceled)
                    {
                        const selectedPath = result.filePaths[0];
                        const vaultPath = this.app.vault.adapter.basePath;
                        const relativePath = path.relative(vaultPath, selectedPath);

                        this.plugin.settings[settingKey] = relativePath;
                        await this.plugin.saveSettings();
                        this.display();
                    }
                }));
    }
}

// #endregion

// #region Main Plugin Class

class SoftwarePlanner extends Plugin
{
    async onload()
    {
        console.log('Software Planner Plugin wird geladen');

        await this.loadSettings();
        this.addSettingTab(new SoftwarePlannerSettingTab(this.app, this));
        this.registerCommands();
        this.createRibbonIcons();
        this.addXMLFileExtension();

        this.addCommand({
            id: 'open-calendar',
            name: 'Planner-Kalender öffnen',
            callback: () => this.openCalendar()
        });

        this.addRibbonIcon('calendar', 'Planner-Kalender öffnen', () => this.openCalendar());

        this.calendarModalInstance = null;
        this.neuerAuftragButton = null;

        this.registerEvent(this.app.workspace.on('active-leaf-change', this.onActiveLeafChange.bind(this)));
    }

    onunload()
    {
        console.log('Software Planner Plugin wird entladen');
    }

    async loadSettings()
    {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings()
    {
        await this.saveData(this.settings);
    }

    // #region Command Registration

    registerCommands()
    {
        this.addCommand({
            id: 'create-new-customer',
            name: 'Neuer Kunde erstellen',
            callback: () => this.createNewCustomer()
        });

        this.addCommand({
            id: 'create-new-remote-day',
            name: 'Neuen Remote-Tag erstellen',
            callback: async () =>
            {
                const dateStr = await this.promptSingleDate('Datum des Remote-Tags auswählen');
                if (dateStr)
                {
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

    createRibbonIcons()
    {
        this.addRibbonIcon('user-plus', 'Neuer Kunde', () => this.createNewCustomer());
        this.addRibbonIcon('log-out', 'Neuer Einsatz', () => this.createNewDeployment());
        this.addRibbonIcon('screen-share', 'Neuer Remote-Tag', async () =>
        {
            const dateStr = await this.promptSingleDate('Datum des Remote-Tags auswählen');
            if (dateStr)
            {
                await this.createNewRemoteDay(dateStr);
            }
        });
        this.addRibbonIcon('clipboard-check', 'Neuer Remote-Auftrag', () => this.createNewRemoteTask());
        this.addRibbonIcon('check', 'Check Remote Aufträge', () => this.checkRemoteTasks());
        this.addRibbonIcon('archive', 'Alte Remote-Tage archivieren', () => this.archiveOldRemoteDays());
        this.addRibbonIcon('calendar', 'Planner-Kalender öffnen', () => this.openCalendar());
    }

    // #endregion

    // #region File Operations

    async openFile(filePath)
    {
        const filePathInVault = path.relative(this.app.vault.adapter.basePath, filePath).replace(/\\/g, '/');
        const file = this.app.vault.getAbstractFileByPath(filePathInVault);

        if (file && file instanceof TFile)
        {
            await this.app.workspace.getLeaf().openFile(file);
        }
        else
        {
            new Notice('Datei nicht gefunden.');
        }
    }

    // #endregion

    // #region Customer and Deployment Creation

    async createNewCustomer()
    {
        if (!this.settings.customerTemplatePath || !this.settings.customerDestinationPath)
        {
            new Notice('Setze die Kunden Vorlage- und Zielpfäde in den Einstellungen.');
            return;
        }

        const customerName = await this.promptUser('Kundennamen eingeben');
        if (!customerName) return;

        await this.createNewCustomerWithName(customerName);
    }

    async createNewCustomerWithName(customerName)
    {
        const customerPath = path.join(this.app.vault.adapter.basePath, this.settings.customerDestinationPath, customerName);
        const templatePath = path.join(this.app.vault.adapter.basePath, this.settings.customerTemplatePath);

        try
        {
            await copyFolder(templatePath, customerPath);
            new Notice(`Kundenordner erstellt: ${customerName}`);
        }
        catch (error)
        {
            console.error(`Fehler beim Erstellen vom Kundenordner: ${error.message}`);
            new Notice(`Fehler beim Erstellen vom Kundenordner: ${error.message}`);
        }
    }

    async createNewDeployment()
    {
        if (!this.settings.deploymentTemplatePath || !this.settings.customerDestinationPath)
        {
            new Notice('Setze die Einsatzvorlage und den Kundenzielpfad in den Einstellungen.');
            return;
        }

        const customers = getExistingFolders(path.join(this.app.vault.adapter.basePath, this.settings.customerDestinationPath));
        const customerName = await this.promptDropdown('Kunden wählen', customers, false, null, true, async (newCustomerName) =>
        {
            await this.createNewCustomerWithName(newCustomerName);
        });
        if (!customerName) return;

        const deploymentDates = await this.promptDateRange('Startdatum des Einsatzes angeben (YYYY-MM-DD)');
        if (!deploymentDates) return;

        const deploymentTypeData = await this.promptDeploymentType();
        if (!deploymentTypeData)
        {
            new Notice('Kein Einsatztyp gewählt.');
            return;
        }

        await this.finishDeploymentCreation(customerName, deploymentDates, deploymentTypeData);
    }

    async createNewDeploymentWithDate(deploymentDate)
    {
        if (!this.settings.deploymentTemplatePath || !this.settings.customerDestinationPath)
        {
            new Notice('Setze die Einsatzvorlage und den Kundenzielpfad in den Einstellungen.');
            return;
        }

        const customers = getExistingFolders(path.join(this.app.vault.adapter.basePath, this.settings.customerDestinationPath));
        const customerName = await this.promptDropdown('Kunden wählen', customers, false, null, true, async (newCustomerName) =>
        {
            await this.createNewCustomerWithName(newCustomerName);
        });
        if (!customerName) return;

        const deploymentDates = await this.promptDateRange('Startdatum des Einsatzes angeben (YYYY-MM-DD)', deploymentDate);
        if (!deploymentDates) return;

        const deploymentTypeData = await this.promptDeploymentType();
        if (!deploymentTypeData)
        {
            new Notice('Kein Einsatztyp gewählt.');
            return;
        }

        await this.finishDeploymentCreation(customerName, deploymentDates, deploymentTypeData);

        if (this.calendarModalInstance)
        {
            this.calendarModalInstance.refreshCalendar();
        }
    }

    async finishDeploymentCreation(customerName, deploymentDates, deploymentTypeData)
    {
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

        try
        {
            await copyFolder(templatePath, customerPath);
            await this.updateEinsatzMd(
                path.join(customerPath, 'Einsatz.md'),
                customerName,
                deploymentDates.startDate,
                deploymentTypeData.title,
                deploymentTypeData.checklist
            );
            new Notice(`Einsatz erstellt für ${customerName} vom ${folderName}`);
        }
        catch (error)
        {
            console.error(`Fehler beim Erstellen des Einsatzes: ${error.message}`);
            new Notice(`Fehler beim Erstellen des Einsatzes: ${error.message}`);
        }
    }

    // #endregion

    // #region Remote Day and Task Creation

    async createNewRemoteDayPrompt()
    {
        const dateStr = await this.promptSingleDate('Datum des Remote-Tags eingeben (YYYY-MM-DD)');
        if (!dateStr)
        {
            new Notice('Kein Datum eingegeben.');
            return;
        }
        await this.createNewRemoteDay(dateStr);
    }

    async createNewRemoteDay(dateStr)
    {
        if (!this.settings.remoteDayDestinationPath)
        {
            new Notice('Remote Tag Zielverzeichnis Pfad ist nicht gesetzt. Bitte überprüfen Sie die Einstellungen.');
            return;
        }

        const remoteDayDestinationPath = this.settings.remoteDayDestinationPath.replace(/\/+$/, '');
        const remoteDayPath = path.join(this.app.vault.adapter.basePath, remoteDayDestinationPath, dateStr);
        const templatePath = path.join(this.app.vault.adapter.basePath, this.settings.remoteDayTemplatePath);

        try
        {
            await copyFolder(templatePath, remoteDayPath);
            new Notice(`Remote-Tag erstellt: ${dateStr}`);

            const scheduleFilePath = path.join(remoteDayPath, 'Zeitplan.md');
            await this.openFile(scheduleFilePath);

            this.onActiveLeafChange();
        }
        catch (error)
        {
            console.error(`Fehler beim Erstellen des Remote-Tags: ${error.message}`);
            new Notice(`Fehler beim Erstellen des Remote-Tags: ${error.message}`);
        }
    }

    async createNewRemoteDayWithDate(remoteDay)
    {
        if (!this.settings.remoteDayTemplatePath || !this.settings.remoteDayDestinationPath)
        {
            new Notice('Setze die Remote-Tag Vorlage- und Zielpfäde in den Einstellungen.');
            return;
        }

        const remoteDayPath = path.join(this.app.vault.adapter.basePath, this.settings.remoteDayDestinationPath, remoteDay);
        const templatePath = path.join(this.app.vault.adapter.basePath, this.settings.remoteDayTemplatePath);

        if (fs.existsSync(remoteDayPath))
        {
            new Notice(`Remote-Tag für ${remoteDay} existiert bereits.`);
            return;
        }

        try
        {
            await copyFolder(templatePath, remoteDayPath);
            new Notice(`Remote-Tag Ordner erstellt: ${remoteDay}`);
        }
        catch (error)
        {
            console.error(`Fehler beim Erstellen des Remote-Tag Ordners: ${error.message}`);
            new Notice(`Fehler beim Erstellen des Remote-Tag Ordners: ${error.message}`);
        }

        if (this.calendarModalInstance)
        {
            this.calendarModalInstance.refreshCalendar();
        }
    }

    async createNewRemoteTask()
    {
        if (!this.settings.remoteTaskTemplatePath || !this.settings.remoteDayDestinationPath)
        {
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

        try
        {
            await copyFolder(templatePath, remoteTaskPath);
            await this.addTaskToSchedule(schedulePath, taskName);
            await createUpdatedTaskFile(taskFileTemplatePath, taskFilePath, taskName);
            new Notice(`Remote Auftragsordner erstellt für ${taskName} am ${remoteDay}`);
        }
        catch (error)
        {
            console.error(`Fehler beim Erstellen des Remote Auftrags: ${error.message}`);
            new Notice(`Fehler beim Erstellen des Remote Auftrags: ${error.message}`);
        }
    }

    async createNewRemoteTaskFromSchedule(date)
    {
        if (!date)
        {
            console.error('Kein gültiges Datum übergeben.');
            new Notice('Kein gültiges Datum gefunden.');
            return;
        }

        const taskName = await this.promptUser('Auftragsnamen eingeben');
        if (!taskName)
        {
            new Notice('Kein Auftragsnamen eingegeben.');
            return;
        }

        if (!this.settings.remoteDayDestinationPath)
        {
            new Notice('Remote Tag Zielverzeichnis Pfad ist nicht gesetzt. Bitte überprüfen Sie die Einstellungen.');
            return;
        }

        const remoteTaskPath = path.join(this.app.vault.adapter.basePath, this.settings.remoteDayDestinationPath, date, taskName);
        const templatePath = path.join(this.app.vault.adapter.basePath, this.settings.remoteTaskTemplatePath);
        const schedulePath = path.join(this.app.vault.adapter.basePath, this.settings.remoteDayDestinationPath, date, 'Zeitplan.md');
        const taskFilePath = path.join(remoteTaskPath, 'Auftrag.md');
        const taskFileTemplatePath = path.join(templatePath, 'Auftrag.md');

        try
        {
            await copyFolder(templatePath, remoteTaskPath);
            await this.addTaskToSchedule(schedulePath, taskName);
            await createUpdatedTaskFile(taskFileTemplatePath, taskFilePath, taskName);
            new Notice(`Remote Auftragsordner erstellt für "${taskName}" am ${date}`);
        }
        catch (error)
        {
            console.error(`Fehler beim Erstellen des Remote Auftrags: ${error.message}`);
            new Notice(`Fehler beim Erstellen des Remote Auftrags: ${error.message}`);
        }
    }

    // #endregion

    // #region Archiving and Checking

    async archiveOldRemoteDays()
    {
        const basePath = path.join(this.app.vault.adapter.basePath, this.settings.remoteDayDestinationPath);
        const archivePath = path.join(basePath, '_Archiv');

        if (!fs.existsSync(archivePath))
        {
            fs.mkdirSync(archivePath);
        }

        const remoteDays = getExistingFolders(basePath);
        const oneWeekAgo = new Date();
        oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

        for (let remoteDay of remoteDays)
        {
            const remoteDayDate = new Date(remoteDay);
            if (!isNaN(remoteDayDate) && remoteDayDate < oneWeekAgo)
            {
                const sourcePath = path.join(basePath, remoteDay);
                const destinationPath = path.join(archivePath, remoteDay);
                fs.renameSync(sourcePath, destinationPath);
            }
        }

        new Notice('Archivierung abgeschlossen.');
    }

    async checkRemoteTasks()
    {
        const basePath = path.join(this.app.vault.adapter.basePath, this.settings.remoteDayDestinationPath);
        const archivePath = path.join(basePath, '_Archiv');
        let reportContent = '\n';

        const remoteDays = getExistingFolders(basePath).concat(getExistingFolders(archivePath));

        for (let remoteDay of remoteDays)
        {
            const schedulePathMain = path.join(basePath, remoteDay, 'Zeitplan.md');
            const schedulePathArchive = path.join(archivePath, remoteDay, 'Zeitplan.md');
            const schedulePath = fs.existsSync(schedulePathMain) ? schedulePathMain : schedulePathArchive;

            if (fs.existsSync(schedulePath))
            {
                const scheduleContent = await fs.promises.readFile(schedulePath, 'utf8');
                const tasksInProgress = this.extractInProgressTasks(scheduleContent);
                if (tasksInProgress.length > 0)
                {
                    const linkPrefix = schedulePath.includes('_Archiv') ? `_Archiv/${remoteDay}` : remoteDay;
                    reportContent += `## [[${linkPrefix}/Zeitplan|${remoteDay}]]\n\n`;
                    tasksInProgress.forEach(task =>
                    {
                        reportContent += `${task}\n`;
                    });
                    reportContent += '\n';
                }
            }
        }

        const reportFilePath = path.join(basePath, 'Nicht abgeschlossene Aufträge.md');
        await fs.promises.writeFile(reportFilePath, reportContent, 'utf8');
        new Notice('Überprüfung abgeschlossen. Bericht erstellt.');
    }

    extractInProgressTasks(scheduleContent)
    {
        const ignoredSections = ['Done', 'Abgebrochen'];
        let inProgressTasks = [];
        const sections = scheduleContent.split('##');

        sections.forEach(section =>
        {
            let sectionHeader = section.split('\n')[0].trim();
            if (!ignoredSections.some(ignored => sectionHeader.includes(ignored)))
            {
                const lines = section.split('\n');
                for (let line of lines)
                {
                    if (line.includes('- [ ]'))
                    {
                        inProgressTasks.push(line.trim());
                    }
                }
            }
        });

        return inProgressTasks;
    }

    // #endregion

    // #region Update Einsatz File

    async updateEinsatzMd(einsatzFilePath, customerName, deploymentDate, deploymentTitle = '', deploymentChecklist = '')
    {
        try
        {
            let content = await fs.promises.readFile(einsatzFilePath, 'utf8');
            content = content.replace('**Kunde**:', `**Kunde**: ${customerName}`);
            content = content.replace('**Datum**:', `**Datum**: ${deploymentDate}`);
            content = content.replace('[Title]', deploymentTitle);
            content = content.replace('[Checklist]', deploymentChecklist);

            await fs.promises.writeFile(einsatzFilePath, content, 'utf8');
        }
        catch (error)
        {
            console.error(`Fehler beim Aktualisieren der Einsatz.md: ${error.message}`);
            new Notice(`Fehler beim Aktualisieren der Einsatz.md: ${error.message}`);
        }
    }

    // #endregion

    // #region Prompts

    async promptUser(promptText)
    {
        return new Promise((resolve) =>
        {
            const modal = new PromptModal(this.app, promptText, resolve);
            modal.open();
        });
    }

    async promptSingleDate(promptText)
    {
        return new Promise((resolve) =>
        {
            const modal = new SingleDatePromptModal(this.app, promptText, resolve);
            modal.open();
        });
    }

    async promptDateRange(promptText, defaultStartDate = null, defaultMultiDay = false)
    {
        return new Promise((resolve) =>
        {
            const modal = new DateRangePromptModal(this.app, promptText, resolve, defaultStartDate, defaultMultiDay);
            modal.open();
        });
    }

    async promptDropdown(promptText, options, showTodayButton = false, validateTodayCallback = null, allowNewCustomer = false, createNewCustomerCallback = null)
    {
        return new Promise((resolve) =>
        {
            const modal = new DropdownModal(this.app, promptText, options, resolve, showTodayButton, validateTodayCallback, allowNewCustomer, createNewCustomerCallback);
            modal.open();
        });
    }

    async promptConfirm(promptText)
    {
        return new Promise((resolve) =>
        {
            const modal = new ConfirmPromptModal(this.app, promptText, resolve);
            modal.open();
        });
    }

    // #endregion

    // #region XML File Handling

    addXMLFileExtension()
    {
        this.registerExtensions(['xml'], 'markdown');
        this.registerEvent(
            this.app.workspace.on('file-open', (file) =>
            {
                if (file && file.extension === 'xml')
                {
                    this.showXMLConfirmDialog(file);
                }
            })
        );
    }

    showXMLConfirmDialog(file)
    {
        const xmlProgramPath = this.settings.xmlProgramPath;
        if (!xmlProgramPath)
        {
            new Notice('Kein XMLVisualizer Programm hinterlegt. Überprüfe die Einstellungen.');
            return;
        }

        const filePath = path.join(this.app.vault.adapter.basePath, file.path);
        const activeLeaf = this.app.workspace.activeLeaf;

        const modal = new ConfirmModal(this.app, 'XML öffnen im XML Visualizer', () =>
        {
            if (activeLeaf && activeLeaf.view.file && activeLeaf.view.file.path === file.path)
            {
                activeLeaf.detach();
            }

            exec(`"${xmlProgramPath}" "${filePath}"`, (error) =>
            {
                if (error)
                {
                    console.error(`Fehler beim Öffnen des XML-Files: ${error.message}`);
                    new Notice(`Fehler beim Öffnen des XML-Files: ${error.message}`);
                }
            });
        });
        modal.open();
    }

    // #endregion

    // #region Calendar and Day Info

    openCalendar()
    {
        this.calendarModalInstance = new CalendarModal(this.app, this);
        this.calendarModalInstance.open();
    }

    getDeploymentDates()
    {
        const customerBasePath = path.join(this.app.vault.adapter.basePath, this.settings.customerDestinationPath);
        const customers = getExistingFolders(customerBasePath);

        let deploymentDates = {};
        for (const customer of customers)
        {
            const deploymentsPath = path.join(customerBasePath, customer, '1. Einsätze');
            if (!fs.existsSync(deploymentsPath))
            {
                continue;
            }
            const deployments = getExistingFolders(deploymentsPath);

            for (const deployment of deployments)
            {
                const dateRangeRegex = /^(\d{4}-\d{2}-\d{2})(?:\s*-\s*(\d{4}-\d{2}-\d{2}))?$/;
                const match = deployment.match(dateRangeRegex);

                if (match)
                {
                    const startDateStr = match[1];
                    const endDateStr = match[2] || startDateStr;
                    const startDate = new Date(startDateStr);
                    const endDate = new Date(endDateStr);
                    const isSingleDay = startDateStr === endDateStr;

                    let currentDate = new Date(startDate);
                    while (currentDate <= endDate)
                    {
                        const currentDayOfWeek = currentDate.getDay();
                        if (isSingleDay || (currentDayOfWeek !== 0 && currentDayOfWeek !== 6))
                        {
                            const dateStr = currentDate.toISOString().split('T')[0];

                            const einsatzMdPath = path.join(
                                this.app.vault.adapter.basePath,
                                this.settings.customerDestinationPath,
                                customer,
                                '1. Einsätze',
                                deployment,
                                'Einsatz.md'
                            );

                            const { completed, preCheckDone, kurzbeschrieb } = parseEinsatzFile(einsatzMdPath);

                            if (!deploymentDates[dateStr])
                            {
                                deploymentDates[dateStr] = [];
                            }

                            deploymentDates[dateStr].push({
                                customerName: customer,
                                folderName: deployment,
                                completed: completed,
                                preCheckDone: preCheckDone,
                                kurzbeschrieb: kurzbeschrieb
                            });
                        }

                        currentDate.setDate(currentDate.getDate() + 1);
                    }
                }
            }
        }
        return deploymentDates;
    }

    getRemoteDates()
    {
        const remoteBasePath = path.join(this.app.vault.adapter.basePath, this.settings.remoteDayDestinationPath);
        const archivePath = path.join(remoteBasePath, '_Archiv');

        let remoteDays = [];

        if (fs.existsSync(remoteBasePath))
        {
            remoteDays = remoteDays.concat(getExistingFolders(remoteBasePath));
        }

        if (fs.existsSync(archivePath))
        {
            remoteDays = remoteDays.concat(getExistingFolders(archivePath));
        }

        let remoteDates = {};
        for (const day of remoteDays)
        {
            if (day.match(/^\d{4}-\d{2}-\d{2}$/))
            {
                remoteDates[day] = true;
            }
        }
        return remoteDates;
    }

    // #endregion

    // #region Schedule File Recognition

    onActiveLeafChange()
    {
        const activeFile = this.app.workspace.getActiveFile();
        if (activeFile && this.isScheduleFile(activeFile))
        {
            const date = this.getDateFromScheduleFile(activeFile);
            if (date)
            {
                this.addNewTaskButton(date);
            }
            else
            {
                console.error('Datum konnte aus dem aktiven Zeitplan nicht extrahiert werden.');
                this.removeNewTaskButton();
            }
        }
        else
        {
            this.removeNewTaskButton();
        }
    }

    isScheduleFile(file)
    {
        const remoteDayPath = this.settings.remoteDayDestinationPath.replace(/\\/g, '/');
        const escapedPath = remoteDayPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`^${escapedPath}/\\d{4}-\\d{2}-\\d{2}/Zeitplan\\.md$`);
        return regex.test(file.path);
    }

    getDateFromScheduleFile(file)
    {
        const parts = file.path.split('/');
        if (parts.length < 3)
        {
            console.error('Ungültiger Pfad für Zeitplan.md:', file.path);
            return null;
        }
        const remoteDayFolder = parts[parts.length - 2];
        return remoteDayFolder;
    }

    // #endregion

    // #region UI Helpers

    addNewTaskButton(date)
    {
        this.removeNewTaskButton();

        this.neuerAuftragButton = this.addStatusBarItem('statusbar-right');
        this.neuerAuftragButton.setText('Neuer Auftrag');
        this.neuerAuftragButton.setAttr('aria-label', 'Neuen Auftrag erstellen');
        this.neuerAuftragButton.addClass('neuer-auftrag-statusbar-button');

        this.neuerAuftragButton.addEventListener('click', () =>
        {
            this.createNewRemoteTaskFromSchedule(date);
        });
    }

    removeNewTaskButton()
    {
        if (this.neuerAuftragButton)
        {
            this.neuerAuftragButton.remove();
            this.neuerAuftragButton = null;
        }
    }

    async promptDeploymentType()
    {
        if (!this.settings.deploymentTypesPath)
        {
            new Notice('Deployment-Typ-Verzeichnis ist nicht definiert. Bitte in den Einstellungen setzen.');
            return null;
        }

        const typesBasePath = path.join(this.app.vault.adapter.basePath, this.settings.deploymentTypesPath);
        if (!fs.existsSync(typesBasePath))
        {
            new Notice('Deployment-Typ-Verzeichnis existiert nicht.');
            return null;
        }

        const files = getFilesInFolder(typesBasePath);
        if (files.length === 0)
        {
            new Notice('Keine Deployment-Typ-Dateien gefunden.');
            return null;
        }

        const options = files.map(file => path.parse(file).name);
        const chosen = await this.promptDropdown('Einsatztyp wählen', options);
        if (!chosen) return null;

        const chosenFile = files.find(f => path.parse(f).name === chosen);
        if (!chosenFile) return null;

        const chosenFilePath = path.join(typesBasePath, chosenFile);
        const content = await fs.promises.readFile(chosenFilePath, 'utf8');

        return { title: chosen, checklist: content };
    }

    async addTaskToSchedule(schedulePath, taskName)
    {
        let scheduleContent = await fs.promises.readFile(schedulePath, 'utf8');
        const taskSection = '## Aufträge\n\n';
        const insertIndex = scheduleContent.indexOf(taskSection) + taskSection.length;

        if (insertIndex === -1)
        {
            throw new Error('Aufgabenabschnitt nicht in Zeitplan gefunden');
        }

        const scheduleDir = path.dirname(schedulePath);
        const taskFolderPath = path.join(scheduleDir, taskName);
        const taskFilePath = path.join(taskFolderPath, 'Auftrag.md');

        const vaultPath = this.app.vault.adapter.basePath;
        const relativePath = path.relative(vaultPath, taskFilePath).replace(/\\/g, '/');

        const taskEntry = `- [ ] [[${relativePath}|${taskName}]]\n`;
        scheduleContent = scheduleContent.slice(0, insertIndex) + taskEntry + scheduleContent.slice(insertIndex);
        await fs.promises.writeFile(schedulePath, scheduleContent, 'utf8');
    }

    // #endregion
}

// #endregion

// #region Modals

class PromptModal extends Modal
{
    constructor(app, promptText, callback)
    {
        super(app);
        this.promptText = promptText;
        this.callback = callback;
    }

    onOpen()
    {
        const { contentEl } = this;
        contentEl.createEl('h2', { text: this.promptText });

        const inputEl = contentEl.createEl('input', { type: 'text' });
        inputEl.focus();

        inputEl.addEventListener('keydown', (event) =>
        {
            if (event.key === 'Enter')
            {
                this.callback(inputEl.value);
                this.close();
            }
        });

        const buttonEl = contentEl.createEl('button', { text: 'OK' });
        buttonEl.addEventListener('click', () =>
        {
            this.callback(inputEl.value);
            this.close();
        });
    }

    onClose()
    {
        const { contentEl } = this;
        contentEl.empty();
    }
}

class SingleDatePromptModal extends Modal
{
    constructor(app, promptText, callback)
    {
        super(app);
        this.promptText = promptText;
        this.callback = callback;
    }

    onOpen()
    {
        const { contentEl } = this;
        contentEl.createEl('h2', { text: this.promptText });

        const containerEl = contentEl.createEl('div', { cls: 'date-container' });

        const todayButtonEl = containerEl.createEl('button', { text: 'Heute', cls: 'date-button' });
        todayButtonEl.addEventListener('click', () =>
        {
            const today = new Date().toISOString().split('T')[0];
            inputEl.value = today;
            this.callback(today);
            this.close();
        });

        const inputEl = containerEl.createEl('input', { type: 'date', cls: 'date-input' });
        inputEl.focus();

        inputEl.addEventListener('keydown', (event) =>
        {
            if (event.key === 'Enter')
            {
                const dateValue = inputEl.value;
                this.callback(dateValue);
                this.close();
            }
        });

        const okButtonEl = containerEl.createEl('button', { text: 'OK', cls: 'date-button' });
        okButtonEl.addEventListener('click', () =>
        {
            const dateValue = inputEl.value;
            this.callback(dateValue);
            this.close();
        });

        contentEl.appendChild(containerEl);
    }

    onClose()
    {
        const { contentEl } = this;
        contentEl.empty();
    }
}

class DateRangePromptModal extends Modal
{
    constructor(app, promptText, callback, defaultStartDate = null, defaultMultiDay = false)
    {
        super(app);
        this.promptText = promptText;
        this.callback = callback;
        this.defaultStartDate = defaultStartDate;
        this.defaultMultiDay = defaultMultiDay;
    }

    onOpen()
    {
        const { contentEl } = this;
        contentEl.createEl('h2', { text: this.promptText });

        const containerEl = contentEl.createEl('div', { cls: 'date-container' });
        const startInputEl = containerEl.createEl('input', { type: 'date', cls: 'date-input' });
        startInputEl.focus();

        if (this.defaultStartDate)
        {
            startInputEl.value = this.defaultStartDate;
        }

        const todayButtonEl = containerEl.createEl('button', { text: 'Heute', cls: 'date-button' });
        todayButtonEl.addEventListener('click', () =>
        {
            const today = new Date().toISOString().split('T')[0];
            startInputEl.value = today;
            this.callback({ startDate: today });
            this.close();
        });

        const multiDayContainer = containerEl.createEl('div', { cls: 'multi-day-container' });
        const multiDayCheckboxEl = multiDayContainer.createEl('input', { type: 'checkbox', cls: 'multi-day-checkbox' });
        multiDayCheckboxEl.id = 'multiDayCheckbox';

        multiDayCheckboxEl.checked = this.defaultMultiDay;
        const multiDayLabelEl = multiDayContainer.createEl('label', { text: 'Mehrtägig', cls: 'multi-day-label' });
        multiDayLabelEl.htmlFor = 'multiDayCheckbox';

        const endInputEl = containerEl.createEl('input', { type: 'date', cls: 'date-input' });
        endInputEl.style.display = this.defaultMultiDay ? 'block' : 'none';

        multiDayCheckboxEl.addEventListener('change', () =>
        {
            endInputEl.style.display = multiDayCheckboxEl.checked ? 'block' : 'none';
        });

        startInputEl.addEventListener('keydown', (event) =>
        {
            if (event.key === 'Enter')
            {
                const dateValue = startInputEl.value;
                const endDate = multiDayCheckboxEl.checked ? endInputEl.value : null;
                this.callback({ startDate: dateValue, endDate });
                this.close();
            }
        });

        const okButtonEl = containerEl.createEl('button', { text: 'OK', cls: 'date-button' });
        okButtonEl.addEventListener('click', () =>
        {
            const dateValue = startInputEl.value;
            const endDate = multiDayCheckboxEl.checked ? endInputEl.value : null;
            this.callback({ startDate: dateValue, endDate });
            this.close();
        });

        multiDayContainer.appendChild(multiDayLabelEl);
        containerEl.appendChild(multiDayContainer);
        containerEl.appendChild(endInputEl);
        containerEl.appendChild(okButtonEl);

        contentEl.appendChild(containerEl);
    }

    onClose()
    {
        const { contentEl } = this;
        contentEl.empty();
    }
}

class DropdownModal extends Modal
{
    constructor(app, promptText, options, callback, showTodayButton = false, validateTodayCallback = null, allowNewCustomer = false, createNewCustomerCallback = null)
    {
        super(app);
        this.promptText = promptText;
        this.options = options;
        this.callback = callback;
        this.showTodayButton = showTodayButton;
        this.validateTodayCallback = validateTodayCallback;
        this.allowNewCustomer = allowNewCustomer;
        this.createNewCustomerCallback = createNewCustomerCallback;
    }

    onOpen()
    {
        const { contentEl } = this;
        contentEl.createEl('h2', { text: this.promptText });

        const containerEl = contentEl.createEl('div', { cls: 'dropdown-container' });

        if (this.showTodayButton)
        {
            const todayButtonEl = containerEl.createEl('button', { text: 'Heute', cls: 'dropdown-button' });
            todayButtonEl.addEventListener('click', () =>
            {
                const today = new Date().toISOString().split('T')[0];
                if (this.validateTodayCallback && this.validateTodayCallback(today))
                {
                    this.callback(today);
                    this.close();
                }
                else
                {
                    new Notice('Remote-Tag für heute existiert nicht.');
                }
            });
        }

        const inputEl = containerEl.createEl('input', { type: 'text', cls: 'dropdown-input' });
        inputEl.focus();

        const dropdownEl = containerEl.createEl('select', { cls: 'dropdown' });
        dropdownEl.size = this.options.length > 10 ? 10 : this.options.length;

        this.options.forEach(option =>
        {
            const optionEl = dropdownEl.createEl('option', { text: option });
            optionEl.value = option;

            optionEl.addEventListener('dblclick', () =>
            {
                this.callback(optionEl.value);
                this.close();
            });
        });

        inputEl.addEventListener('input', () =>
        {
            const filter = inputEl.value.toLowerCase();
            let firstVisibleOption = null;
            let visibleOptionsCount = 0;
            for (let i = 0; i < dropdownEl.options.length; i++)
            {
                const option = dropdownEl.options[i];
                if (option.text.toLowerCase().includes(filter))
                {
                    option.style.display = '';
                    if (!firstVisibleOption) firstVisibleOption = option;
                    visibleOptionsCount++;
                }
                else
                {
                    option.style.display = 'none';
                }
            }
            if (firstVisibleOption)
            {
                dropdownEl.value = firstVisibleOption.value;
            }
            dropdownEl.size = visibleOptionsCount > 10 ? 10 : visibleOptionsCount;
        });

        dropdownEl.addEventListener('keydown', (event) =>
        {
            if (event.key === 'Enter')
            {
                event.preventDefault();
                this.callback(dropdownEl.value);
                this.close();
            }
            else if (event.key === 'Tab')
            {
                event.preventDefault();
                inputEl.focus();
            }
        });

        inputEl.addEventListener('keydown', (event) =>
        {
            if (event.key === 'Enter')
            {
                event.preventDefault();
                if (dropdownEl.options.length > 0)
                {
                    this.callback(dropdownEl.value);
                    this.close();
                }
            }
            else if (event.key === 'ArrowDown')
            {
                event.preventDefault();
                dropdownEl.focus();
            }
        });

        contentEl.appendChild(containerEl);

        if (this.allowNewCustomer)
        {
            const newCustomerButton = contentEl.createEl('button', { text: 'Neuen Kunden erstellen', cls: 'new-customer-button' });
            newCustomerButton.addEventListener('click', () =>
            {
                this.openNewCustomerModal();
            });
        }
    }

    openNewCustomerModal()
    {
        const modal = new PromptModal(this.app, 'Neuen Kundennamen eingeben', async (newCustomerName) =>
        {
            if (newCustomerName)
            {
                if (this.createNewCustomerCallback)
                {
                    await this.createNewCustomerCallback(newCustomerName);
                    this.options.push(newCustomerName);
                    this.refreshDropdown();
                    this.callback(newCustomerName);
                    this.close();
                }
                else
                {
                    new Notice('Fehler: createNewCustomerCallback nicht definiert.');
                }
            }
            else
            {
                new Notice('Kein Kundennamen eingegeben.');
            }
        });
        modal.open();
    }

    refreshDropdown()
    {
        const dropdownEl = this.contentEl.querySelector('.dropdown');
        dropdownEl.innerHTML = '';

        this.options.forEach(option =>
        {
            const optionEl = dropdownEl.createEl('option', { text: option });
            optionEl.value = option;

            optionEl.addEventListener('dblclick', () =>
            {
                this.callback(optionEl.value);
                this.close();
            });
        });
    }

    onClose()
    {
        const { contentEl } = this;
        contentEl.empty();
    }
}

class ConfirmPromptModal extends Modal
{
    constructor(app, promptText, callback)
    {
        super(app);
        this.promptText = promptText;
        this.callback = callback;
    }

    onOpen()
    {
        const { contentEl } = this;
        contentEl.createEl('h2', { text: this.promptText });

        const buttonContainer = contentEl.createEl('div', { cls: 'button-container' });
        const yesButton = buttonContainer.createEl('button', { text: 'Ja' });
        yesButton.addEventListener('click', () =>
        {
            this.callback(true);
            this.close();
        });

        const noButton = buttonContainer.createEl('button', { text: 'Nein' });
        noButton.addEventListener('click', () =>
        {
            this.callback(false);
            this.close();
        });
    }

    onClose()
    {
        const { contentEl } = this;
        contentEl.empty();
    }
}

class ConfirmModal extends Modal
{
    constructor(app, promptText, callback)
    {
        super(app);
        this.promptText = promptText;
        this.callback = callback;
    }

    onOpen()
    {
        const { contentEl } = this;
        contentEl.createEl('h2', { text: this.promptText });

        const buttonEl = contentEl.createEl('button', { text: 'Öffnen' });
        buttonEl.addEventListener('click', () =>
        {
            this.callback();
            this.close();
        });
    }

    onClose()
    {
        const { contentEl } = this;
        contentEl.empty();
    }
}

// #endregion

// #region Calendar and Info Modals (No logic changed, just cleaned up spacing and comments)

class CalendarModal extends Modal
{
    constructor(app, plugin)
    {
        super(app);
        this.plugin = plugin;
        this.currentDate = new Date();
        this.highlightedDate = null;
    }

    onOpen()
    {
        const { contentEl } = this;
        contentEl.empty();

        this.modalEl.style.width = '80%';
        this.modalEl.style.height = '80%';

        contentEl.style.width = '100%';
        contentEl.style.height = '100%';
        contentEl.style.display = 'flex';
        contentEl.style.flexDirection = 'column';
        contentEl.style.paddingTop = '20px';

        const navContainer = contentEl.createEl('div', { cls: 'calendar-nav' });

        const prevButton = navContainer.createEl('button', { text: '← Vorherige 4 Monate', cls: 'prev-button' });
        prevButton.addEventListener('click', () =>
        {
            this.currentDate.setMonth(this.currentDate.getMonth() - 4);
            this.renderCalendar();
        });

        const todayButton = navContainer.createEl('button', { text: 'Heute', cls: 'today-button' });
        todayButton.addEventListener('click', () =>
        {
            this.currentDate = new Date();
            this.highlightedDate = null;
            this.renderCalendar();
        });

        const nextButton = navContainer.createEl('button', { text: 'Nächste 4 Monate →', cls: 'next-button' });
        nextButton.addEventListener('click', () =>
        {
            this.currentDate.setMonth(this.currentDate.getMonth() + 4);
            this.renderCalendar();
        });

        const searchContainer = contentEl.createEl('div', { cls: 'calendar-search' });
        const searchInput = searchContainer.createEl('input', { type: 'date' });
        const searchButton = searchContainer.createEl('button', { text: 'Springe zu Datum' });
        searchButton.addEventListener('click', () =>
        {
            const selectedDate = new Date(searchInput.value);
            if (!isNaN(selectedDate))
            {
                this.currentDate = selectedDate;
                this.highlightedDate = selectedDate;
                this.renderCalendar();
            }
        });

        this.calendarContainer = contentEl.createEl('div', { cls: 'calendar-container' });

        this.renderCalendar();
    }

    renderCalendar()
    {
        const { calendarContainer } = this;
        calendarContainer.empty();

        const deployments = this.plugin.getDeploymentDates();
        const remoteDays = this.plugin.getRemoteDates();

        const startMonth = new Date(Date.UTC(this.currentDate.getUTCFullYear(), this.currentDate.getUTCMonth(), 1));

        for (let i = 0; i < 4; i++)
        {
            const monthDate = new Date(Date.UTC(startMonth.getUTCFullYear(), startMonth.getUTCMonth() + i, 1));
            const monthEl = calendarContainer.createEl('div', { cls: 'calendar-month' });
            monthEl.createEl('h3', { text: monthDate.toLocaleString('default', { month: 'long', year: 'numeric' }) });

            const daysEl = monthEl.createEl('div', { cls: 'calendar-days' });
            const firstDayOfMonth = new Date(Date.UTC(monthDate.getUTCFullYear(), monthDate.getUTCMonth(), 1));
            const firstDayWeekday = (firstDayOfMonth.getUTCDay() + 6) % 7;
            const displayStartDate = new Date(firstDayOfMonth);
            displayStartDate.setUTCDate(displayStartDate.getUTCDate() - firstDayWeekday);

            const lastDayOfMonth = new Date(Date.UTC(monthDate.getUTCFullYear(), monthDate.getUTCMonth() + 1, 0));
            const lastDayWeekday = (lastDayOfMonth.getUTCDay() + 6) % 7;
            const displayEndDate = new Date(lastDayOfMonth);
            displayEndDate.setUTCDate(displayEndDate.getUTCDate() + (6 - lastDayWeekday));

            let currentDate = new Date(displayStartDate);

            while (currentDate <= displayEndDate)
            {
                const dateStr = currentDate.toISOString().split('T')[0];
                const dayEl = daysEl.createEl('div', { cls: 'calendar-day' });

                const dayNumberEl = dayEl.createEl('div', { text: currentDate.getUTCDate().toString(), cls: 'day-number' });

                const today = new Date();
                const isToday = currentDate.getUTCFullYear() === today.getFullYear() &&
                                currentDate.getUTCMonth() === today.getUTCMonth() &&
                                currentDate.getUTCDate() === today.getUTCDate();

                if (isToday)
                {
                    dayEl.addClass('today');
                }

                if (this.highlightedDate)
                {
                    const isHighlighted = currentDate.getUTCFullYear() === this.highlightedDate.getUTCFullYear() &&
                                          currentDate.getUTCMonth() === this.highlightedDate.getUTCMonth() &&
                                          currentDate.getUTCDate() === this.highlightedDate.getUTCDate();
                    if (isHighlighted)
                    {
                        dayEl.addClass('highlighted-date');
                    }
                }

                if (currentDate.getUTCMonth() !== monthDate.getUTCMonth())
                {
                    dayEl.addClass('other-month');
                }

                const dayOfWeek = currentDate.getUTCDay();
                if (dayOfWeek === 0 || dayOfWeek === 6)
                {
                    dayNumberEl.addClass('weekend');
                }

                const dayDeployments = deployments[dateStr] || [];
                const isRemoteDay = remoteDays[dateStr];

                if (dayDeployments.length > 0 || isRemoteDay)
                {
                    const eventsEl = dayEl.createEl('div', { cls: 'day-events' });

                    if (isRemoteDay)
                    {
                        const eventClass = isRemoteDay.archived ? 'remote-event archived' : 'remote-event';
                        eventsEl.createEl('div', { text: 'Remote', cls: `event ${eventClass}` });
                    }

                    for (const deployment of dayDeployments)
                    {
                        let eventClass;
                        if (deployment.completed)
                        {
                            eventClass = 'deployment-completed-event';
                        }
                        else
                        {
                            eventClass = deployment.preCheckDone ? 'deployment-event' : 'deployment-new-event';
                        }

                        eventsEl.createEl('div', {
                            text: `${deployment.customerName}`,
                            cls: `event ${eventClass}`
                        });
                    }
                }

                dayEl.addEventListener('click', () =>
                {
                    if (dayDeployments.length > 0 || isRemoteDay)
                    {
                        this.openDayInfoModal(dateStr);
                    }
                    else
                    {
                        this.openCreateModal(dateStr);
                    }
                });

                currentDate.setUTCDate(currentDate.getUTCDate() + 1);
            }
        }
    }

    openCreateModal(dateStr)
    {
        const modal = new ChooseActionModal(this.app, dateStr, this.plugin);
        modal.open();
        modal.onClose = () =>
        {
            this.renderCalendar();
        };
    }

    openDayInfoModal(dateStr)
    {
        const modal = new DayInfoModal(this.app, dateStr, this.plugin);
        modal.open();
    }

    refreshCalendar()
    {
        this.renderCalendar();
    }

    onClose()
    {
        const { contentEl } = this;
        contentEl.empty();
    }
}

class ChooseActionModal extends Modal
{
    constructor(app, dateStr, plugin)
    {
        super(app);
        this.dateStr = dateStr;
        this.plugin = plugin;
    }

    onOpen()
    {
        const { contentEl } = this;
        contentEl.empty();

        contentEl.addClass('choose-action-modal');
        contentEl.createEl('h2', { text: 'Aktion wählen' });
        contentEl.createEl('p', { text: `Datum: ${this.dateStr}` });

        const buttonContainer = contentEl.createEl('div', { cls: 'button-container' });

        const createDeploymentButton = buttonContainer.createEl('button', { text: 'Einsatz erstellen' });
        createDeploymentButton.addEventListener('click', async () =>
        {
            await this.plugin.createNewDeploymentWithDate(this.dateStr);
            this.close();
        });

        const createRemoteDayButton = buttonContainer.createEl('button', { text: 'Remote-Tag erstellen' });
        createRemoteDayButton.addEventListener('click', async () =>
        {
            await this.plugin.createNewRemoteDayWithDate(this.dateStr);
            this.close();
        });
    }

    onClose()
    {
        const { contentEl } = this;
        contentEl.empty();
    }
}

class DayInfoModal extends Modal
{
    constructor(app, dateStr, plugin)
    {
        super(app);
        this.dateStr = dateStr;
        this.plugin = plugin;
    }

    async onOpen()
    {
        const { contentEl } = this;
        contentEl.empty();

        contentEl.addClass('day-info-modal');

        contentEl.createEl('h2', { text: 'Termin-Informationen' });
        contentEl.createEl('p', { text: `Datum: ${this.dateStr}` });

        const deployments = this.plugin.getDeploymentDates()[this.dateStr] || [];
        const isRemoteDay = this.plugin.getRemoteDates()[this.dateStr];

        const infoEl = contentEl.createEl('div', { cls: 'info-text' });
        const buttonContainer = contentEl.createEl('div', { cls: 'button-container' });

        if (isRemoteDay)
        {
            const remoteInfo = '- **Typ:** Remote';
            await MarkdownRenderer.renderMarkdown(remoteInfo, infoEl, '', this);

            const openScheduleButton = buttonContainer.createEl('button', { text: 'Remote-Zeitplan öffnen' });
            openScheduleButton.addEventListener('click', async () =>
            {
                await this.plugin.openRemoteSchedule(this.dateStr);
                this.close();
            });
        }

        for (const deployment of deployments)
        {
            const deploymentInfo = `- **Typ:** Einsatz\n  **Kunde:** ${deployment.customerName}\n  **Kurzbeschrieb:** ${deployment.kurzbeschrieb}\n  **Einsatzdaten:** ${deployment.folderName}`;
            await MarkdownRenderer.renderMarkdown(deploymentInfo, infoEl, '', this);

            const openDeploymentButton = buttonContainer.createEl('button', { text: `Zum Einsatz von ${deployment.customerName}` });
            openDeploymentButton.addEventListener('click', async () =>
            {
                await this.plugin.openDeploymentFile(deployment);
                this.close();
            });
        }

        const newEventButton = buttonContainer.createEl('button', { text: 'Neuen Termin erstellen' });
        newEventButton.addEventListener('click', () =>
        {
            this.close();
            this.plugin.openCreateModal(this.dateStr);
        });

        const closeButton = buttonContainer.createEl('button', { text: 'Schließen' });
        closeButton.addEventListener('click', () =>
        {
            this.close();
        });
    }

    onClose()
    {
        const { contentEl } = this;
        contentEl.empty();
    }
}

// #endregion

// #region Styles

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

.calendar-nav {
    display: flex;
    justify-content: center;
    align-items: center;
    margin-bottom: 10px;
    margin-top: 20px;
}

.calendar-nav button {
    flex: none;
    margin: 0 10px;
}

.calendar-nav .today-button {
    width: 80px;
}

.calendar-nav .prev-button,
.calendar-nav .next-button {
    width: 150px;
}

.calendar-day.highlighted-date {
    border: 2px solid lightgray;
    border-radius: 5px;
    box-sizing: border-box;
}

.calendar-search {
    display: flex;
    margin-bottom: 10px;
}

.calendar-search input {
    margin-right: 5px;
}

.calendar-container {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    grid-gap: 20px;
    width: 100%;
    flex-grow: 1;
    overflow-y: auto;
}

.calendar-month {
    box-sizing: border-box;
    padding: 10px;
}

.calendar-days {
    display: flex;
    flex-wrap: wrap;
}

.calendar-day {
    width: 14.28%;
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

.day-number.weekend {
    color: dimgray;
}

.calendar-day.other-month {
    color: gray
}

.day-number {
    font-weight: bold;
}

.day-events {
    margin-top: 5px;
}

.event {
    font-size: 10px;
    margin-top: 2px;
    padding: 2px;
    border-radius: 3px;
    color: white;
}

.deployment-new-event {
    background-color: orange;
}

.deployment-event {
    background-color: #3D90A1;
}

.deployment-completed-event {
    background-color: #28a745;
}

.remote-event {
    background-color: #C71585;
}

.choose-action-modal .button-container {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    margin-top: 20px;
}

.choose-action-modal .button-container button {
    margin: 5px 0;
    padding: 10px;
    width: 100%;
    box-sizing: border-box;
}

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
    white-space: pre-wrap;
    margin-top: 10px;
}

.modal-container {
    max-width: none;
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

// #endregion

module.exports = SoftwarePlanner;
