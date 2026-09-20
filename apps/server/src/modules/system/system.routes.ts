import type { FastifyInstance } from 'fastify';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export async function pickNativeFolder(): Promise<string | null> {
  if (process.platform === 'win32') {
    // Use PowerShell with single-threaded apartment (STA) to show FolderBrowserDialog
    const psScript = `
Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = '选择本地源码根目录'
$dialog.ShowNewFolderButton = $true
$form = New-Object System.Windows.Forms.Form
$form.TopMost = $true
$result = $dialog.ShowDialog($form)
if ($result -eq [System.Windows.Forms.DialogResult]::OK) {
  Write-Output $dialog.SelectedPath
}
`;
    try {
      const { stdout } = await execFileAsync('powershell', ['-STA', '-NoProfile', '-Command', psScript], {
        timeout: 120000,
        windowsHide: false,
      });
      const selected = stdout.trim();
      return selected || null;
    } catch {
      return null;
    }
  } else if (process.platform === 'darwin') {
    try {
      const { stdout } = await execFileAsync('osascript', ['-e', 'POSIX path of (choose folder with prompt "选择本地源码根目录")'], {
        timeout: 120000,
      });
      const selected = stdout.trim();
      return selected || null;
    } catch {
      return null;
    }
  } else if (process.platform === 'linux') {
    try {
      const { stdout } = await execFileAsync('zenity', ['--file-selection', '--directory', '--title=选择本地源码根目录'], {
        timeout: 120000,
      });
      const selected = stdout.trim();
      return selected || null;
    } catch {
      return null;
    }
  }
  return null;
}

export function registerSystemRoutes(app: FastifyInstance) {
  app.post<{ Reply: { path: string | null } }>('/api/system/select-directory', async (_request, reply) => {
    try {
      const selected = await pickNativeFolder();
      return reply.send({ path: selected });
    } catch (error) {
      app.log.error(error, 'Folder picker error');
      return reply.send({ path: null });
    }
  });
}
