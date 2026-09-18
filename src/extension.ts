// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';

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
		panel.webview.html = getWebviewContent(previousText, currentText);
	});

	context.subscriptions.push(disposable);
}

// This method is called when your extension is deactivated
export function deactivate() {}


// helper function to generate the HTML content for the webview
function getWebviewContent(oldText: string, newText: string): string {
    // We break the strings into arrays of lines to display them in rows
    const oldLines = oldText.split('\n').map((l, i) => `<div class="line" id="left-${i}">${l || '&nbsp;'}</div>`).join('');
    const newLines = newText.split('\n').map((l, i) => `<div class="line" id="right-${i}">${l || '&nbsp;'}</div>`).join('');

	// TODO: move this to a new file (e.g. src/webview/diff-view.html) and load it here
    return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <style>
                body { display: flex; font-family: monospace; margin: 0; padding: 0; background: #1e1e1e; color: #d4d4d4; height: 100vh; overflow: hidden; }
                .pane { flex: 1; overflow-y: auto; padding: 10px; white-space: pre; position: relative; }
                .line { height: 20px; line-height: 20px; }
                
                /* The fluid gutter holding our connecting curves */
                .gutter { width: 60px; background: #252526; position: relative; }
                canvas { position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; }
            </style>
        </head>
        <body>
            <div class="pane" id="leftPane">${oldLines}</div>
            <div class="gutter">
                <canvas id="canvas"></canvas>
            </div>
            <div class="pane" id="rightPane">${newLines}</div>

            <script>
                const leftPane = document.getElementById('leftPane');
                const rightPane = document.getElementById('rightPane');
                const canvas = document.getElementById('canvas');
                const ctx = canvas.getContext('2d');

                // Resize canvas to match the window container
                function resizeCanvas() {
                    canvas.width = canvas.parentElement.clientWidth;
                    canvas.height = canvas.parentElement.clientHeight;
                    drawConnections();
                }

                // Simple MVP fluid connection drawer
                function drawConnections() {
                    ctx.clearRect(0, 0, canvas.width, canvas.height);
                    
                    // For our basic MVP, let's visually link line 1 on the left to line 1 on the right
                    // Modern algorithms will match dynamic lines, but let's draw one Bezier curve to test the fluid concept!
                    const leftEl = document.getElementById('left-1');
                    const rightEl = document.getElementById('right-1');

                    if (leftEl && rightEl) {
                        const leftY = leftEl.getBoundingClientRect().top - leftPane.getBoundingClientRect().top + 10 - leftPane.scrollTop;
                        const rightY = rightEl.getBoundingClientRect().top - rightPane.getBoundingClientRect().top + 10 - rightPane.scrollTop;

                        ctx.beginPath();
                        ctx.moveTo(0, leftY);
                        // Draw a sleek Bezier curve across the gutter mapping the two lines fluidly
                        ctx.bezierCurveTo(canvas.width / 2, leftY, canvas.width / 2, rightY, canvas.width, rightY);
                        ctx.strokeStyle = 'rgba(0, 122, 255, 0.5)';
                        ctx.lineWidth = 2;
                        ctx.stroke();
                    }
                }

                // Synchronize scrolling between left and right panes
                leftPane.addEventListener('scroll', () => {
                    rightPane.scrollTop = leftPane.scrollTop;
                    drawConnections();
                });
                rightPane.addEventListener('scroll', () => {
                    leftPane.scrollTop = rightPane.scrollTop;
                    drawConnections();
                });

                window.addEventListener('resize', resizeCanvas);
                setTimeout(resizeCanvas, 100);
            </script>
        </body>
        </html>
    `;
}