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
    xmlProgramPath: '' // Neue Einstellung für den Pfad zum externen Programm
};

// Settings tab
class SoftwarePlannerSettingTab extends PluginSettingTab {
    constructor(app, plugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display() {
        const { containerEl } = this;
        containerEl.empty();

        containerEl.createEl('h2', { text: 'Software Planner Plugin Settings' });

        // Software Settings
        containerEl.createEl('h3', { text: 'Software Settings' });

        this.addPathSetting(containerEl, 'Customer Template Path', 'customerTemplatePath');
        this.addPathSetting(containerEl, 'Customer Destination Path', 'customerDestinationPath');
        this.addPathSetting(containerEl, 'Deployment Template Path', 'deploymentTemplatePath');

        // Remote Settings
        containerEl.createEl('h3', { text: 'Remote Settings' });

        this.addPathSetting(containerEl, 'Remote Day Template Path', 'remoteDayTemplatePath');
        this.addPathSetting(containerEl, 'Remote Day Destination Path', 'remoteDayDestinationPath');
        this.addPathSetting(containerEl, 'Remote Task Template Path', 'remoteTaskTemplatePath');

        // XML Program Path
        containerEl.createEl('h3', { text: 'XML Program Path' });

        new Setting(containerEl)
            .setName('XML Program Path')
            .setDesc('Path to the program that opens XML files')
            .addText(text => text
                .setPlaceholder('Enter the path')
                .setValue(this.plugin.settings.xmlProgramPath || '')
                .onChange(async (value) => {
                    this.plugin.settings.xmlProgramPath = value;
                    await this.plugin.saveSettings();
                }))
            .addButton(button => button
                .setButtonText('Browse')
                .setCta()
                .onClick(async () => {
                    const result = await remote.dialog.showOpenDialog({
                        properties: ['openFile']
                    });
                    if (!result.canceled) {
                        const selectedPath = result.filePaths[0];
                        this.plugin.settings.xmlProgramPath = selectedPath;
                        await this.plugin.saveSettings();
                        this.display(); // Refresh the settings to show updated path
                    }
                }));

        // Add a button to print the paths to the developer console
        new Setting(containerEl)
            .addButton(button => button
                .setButtonText('Print Paths')
                .setCta()
                .onClick(() => {
                    this.printPaths();
                }));
    }

    addPathSetting(containerEl, name, settingKey) {
        new Setting(containerEl)
            .setName(name)
            .setDesc(`Path to the ${name.toLowerCase()}`)
            .addText(text => text
                .setPlaceholder('Enter the path')
                .setValue(this.plugin.settings[settingKey] || '')
                .onChange(async (value) => {
                    this.plugin.settings[settingKey] = value;
                    await this.plugin.saveSettings();
                }))
            .addButton(button => button
                .setButtonText('Browse')
                .setCta()
                .onClick(async () => {
                    const result = await remote.dialog.showOpenDialog({
                        properties: ['openDirectory']
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

    printPaths() {
        const vaultPath = this.app.vault.adapter.basePath;

        const customerTemplatePath = path.join(vaultPath, this.plugin.settings.customerTemplatePath);
        const customerDestinationPath = path.join(vaultPath, this.plugin.settings.customerDestinationPath);
        const remoteDayTemplatePath = path.join(vaultPath, this.plugin.settings.remoteDayTemplatePath);
        const remoteDayDestinationPath = path.join(vaultPath, this.plugin.settings.remoteDayDestinationPath);
        const deploymentTemplatePath = path.join(vaultPath, this.plugin.settings.deploymentTemplatePath);
        const remoteTaskTemplatePath = path.join(vaultPath, this.plugin.settings.remoteTaskTemplatePath);
        const xmlProgramPath = this.plugin.settings.xmlProgramPath;

        console.log('Customer Template Path:', customerTemplatePath);
        console.log('Customer Destination Path:', customerDestinationPath);
        console.log('Remote Day Template Path:', remoteDayTemplatePath);
        console.log('Remote Day Destination Path:', remoteDayDestinationPath);
        console.log('Deployment Template Path:', deploymentTemplatePath);
        console.log('Remote Task Template Path:', remoteTaskTemplatePath);
        console.log('XML Program Path:', xmlProgramPath);

        new Notice('Paths printed to console');
    }
}

// Main plugin class
class SoftwarePlanner extends Plugin {
    async onload() {
        console.log('Loading Software Planner plugin');

        // Load settings
        await this.loadSettings();

        // Add settings tab
        this.addSettingTab(new SoftwarePlannerSettingTab(this.app, this));

        // Register commands
        this.registerCommands();

        // Add event listener for XML files
        this.registerEvent(this.app.workspace.on('file-open', (file) => {
            if (file.extension === 'xml') {
                this.openXmlFileExternally(file.path);
            }
        }));
    }

    onunload() {
        console.log('Unloading Software Planner plugin');
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
    }

    async createNewCustomer() {
        const customerName = await this.promptUser('Enter customer name');
        if (!customerName) return;

        const customerPath = path.join(this.app.vault.adapter.basePath, this.settings.customerDestinationPath, customerName);
        const templatePath = path.join(this.app.vault.adapter.basePath, this.settings.customerTemplatePath);

        try {
            await copyFolder(templatePath, customerPath);
            new Notice(`Customer folder created: ${customerName}`);
        } catch (error) {
            console.error(`Error creating customer folder: ${error.message}`);
            new Notice(`Error creating customer folder: ${error.message}`);
        }
    }

    async createNewRemoteDay() {
        const remoteDay = await this.promptDate('Enter remote day (YYYY-MM-DD)');
        if (!remoteDay) return;

        const remoteDayPath = path.join(this.app.vault.adapter.basePath, this.settings.remoteDayDestinationPath, remoteDay);
        const templatePath = path.join(this.app.vault.adapter.basePath, this.settings.remoteDayTemplatePath);

        try {
            await copyFolder(templatePath, remoteDayPath);
            new Notice(`Remote day folder created: ${remoteDay}`);
        } catch (error) {
            console.error(`Error creating remote day folder: ${error.message}`);
            new Notice(`Error creating remote day folder: ${error.message}`);
        }
    }

    async createNewDeployment() {
        const customers = getExistingFolders(path.join(this.app.vault.adapter.basePath, this.settings.customerDestinationPath));
        const customerName = await this.promptDropdown('Select customer', customers);
        if (!customerName) return;

        const deploymentDate = await this.promptDate('Enter deployment date (YYYY-MM-DD)');
        if (!deploymentDate) return;

        const customerPath = path.join(this.app.vault.adapter.basePath, this.settings.customerDestinationPath, customerName, '1. Einsätze', deploymentDate);
        const templatePath = path.join(this.app.vault.adapter.basePath, this.settings.deploymentTemplatePath);

        try {
            await copyFolder(templatePath, customerPath);
            new Notice(`Deployment folder created for ${customerName} on ${deploymentDate}`);
        } catch (error) {
            console.error(`Error creating deployment folder: ${error.message}`);
            new Notice(`Error creating deployment folder: ${error.message}`);
        }
    }

    async createNewRemoteTask() {
        const remoteDays = getExistingFolders(path.join(this.app.vault.adapter.basePath, this.settings.remoteDayDestinationPath));
        const remoteDay = await this.promptDropdown('Select remote day', remoteDays, true, (date) => remoteDays.includes(date));
        if (!remoteDay) return;

        const taskName = await this.promptUser('Enter task name');
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
            new Notice(`Remote task folder created for ${taskName} on ${remoteDay}`);
        } catch (error) {
            console.error(`Error creating remote task folder: ${error.message}`);
            new Notice(`Error creating remote task folder: ${error.message}`);
        }
    }

    async promptUser(promptText) {
        return new Promise((resolve) => {
            const modal = new PromptModal(this.app, promptText, resolve);
            modal.open();
        });
    }

    async promptDate(promptText) {
        return new Promise((resolve) => {
            const modal = new DatePromptModal(this.app, promptText, resolve);
            modal.open();
        });
    }

    async promptDropdown(promptText, options, showTodayButton = false, validateTodayCallback = null) {
        return new Promise((resolve) => {
            const modal = new DropdownModal(this.app, promptText, options, resolve, showTodayButton, validateTodayCallback);
            modal.open();
        });
    }

    async openXmlFileExternally(filePath) {
        if (!this.settings.xmlProgramPath) {
            new Notice('XML Program Path is not set in the settings.');
            return;
        }

        const fullPath = path.join(this.app.vault.adapter.basePath, filePath);
        exec(`"${this.settings.xmlProgramPath}" "${fullPath}"`, (error) => {
            if (error) {
                new Notice(`Failed to open XML file: ${error.message}`);
            }
        });
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

// DatePromptModal class
class DatePromptModal extends Modal {
    constructor(app, promptText, callback) {
        super(app);
        this.promptText = promptText;
        this.callback = callback;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.createEl('h2', { text: this.promptText });

        // Create container for buttons and input
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

        // Append elements to contentEl
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
        });

        // Filter options based on input
        inputEl.addEventListener('input', () => {
            const filter = inputEl.value.toLowerCase();
            for (let i = 0; i < dropdownEl.options.length; i++) {
                const option = dropdownEl.options[i];
                option.style.display = option.text.toLowerCase().includes(filter) ? '' : 'none';
            }
        });

        // Handle enter key and button click
        inputEl.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                this.callback(dropdownEl.value);
                this.close();
            }
        });

        const buttonEl = containerEl.createEl('button', { text: 'OK', cls: 'dropdown-button' });
        buttonEl.addEventListener('click', () => {
            this.callback(dropdownEl.value);
            this.close();
        });

        // Append elements to contentEl
        contentEl.appendChild(containerEl);
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
    min-height: 100px; /* Set a minimum height for the dropdown */
}

.dropdown-button {
    align-self: center;
    padding: 5px 10px;
    margin-bottom: 5px; /* Add margin to separate buttons */
}
`;
document.head.appendChild(style);

module.exports = SoftwarePlanner;
