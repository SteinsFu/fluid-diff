// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json
	const disposable = vscode.commands.registerCommand('easy-diff-viewer.openFluidDiff', async () => {
		// The code you place here will be executed every time your command is executed
		// Display a message box to the user
		vscode.window.showInformationMessage('Open Fluid Diff from easy-diff-viewer!');

		const activeEditor = vscode.window.activeTextEditor;
		if (!activeEditor) {
			vscode.window.showInformationMessage('Open a file first to view its diff.');
			return;
		}

		// 1. Get current text from the active file
		const currentText = activeEditor.document.getText();
		const fileName = activeEditor.document.fileName;

		// 2. Temporarily mock the previous text for demonstration purposes
		const previousText = currentText.replace("Local Supabase", "Local Supbase (previous version)");

		// 3. Create and show a new webview panel
		const panel = vscode.window.createWebviewPanel(
			'fluidDiff', // Identifies the type of the webview. Used internally
			'Fluid Diff Viewer', // Title of the panel displayed to the user
			vscode.ViewColumn.One, // Editor column to show the new webview panel in.
			{
				enableScripts: true, // Crucial! allwo JS to run inside HTML webview
			}
		);

		// 4. Set the HTML content of the webview panel
		panel.webview.html = getWebviewContent(context, previousText, currentText);
	});

	context.subscriptions.push(disposable);
}

// This method is called when your extension is deactivated
export function deactivate() {}


// helper function to generate the HTML content for the webview
function getWebviewContent(context: vscode.ExtensionContext, oldText: string, newText: string): string {
    // We break the strings into arrays of lines to display them in rows
    const oldLines = oldText.split('\n').map((l, i) => `<div class="line" id="left-${i}">${l || '&nbsp;'}</div>`).join('');
    const newLines = newText.split('\n').map((l, i) => `<div class="line" id="right-${i}">${l || '&nbsp;'}</div>`).join('');

    console.log('context.extensionPath', context.extensionPath);
    const htmlPath = path.join(context.extensionPath, 'src', 'webview', 'diff-view.html');
    const htmlContent = fs.readFileSync(htmlPath, 'utf8')
        .replace('{{oldText}}', oldLines)
        .replace('{{newText}}', newLines);
    return htmlContent;
}