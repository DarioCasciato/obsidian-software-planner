const { Plugin, PluginSettingTab, Setting, Notice, Modal } = require('obsidian');
const { remote } = require('electron');
const path = require('path');
const fs = require('fs'); // Verwenden des nativen fs-Moduls von Node.js

// Default settings
const DEFAULT_SETTINGS = {
    customerTemplatePath: '',
    customerDestinationPath: '',
    remoteDayTemplatePath: '',
    remoteDayDestinationPath: '',
    deploymentTemplatePath: '',
    remoteTaskTemplatePath: ''
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

        console.log('Customer Template Path:', customerTemplatePath);
        console.log('Customer Destination Path:', customerDestinationPath);
        console.log('Remote Day Template Path:', remoteDayTemplatePath);
        console.log('Remote Day Destination Path:', remoteDayDestinationPath);
        console.log('Deployment Template Path:', deploymentTemplatePath);
        console.log('Remote Task Template Path:', remoteTaskTemplatePath);

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
        const customerName = await this.promptUser('Enter customer name');
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
        const remoteDay = await this.promptUser('Enter remote day (YYYY-MM-DD)');
        if (!remoteDay) return;

        const taskName = await this.promptUser('Enter task name');
        if (!taskName) return;

        const remoteTaskPath = path.join(this.app.vault.adapter.basePath, this.settings.remoteDayDestinationPath, remoteDay, taskName);
        const templatePath = path.join(this.app.vault.adapter.basePath, this.settings.remoteTaskTemplatePath);

        try {
            await copyFolder(templatePath, remoteTaskPath);
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

        const inputEl = contentEl.createEl('input', { type: 'date' });
        inputEl.focus();

        inputEl.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                const dateValue = inputEl.value;
                this.callback(dateValue);
                this.close();
            }
        });

        const buttonEl = contentEl.createEl('button', { text: 'OK' });
        buttonEl.addEventListener('click', () => {
            const dateValue = inputEl.value;
            this.callback(dateValue);
            this.close();
        });
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}

module.exports = SoftwarePlanner;
