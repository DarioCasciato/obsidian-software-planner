module.exports = class MyPlugin extends require('obsidian').Plugin {
    async onload() {
      console.log('Plugin loaded');

      // Plugin-Befehle hinzufügen
      this.addCommand({
        id: 'sample-command',
        name: 'Sample Command',
        callback: () => this.sampleCommand()
      });
    }

    sampleCommand() {
      new Notice('Sample command executed');
    }

    onunload() {
      console.log('Plugin unloaded');
    }
  }
