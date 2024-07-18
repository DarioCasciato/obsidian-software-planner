const { Plugin, PluginSettingTab, Setting, Notice, Modal } = require('obsidian');
const { remote } = require('electron');
const path = require('path');

// Default settings
const DEFAULT_SETTINGS = {
    customerTemplatePath: '',
    customerDestinationPath: '',
    remoteDayTemplatePath: '',
    remoteDayDestinationPath: ''
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

        // Remote Settings
        containerEl.createEl('h3', { text: 'Remote Settings' });

        this.addPathSetting(containerEl, 'Remote Day Template Path', 'remoteDayTemplatePath');
        this.addPathSetting(containerEl, 'Remote Day Destination Path', 'remoteDayDestinationPath');

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

        console.log('Customer Template Path:', customerTemplatePath);
        console.log('Customer Destination Path:', customerDestinationPath);

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
    }

    async createNewCustomer() {
        const customerName = await this.promptUser('Enter customer name');
        if (!customerName) return;

        const customerPath = path.join(this.settings.customerDestinationPath, customerName);
        const templatePath = path.join(this.app.vault.adapter.basePath, this.settings.customerTemplatePath);

        try {
            await this.createFolderFromTemplate(customerPath, templatePath);
            new Notice(`Customer folder created: ${customerName}`);
        } catch (error) {
            console.error(`Error creating customer folder: ${error.message}`);
            new Notice(`Error creating customer folder: ${error.message}`);
        }
    }

    async promptUser(promptText) {
        return new Promise((resolve) => {
            const modal = new PromptModal(this.app, promptText, resolve);
            modal.open();
        });
    }

    async createFolderFromTemplate(destinationPath, templatePath) {
        console.log('Creating folder at:', destinationPath);
        console.log('Using template at:', templatePath);

        // Create destination folder if it does not exist
        if (!await this.app.vault.adapter.exists(destinationPath)) {
            console.log('CREATING DESTINATION FOLDER AT:', destinationPath);
            await this.app.vault.adapter.mkdir(destinationPath);
        }

        // Copy files and folders from template to destination
        const templateFiles = await this.app.vault.adapter.list(templatePath);
        console.log('Template files:', templateFiles);

        for (const file of templateFiles.files) {
            const relativeFilePath = path.relative(templatePath, file);
            const destinationFilePath = path.join(destinationPath, relativeFilePath);
            console.log('Copying file from:', file, 'to:', destinationFilePath);
            await this.app.vault.adapter.copy(file, destinationFilePath);
        }

        for (const folder of templateFiles.folders) {
            const relativeFolderPath = path.relative(templatePath, folder);
            const destinationFolderPath = path.join(destinationPath, relativeFolderPath);
            if (!await this.app.vault.adapter.exists(destinationFolderPath)) {
                console.log('CREATING FOLDER AT:', destinationFolderPath);
                await this.app.vault.adapter.mkdir(destinationFolderPath);
            }
            await this.createFolderFromTemplate(destinationFolderPath, folder);
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

module.exports = SoftwarePlanner;
